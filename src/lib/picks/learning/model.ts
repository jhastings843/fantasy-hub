// The strategy review: settle -> score -> review -> bounded change ->
// validate -> record, after the trading experiment's cycle (CYCLE.md), minus
// any execution. Pure: no Redis, no network. review.ts runs it against a
// store; the rehearsal runs it against memory.
//
// What it can change, and what it cannot:
//   CAN, automatically, after validation: activate a registered ATS research
//   cut as a rule candidate; change staking parameters (kind, Kelly scale,
//   prior) inside the protected envelope (limits.ts).
//   REPORTS ONLY (a proposal for a person): send timing, parlays (the
//   envelope forbids enabling them), totals cut choice, straight-up method,
//   PEM's weight. Those either live in code a review must not edit, or
//   already select themselves on forward evidence.
//   NEVER: raise limits, change grading or accounting, rewrite issued
//   history or old stakes, or weaken CRITERIA (pinned by learning.test.ts).
//
// Evidence: only the append-only pregame forecasts (forecasts.ts) and the
// issued records. A hypothesis is scored only on games whose FIRST pregame
// snapshot came after it was registered, so no sample is chosen after seeing
// it. Comparisons are paired, on matched opportunities: the same games, the
// same quotes, the same prices.

import { MAX_KELLY_SCALE, MIN_PRIOR_GAMES } from "../limits";
import { BASELINE_POLICY, envelopeViolations, type PicksPolicy, type StakingPolicy } from "../policy";
import { type CutTest, type Result, cutsFor, grade, key, matches, readAt, suPick } from "../engine";
import type { ForecastSnapshot } from "../forecasts";
import type { IssuedRecord } from "../issued";
import { clvPoints } from "../closing";
import { decimal, stakeFor } from "../staking";
import { payout } from "../units";
import type { League } from "../parse";

// ----------------------------------------------------------------- criteria

/**
 * The acceptance test for any change. Frozen: the review reads these and can
 * never write them; learning.test.ts pins every value.
 */
export const CRITERIA = {
  /** Settled matched opportunities where at least one side bets. */
  MIN_OPPORTUNITIES: 30,
  /** Distinct weeks those come from. */
  MIN_WEEKS: 3,
  /** One-sided paired t on the per-opportunity unit difference. */
  MIN_T: 1.645,
  /** Challenger CLV may not trail the incumbent's by more than this (points). */
  CLV_MARGIN: 0.25,
  /** Challenger drawdown at most this multiple of the incumbent's (plus 1u slack). */
  DRAWDOWN_RATIO: 1.25,
  /** A staking change that sizes up needs this many settled issued bets... */
  CALIBRATION_MIN_BETS: 50,
  /** ...with mean estimated probability within this of the actual win rate. */
  CALIBRATION_TOLERANCE: 0.05,
  /** After activation: roll back once this many matched games settle with t at or under -MIN_T. */
  ROLLBACK_MIN_OPPORTUNITIES: 20,
  /** At most this many hypotheses collecting at once, and new ones per review. */
  MAX_COLLECTING: 24,
  MAX_NEW_PER_REVIEW: 2,
} as const;

// --------------------------------------------------------------- hypotheses

export type HypothesisKind = "ats-cut" | "stake-policy" | "timing" | "parlay" | "su-method" | "pem";

export interface Hypothesis {
  id: string;
  kind: HypothesisKind;
  league: League | "both";
  /** Frozen at registration; a change is a new hypothesis. */
  definition:
    | { kind: "ats-cut"; cutId: string; label: string; test: CutTest; parentId: string; parentTest: CutTest }
    | { kind: "stake-policy"; staking: StakingPolicy; label: string }
    | { kind: "timing"; label: string }
    | { kind: "parlay"; label: string; minEdge: number }
    | { kind: "su-method"; method: string; vs: string; label: string }
    | { kind: "pem"; label: string };
  /** Activatable automatically, or a report/proposal only. */
  actionable: boolean;
  registeredAt: string;
  status: "collecting" | "promoted" | "rejected" | "retired";
  /** How it was proposed: seeded at launch, or generated from evidence (with the source). */
  origin: string;
}

/** The launch set: every research cut against its parent, and the report-only questions. */
export function seedHypotheses(registeredAt: string): Hypothesis[] {
  const out: Hypothesis[] = [];
  for (const league of ["nfl", "cfb"] as const) {
    const cuts = cutsFor(league, league === "cfb");
    const byId = new Map(cuts.map((c) => [c.id, c]));
    for (const c of cuts.filter((x) => x.group === "Research" && x.parent && byId.has(x.parent))) {
      const parent = byId.get(c.parent!)!;
      out.push({
        id: `${league}:ats:${c.id}`,
        kind: "ats-cut",
        league,
        definition: { kind: "ats-cut", cutId: c.id, label: c.label, test: c.test, parentId: parent.id, parentTest: parent.test },
        actionable: true,
        registeredAt,
        status: "collecting",
        origin: "seed: research refinement vs its parent",
      });
    }
    out.push({ id: `${league}:timing`, kind: "timing", league, definition: { kind: "timing", label: "Rule bets at the game-day line vs the first actionable line" }, actionable: false, registeredAt, status: "collecting", origin: "seed" });
    out.push({ id: `${league}:parlay`, kind: "parlay", league, definition: { kind: "parlay", label: "Two-leg parlays of rule bets vs the same risk in singles", minEdge: 0.1 }, actionable: false, registeredAt, status: "collecting", origin: "seed" });
    out.push({ id: `${league}:su:avg-vs-vegas`, kind: "su-method", league, definition: { kind: "su-method", method: "avg", vs: "vegas", label: "Models' average vs the Vegas favorite, straight up" }, actionable: false, registeredAt, status: "collecting", origin: "seed" });
  }
  out.push({ id: "cfb:pem", kind: "pem", league: "cfb", definition: { kind: "pem", label: "Rule bets where PEM agrees vs where it disagrees" }, actionable: false, registeredAt, status: "collecting", origin: "seed" });
  out.push({ id: "both:stake:flat1", kind: "stake-policy", league: "both", definition: { kind: "stake-policy", label: "Flat 1u on every bet", staking: { kind: "flat", kellyScale: 0.25, priorGames: 100, flatUnits: 1 } }, actionable: true, registeredAt, status: "collecting", origin: "seed: the flat-risk baseline" });
  out.push({ id: "both:stake:kelly0125", kind: "stake-policy", league: "both", definition: { kind: "stake-policy", label: "Eighth Kelly", staking: { kind: "kelly", kellyScale: 0.125, priorGames: 100, flatUnits: 1 } }, actionable: true, registeredAt, status: "collecting", origin: "seed" });
  return out;
}

// ------------------------------------------------------------ opportunities

/** One game, as known before kickoff: its first actionable snapshot and its last. */
export interface Opportunity {
  league: League;
  week: number;
  home: string;
  away: string;
  key: string;
  first: ForecastSnapshot;
  last: ForecastSnapshot;
  final?: { home: number; away: number };
  close?: number | null;
}

// A snapshot counts only with a known kickoff it precedes: no kickoff, no
// proof it was pregame.
const actionable = (s: ForecastSnapshot) =>
  !!s.sam && !!s.david && !!s.ref && s.ref.homePrice !== undefined && s.ref.awayPrice !== undefined && !!s.ref.kickoff && s.at < s.ref.kickoff;

export function opportunities(
  league: League,
  snaps: ForecastSnapshot[],
  finals: Map<string, { home: number; away: number }>,
  closes: Map<string, number | null>,
): Opportunity[] {
  const by = new Map<string, ForecastSnapshot[]>();
  for (const s of snaps.filter(actionable)) {
    const k = key(s);
    by.set(k, [...(by.get(k) ?? []), s]);
  }
  return [...by].map(([k, list]) => {
    const sorted = list.slice().sort((a, b) => a.at.localeCompare(b.at));
    const f = sorted[0];
    return { league, week: f.week, home: f.home, away: f.away, key: k, first: f, last: sorted[sorted.length - 1], final: finals.get(k), close: closes.get(k) };
  });
}

// --------------------------------------------------------------- evaluation

/** One opportunity, scored for one side of a comparison: units at 1u risk (or the policy's stake), CLV. */
export interface Scored {
  bet: boolean;
  units: number;
  risked: number;
  clv?: number;
  result?: Result;
}

const none: Scored = { bet: false, units: 0, risked: 0 };

/** A spread cut at one snapshot, 1u risked at the quoted price. */
export function scoreCut(test: CutTest, s: ForecastSnapshot, o: Opportunity, stake = 1): Scored {
  if (!s.sam || !s.david || !s.ref || !o.final) return none;
  const r = readAt(s.ref.line, s.sam, s.david, s.pem);
  if (!matches(r, test) || !r.side) return none;
  const homeLine = s.ref.line;
  const pr = r.side === "home" ? s.ref.homePrice : s.ref.awayPrice;
  if (pr === undefined) return none;
  const res = grade(o.final, homeLine, r.side);
  return { bet: true, units: payout(res, stake, pr), risked: stake, result: res, clv: o.close != null ? clvPoints(r.side, homeLine, o.close) : undefined };
}

export interface Comparison {
  /** Settled opportunities where at least one side bets. */
  n: number;
  weeks: number[];
  /** Paired per-opportunity difference (challenger - incumbent) in units. */
  meanDiff: number;
  t: number;
  challenger: Summary;
  incumbent: Summary;
}

export interface Summary {
  bets: number;
  units: number;
  risked: number;
  roi: number;
  clv: number | null;
  clvN: number;
  drawdown: number;
}

function summarize(xs: Scored[]): Summary {
  let run = 0;
  let peak = 0;
  let dd = 0;
  for (const x of xs) {
    run += x.units;
    peak = Math.max(peak, run);
    dd = Math.max(dd, peak - run);
  }
  const bets = xs.filter((x) => x.bet);
  const clvs = bets.flatMap((x) => (x.clv === undefined ? [] : [x.clv]));
  const units = bets.reduce((t, x) => t + x.units, 0);
  const risked = bets.reduce((t, x) => t + x.risked, 0);
  return {
    bets: bets.length,
    units: round(units),
    risked: round(risked),
    roi: risked ? round(units / risked) : 0,
    clv: clvs.length ? round(clvs.reduce((a, b) => a + b, 0) / clvs.length) : null,
    clvN: clvs.length,
    drawdown: round(dd),
  };
}

const round = (x: number) => Math.round(x * 1000) / 1000;

/** Paired comparison over matched opportunities, in time order. */
export function compare(pairs: { o: Opportunity; ch: Scored; inc: Scored }[]): Comparison {
  const used = pairs.filter((p) => p.o.final && (p.ch.bet || p.inc.bet)).sort((a, b) => a.o.first.at.localeCompare(b.o.first.at));
  const d = used.map((p) => p.ch.units - p.inc.units);
  const mean = d.length ? d.reduce((a, b) => a + b, 0) / d.length : 0;
  const sd = d.length > 1 ? Math.sqrt(d.reduce((t, x) => t + (x - mean) ** 2, 0) / (d.length - 1)) : 0;
  // Capped so a zero-variance sample stays a finite, storable number.
  const raw = sd > 0 ? mean / (sd / Math.sqrt(d.length)) : mean > 0 ? 99 : mean < 0 ? -99 : 0;
  const t = Math.max(-99, Math.min(99, raw));
  return {
    n: used.length,
    weeks: [...new Set(used.map((p) => p.o.week))].sort((a, b) => a - b),
    meanDiff: round(mean),
    t: round(t),
    challenger: summarize(used.map((p) => p.ch)),
    incumbent: summarize(used.map((p) => p.inc)),
  };
}

/** Only games first seen after the hypothesis was registered count toward it. */
export const after = (h: Hypothesis, opps: Opportunity[]) => opps.filter((o) => o.first.at >= h.registeredAt);

export interface IssuedBet {
  league: League;
  week: number;
  key: string;
  at: string;
  p: number;
  price: number;
  units: number;
  result: Result;
}

/** Settled, staked, confirmed issued bets with the probability they were sized from. */
export function issuedBets(league: League, records: IssuedRecord[], finals: Map<string, { home: number; away: number }>): IssuedBet[] {
  return records
    .filter((r) => r.status !== "pending" && r.status !== "unconfirmed")
    .flatMap((r) =>
      r.plays.flatMap((p) => {
        const k = key({ week: r.week, home: p.home, away: p.away });
        const f = finals.get(k);
        return p.shownInEmail && p.units && p.p !== undefined && p.price !== undefined && f
          ? [{ league, week: r.week, key: k, at: r.issuedAt, p: p.p, price: p.price, units: p.units, result: grade(f, p.homeLine, p.side) }]
          : [];
      }),
    );
}

export interface Calibration {
  n: number;
  meanP: number;
  winRate: number;
  brier: number;
  calibrated: boolean;
}

/** Do the stored pregame probabilities match outcomes? Pushes left out. */
export function calibration(bets: IssuedBet[]): Calibration {
  const dec = bets.filter((b) => b.result !== "P");
  const n = dec.length;
  if (!n) return { n: 0, meanP: 0, winRate: 0, brier: 0, calibrated: false };
  const meanP = dec.reduce((t, b) => t + b.p, 0) / n;
  const winRate = dec.filter((b) => b.result === "W").length / n;
  const brier = dec.reduce((t, b) => t + (b.p - (b.result === "W" ? 1 : 0)) ** 2, 0) / n;
  return {
    n,
    meanP: round(meanP),
    winRate: round(winRate),
    brier: round(brier),
    calibrated: n >= CRITERIA.CALIBRATION_MIN_BETS && Math.abs(meanP - winRate) <= CRITERIA.CALIBRATION_TOLERANCE,
  };
}

export interface Evaluation {
  id: string;
  comparison?: Comparison;
  /** Extra numbers a report-only hypothesis shows. */
  note?: string;
}

export interface EvalInputs {
  opps: Opportunity[];
  issued: IssuedBet[];
  active: PicksPolicy;
  /** The current rule's test per league, as the incumbent for timing/parlay/pem questions. */
  ruleTest: { nfl?: CutTest; cfb?: CutTest };
}

export function evaluate(h: Hypothesis, x: EvalInputs): Evaluation {
  const opps = after(h, x.opps).filter((o) => h.league === "both" || o.league === h.league);
  const d = h.definition;
  switch (d.kind) {
    case "ats-cut":
      return { id: h.id, comparison: compare(opps.map((o) => ({ o, ch: scoreCut(d.test, o.first, o), inc: scoreCut(d.parentTest, o.first, o) }))) };
    case "timing": {
      const t = x.ruleTest[h.league as League];
      if (!t) return { id: h.id, note: "no rule in force" };
      return { id: h.id, comparison: compare(opps.map((o) => ({ o, ch: scoreCut(t, o.last, o), inc: scoreCut(t, o.first, o) }))) };
    }
    case "pem": {
      const t = x.ruleTest.cfb;
      if (!t) return { id: h.id, note: "no rule in force" };
      const agree = { ...t, pem: "agree" as const };
      return { id: h.id, comparison: compare(opps.map((o) => ({ o, ch: o.first.pem ? scoreCut(agree, o.first, o) : none, inc: o.first.pem ? scoreCut(t, o.first, o) : none }))) };
    }
    case "parlay": {
      const t = x.ruleTest[h.league as League];
      if (!t) return { id: h.id, note: "no rule in force" };
      // Shadow: pair rule bets in first-snapshot order within a week; 1u parlay vs
      // 0.5u on each leg (same risk). Payout is the product of the quoted
      // leg prices, an estimate of what a book would actually pay.
      const pairs: { o: Opportunity; ch: Scored; inc: Scored }[] = [];
      const byWeek = new Map<number, { o: Opportunity; s: Scored; price: number }[]>();
      for (const o of opps) {
        const s = scoreCut(t, o.first, o);
        if (!s.bet || !s.result) continue;
        const r = readAt(o.first.ref!.line, o.first.sam!, o.first.david!, o.first.pem);
        const pr = r.side === "home" ? o.first.ref!.homePrice! : o.first.ref!.awayPrice!;
        byWeek.set(o.week, [...(byWeek.get(o.week) ?? []), { o, s, price: pr }]);
      }
      for (const legs of byWeek.values()) {
        for (let i = 0; i + 1 < legs.length; i += 2) {
          const [a, b] = [legs[i], legs[i + 1]];
          const lost = a.s.result === "L" || b.s.result === "L";
          const live = [a, b].filter((l) => l.s.result === "W");
          const par = lost ? -1 : live.length ? live.reduce((dd, l) => dd * decimal(l.price), 1) - 1 : 0;
          const singles = payout(a.s.result!, 0.5, a.price) + payout(b.s.result!, 0.5, b.price);
          pairs.push({ o: a.o, ch: { bet: true, units: par, risked: 1 }, inc: { bet: true, units: singles, risked: 1 } });
        }
      }
      return { id: h.id, comparison: compare(pairs), note: "estimated parlay payouts (product of quoted leg prices)" };
    }
    case "su-method": {
      // Accuracy and confidence-pool points (rank by margin within the week), challenger vs incumbent method.
      const pts = (method: string, os: Opportunity[]) => {
        const picks = os.flatMap((o) => {
          const p = suPick(method, o.last.sam, o.last.david, o.last.ref?.line);
          return p && o.final && o.final.home !== o.final.away ? [{ o, ...p, right: (p.side === "home") === o.final.home > o.final.away }] : [];
        });
        let points = 0;
        const byWeek = new Map<number, typeof picks>();
        for (const p of picks) byWeek.set(p.o.week, [...(byWeek.get(p.o.week) ?? []), p]);
        for (const list of byWeek.values()) {
          list.sort((a, b) => a.margin - b.margin).forEach((p, i) => {
            if (p.right) points += i + 1;
          });
        }
        return { right: picks.filter((p) => p.right).length, n: picks.length, points };
      };
      const a = pts(d.method, opps);
      const b = pts(d.vs, opps);
      return { id: h.id, note: `${d.method}: ${a.right}/${a.n} right, ${a.points} pool points; ${d.vs}: ${b.right}/${b.n}, ${b.points} points` };
    }
    case "stake-policy": {
      // Both sides replayed the same way (policy stake, limits not
      // re-applied), so the comparison is symmetric.
      const bets = x.issued.filter((b) => b.at >= h.registeredAt);
      const pairs = bets.map((b) => {
        const o = { league: b.league, week: b.week, key: b.key, first: { at: b.at } as ForecastSnapshot, final: { home: 0, away: 0 } } as Opportunity;
        const ch = stakeFor(b.p, b.price, d.staking);
        const inc = stakeFor(b.p, b.price, x.active.staking);
        return { o, ch: { bet: ch > 0, units: payout(b.result, ch, b.price), risked: ch }, inc: { bet: inc > 0, units: payout(b.result, inc, b.price), risked: inc } };
      });
      return { id: h.id, comparison: compare(pairs), note: `stake replay on ${bets.length} settled issued bets (limits not re-applied)` };
    }
  }
}

// ----------------------------------------------------------------- decision

export interface Decision {
  id: string;
  verdict: "promote" | "retain" | "reject" | "report";
  why: string;
}

/** The acceptance test. Insufficient or failed evidence keeps the incumbent, with the reason. */
export function decide(h: Hypothesis, e: Evaluation, ctx: { calibration: Calibration; active: PicksPolicy }): Decision {
  if (!h.actionable) {
    const c = e.comparison;
    return { id: h.id, verdict: "report", why: c ? `report only: n=${c.n}, mean difference ${c.meanDiff}u per game, t=${c.t}${e.note ? `; ${e.note}` : ""}` : e.note ?? "report only" };
  }
  const c = e.comparison;
  if (!c) return { id: h.id, verdict: "retain", why: e.note ?? "nothing to compare yet" };
  const gaps: string[] = [];
  if (c.n < CRITERIA.MIN_OPPORTUNITIES) gaps.push(`${c.n} of ${CRITERIA.MIN_OPPORTUNITIES} settled matched games`);
  if (c.weeks.length < CRITERIA.MIN_WEEKS) gaps.push(`${c.weeks.length} of ${CRITERIA.MIN_WEEKS} weeks`);
  if (gaps.length) return { id: h.id, verdict: "retain", why: `insufficient evidence: ${gaps.join(", ")}` };
  if (c.t < CRITERIA.MIN_T) {
    return { id: h.id, verdict: c.t <= -CRITERIA.MIN_T ? "reject" : "retain", why: `not better on matched games: mean ${c.meanDiff}u, t=${c.t} (needs ${CRITERIA.MIN_T})` };
  }
  if (c.challenger.clv !== null && c.incumbent.clv !== null && c.challenger.clv < c.incumbent.clv - CRITERIA.CLV_MARGIN) {
    return { id: h.id, verdict: "retain", why: `wins on results but trails on closing-line value (${c.challenger.clv} vs ${c.incumbent.clv})` };
  }
  if (c.challenger.drawdown > c.incumbent.drawdown * CRITERIA.DRAWDOWN_RATIO + 1) {
    return { id: h.id, verdict: "retain", why: `drawdown ${c.challenger.drawdown}u vs ${c.incumbent.drawdown}u` };
  }
  if (h.definition.kind === "stake-policy") {
    // Sizing up, by any route (more Kelly, or a flat stake bigger on average), needs calibration.
    const sizesUp = c.challenger.risked > c.incumbent.risked;
    if (sizesUp && !ctx.calibration.calibrated) {
      return { id: h.id, verdict: "retain", why: `would size up, but the stored probabilities aren't shown calibrated (n=${ctx.calibration.n}, mean p ${ctx.calibration.meanP} vs win rate ${ctx.calibration.winRate})` };
    }
  }
  return { id: h.id, verdict: "promote", why: `beat the incumbent on ${c.n} matched games over ${c.weeks.length} weeks: +${c.meanDiff}u per game, t=${c.t}; CLV ${c.challenger.clv ?? "n/a"} vs ${c.incumbent.clv ?? "n/a"}` };
}

/** The policy a promotion would produce: a new frozen version, never an edit. */
export function applyPromotion(active: PicksPolicy, h: Hypothesis, id: string, at: string): PicksPolicy {
  const d = h.definition;
  if (d.kind === "ats-cut") {
    // League-scoped: the same research id can mean different cuts per league.
    const scoped = `${h.league}:${d.cutId}`;
    return { ...active, id, createdAt: at, atsCandidates: [...new Set([...active.atsCandidates, scoped])], summary: `${active.summary} + ${h.league.toUpperCase()} candidate cut ${d.label}` };
  }
  if (d.kind === "stake-policy") {
    return { ...active, id, createdAt: at, staking: { ...d.staking }, summary: `${d.label}; ${active.atsCandidates.length ? `candidates: ${active.atsCandidates.join(", ")}` : "built-in cuts only"}; parlays off` };
  }
  return active;
}

// --------------------------------------------------------------- validation

export interface ValidationInput {
  policy: PicksPolicy;
  /** Stakes a replay of this week's card under the policy produced, per sport. */
  replay: { league: League; stakes: number[]; weeklyRoom: number; unpricedStakes: number }[];
  /** Units summary of all issued history before and after (must be identical). */
  historyBefore: string;
  historyAfter: string;
}

/** Everything that must hold before a policy goes live. Any failure blocks activation (or triggers rollback). */
export function validate(v: ValidationInput): string[] {
  const fails = [...envelopeViolations(v.policy)];
  if (v.policy.staking.kellyScale > MAX_KELLY_SCALE) fails.push("Kelly scale above the envelope");
  if (v.policy.staking.priorGames < MIN_PRIOR_GAMES) fails.push("prior under the envelope");
  for (const r of v.replay) {
    const sum = r.stakes.reduce((a, b) => a + b, 0);
    if (sum > r.weeklyRoom + 1e-9) fails.push(`${r.league}: replay stakes ${sum}u exceed the ${r.weeklyRoom}u room`);
    if (r.stakes.some((x) => x > 5 || (x > 0 && x < 0.25))) fails.push(`${r.league}: a replay stake is outside 0.25-5u`);
    if (r.unpricedStakes) fails.push(`${r.league}: a replay staked a game with no quoted price`);
  }
  if (v.historyBefore !== v.historyAfter) fails.push("re-grading issued history changed under the new policy");
  return fails;
}

/** Predeclared rollback: the new policy, in shadow against the one it replaced, on games settled since. */
export function shouldRollBack(c: Comparison | null, validationFailures: string[]): string | null {
  if (validationFailures.length) return `validation failed: ${validationFailures.join("; ")}`;
  if (c && c.n >= CRITERIA.ROLLBACK_MIN_OPPORTUNITIES && c.t <= -CRITERIA.MIN_T) {
    return `underperformed the previous policy on ${c.n} settled matched games (mean ${c.meanDiff}u, t=${c.t})`;
  }
  return null;
}

/** Bounded, evidence-led proposals: neighbour thresholds of a promising ATS hypothesis, registered before any sample. */
export function propose(hs: Hypothesis[], evals: Evaluation[], at: string): Hypothesis[] {
  const collecting = hs.filter((h) => h.status === "collecting").length;
  const room = Math.min(CRITERIA.MAX_NEW_PER_REVIEW, CRITERIA.MAX_COLLECTING - collecting);
  if (room <= 0) return [];
  // Deduplicate on what a cut actually tests, not its name.
  const sig = (league: string, d: Hypothesis["definition"]) => (d.kind === "ats-cut" ? `${league}|${d.parentId}|${JSON.stringify(d.test)}` : `${league}|${JSON.stringify(d)}`);
  const known = new Set(hs.map((h) => sig(h.league, h.definition)));
  const out: Hypothesis[] = [];
  for (const h of hs) {
    if (out.length >= room || h.definition.kind !== "ats-cut") continue;
    const e = evals.find((x) => x.id === h.id)?.comparison;
    if (!e || e.n < 15 || e.meanDiff <= 0) continue;
    const d = h.definition;
    for (const field of ["minLine", "maxLine", "minBothEdge", "minAvgEdge"] as const) {
      const v = d.test[field];
      if (v === undefined) continue;
      for (const step of [-1, 1]) {
        const test = { ...d.test, [field]: v + step };
        const def = { ...d, cutId: `${d.cutId}~${field}${v + step}`, label: `${d.label} (${field} ${v + step})`, test };
        if (known.has(sig(h.league, def)) || out.length >= room) continue;
        known.add(sig(h.league, def));
        out.push({ id: `${h.league}:ats:${def.cutId}`, kind: "ats-cut", league: h.league, definition: def, actionable: false, registeredAt: at, status: "collecting", origin: `generated from ${h.id} (n=${e.n}, +${e.meanDiff}u per game); report-only until a person adds the cut to the code` });
      }
    }
  }
  return out;
}

export { BASELINE_POLICY };
