// One strategy review, against a store: memory in tests and the rehearsal,
// Redis in production (store.ts). Bounded: at most one activation per part
// per review (Jack, 2026-10-27: a rule change shouldn't wait on a staking or
// totals change), no edits to definitions, nothing it writes can loosen a limit.

import type { League } from "../parse";
import type { CutTest } from "../engine";
import type { ForecastSnapshot } from "../forecasts";
import type { IssuedRecord } from "../issued";
import { DEFAULT_POLICY, suInForce, type PicksPolicy } from "../policy";
import {
  CRITERIA,
  type Comparison,
  type Decision,
  type Evaluation,
  type Hypothesis,
  applyPromotion,
  calibration,
  compare,
  decide,
  evaluate,
  isIncumbentStaking,
  issuedBets,
  laterHypotheses,
  marketPairs,
  opportunities,
  propose,
  scoreCut,
  scoreSu,
  scoreTotal,
  seedHypotheses,
  shouldRollBack,
  sizingComparison,
  type SizingInputs,
  type SizingView,
  type Summary,
  validate,
  type ValidationInput,
} from "./model";
import type { DecisionRecord } from "./replay";
import type { StakingPolicy } from "../policy";

export interface JournalEntry {
  at: string;
  kind: "review" | "register" | "activate" | "retain" | "reject" | "retire" | "rollback" | "proposal" | "ui" | "ops";
  title: string;
  why: string;
  policyBefore?: string;
  policyAfter?: string;
  rollbackTarget?: string;
  evidence?: unknown;
}

/**
 * The part of the process a hypothesis changes. One activation per part per
 * review, each with its own rollback: NFL's rule cuts, college's rule cuts,
 * each league's totals and straight-up method, the shared staking, and each
 * outside source.
 */
export function partOf(h: Hypothesis): string | null {
  const d = h.definition;
  if (d.kind === "ats-cut") return `${h.league}:rule`;
  if (d.kind === "totals-cut") return `${h.league}:totals`;
  if (d.kind === "su-method") return `${h.league}:straight-up`;
  if (d.kind === "stake-policy") return "staking";
  if (d.kind === "source") return `source:${d.source}`;
  if (d.kind === "market") return `${h.league}:splits`;
  return null;
}

/** The strongest promotion in each part (highest t first), in that order. */
export function bestPerPart<P extends { h: Hypothesis; t: number }>(promos: P[]): P[] {
  const seen = new Set<string>();
  return promos
    .slice()
    .sort((a, b) => b.t - a.t)
    .filter((p) => {
      const part = partOf(p.h);
      if (!part || seen.has(part)) return false;
      seen.add(part);
      return true;
    });
}

/** One live change, and what it replaced: enough to undo just that part. */
export interface Activation {
  part: string;
  hypothesis: string;
  at: string;
  /** Policy ids around it, for the journal. */
  from: string;
  to: string;
  /** What the part was before (straight-up method, staking); cuts need nothing, they are removed. */
  prev?: { su?: string; staking?: StakingPolicy };
}

/** The active policy with one activation undone; every other part untouched. */
export function revertPart(active: PicksPolicy, h: Hypothesis, a: Activation, id: string, at: string): PicksPolicy {
  const d = h.definition;
  const base = { ...active, id, createdAt: at };
  if (d.kind === "ats-cut") return { ...base, atsCandidates: active.atsCandidates.filter((c) => c !== `${h.league}:${d.cutId}`), summary: `${active.summary}; ${h.league.toUpperCase()} cut ${d.label} rolled back` };
  if (d.kind === "totals-cut") return { ...base, totalsCandidates: (active.totalsCandidates ?? []).filter((c) => c !== `${h.league}:${d.cutId}`), summary: `${active.summary}; ${h.league.toUpperCase()} totals ${d.label} rolled back` };
  if (d.kind === "su-method" && a.prev?.su) return { ...base, suMethod: { ...active.suMethod, [h.league]: a.prev.su }, summary: `${active.summary}; ${h.league.toUpperCase()} straight up back to ${a.prev.su}` };
  if (d.kind === "stake-policy" && a.prev?.staking) return { ...base, staking: { ...a.prev.staking }, summary: `${active.summary}; staking rolled back` };
  if (d.kind === "market") {
    const l = h.league as "nfl" | "cfb";
    return { ...base, marketSkips: { ...active.marketSkips, [l]: (active.marketSkips?.[l] ?? []).filter((f) => f !== d.filter) }, summary: `${active.summary}; ${l.toUpperCase()} skip alert ${d.filter} rolled back` };
  }
  return active;
}

export interface ReviewState {
  lastReviewAt: string;
  lastOutcome: string;
  nextReviewAt: string;
  settledOpportunities: number;
  activePolicyId: string;
  /** The policy the active one replaced, and when: what a rollback returns to. */
  previousPolicyId?: string;
  activatedAt?: string;
  activatedFrom?: string;
  /** Every change still live, one per part at most; each is checked for rollback on its own. */
  activations?: Activation[];
  /** Every activation and rollback in the last five weeks, by part: what locks a part for the rest of its NFL week. */
  changes?: { part: string; at: string }[];
  /** Every hypothesis's verdict at the last review, for the page. */
  decisions?: { id: string; label: string; verdict: string; why: string; n?: number; weeks?: number; t?: number }[];
  calibration?: { n: number; meanP: number; winRate: number; brier: number };
  /** Each sizing challenger, replayed through the limits against the live sizing (the page's sizing block). */
  sizing?: SizingState[];
}

export interface SizingState {
  id: string;
  label: string;
  verdict: string;
  /** Why it can't switch yet (or why it would). */
  why: string;
  n: number;
  weeks: number;
  t: number | null;
  tNeeded: number | null;
  challenger: Summary | null;
  incumbent: Summary | null;
  view: SizingView;
}

export interface LearningStore {
  hypotheses(): Promise<Hypothesis[]>;
  /** Insert (never overwrites a definition) or move status. */
  putHypothesis(h: Hypothesis): Promise<void>;
  append(e: JournalEntry): Promise<void>;
  journal(limit: number): Promise<JournalEntry[]>;
  state(): Promise<ReviewState | null>;
  setState(s: ReviewState): Promise<void>;
  active(): Promise<PicksPolicy>;
  version(id: string): Promise<PicksPolicy | null>;
  /** Store a version (never overwrites one). */
  putVersion(p: PicksPolicy): Promise<void>;
  setActive(p: PicksPolicy): Promise<void>;
}

export interface ReviewInputs {
  now: Date;
  forecasts: { league: League; snaps: ForecastSnapshot[] }[];
  finals: { league: League; map: Map<string, { home: number; away: number }> }[];
  closes: { league: League; map: Map<string, number | null> }[];
  issued: { league: League; records: IssuedRecord[] }[];
  ruleTest: { nfl?: CutTest; cfb?: CutTest };
  /** Replays this week's card under a policy (the caller knows how to compose). */
  replay(policy: PicksPolicy): Promise<ValidationInput["replay"]>;
  /** A stable summary of issued-history grading, to prove a policy change rewrites nothing. */
  history(): Promise<string>;
  /** Recorded game-day send decisions, both sports (decisions-store.ts). */
  decisions?: DecisionRecord[];
  /** Send keys of mornings that reached a decision (day markers). */
  decisionDays?: string[];
  /** John Harris's sheet line per college game key (source hypotheses). */
  harris?: Map<string, number>;
}

export interface ReviewResult {
  decisions: Decision[];
  evaluations: Evaluation[];
  /** The first activation this review (kept for callers that show one). */
  activated?: { from: string; to: string; hypothesis: string };
  /** Every activation this review, one per part. */
  activatedAll: { from: string; to: string; hypothesis: string; part: string }[];
  /** The first rollback this review. */
  rolledBack?: { from: string; to: string; why: string };
  rolledBackAll: { from: string; to: string; why: string; part: string }[];
  registered: string[];
  journal: JournalEntry[];
  state: ReviewState;
}

/**
 * Reviews run the morning after each slate (Jack, 2026-10-27: learn after
 * every slate, same evidence bar): Friday after Thursday night, Sunday after
 * college Saturday, Monday after Sunday, Tuesday after Monday night. 11:00
 * UTC is 7am EDT, the first hourly pulse, well before the 9am bets email.
 */
const SLATE_DAYS = new Set([5, 0, 1, 2]);

export function nextReviewAt(now: Date): string {
  const d = new Date(now);
  d.setUTCHours(11, 0, 0, 0);
  // The next slot strictly after now (today's, if it is still ahead).
  while (!SLATE_DAYS.has(d.getUTCDay()) || d.getTime() <= now.getTime()) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString();
}

/** The NFL week's turnover before `now`: Tuesday 11:00 UTC, the week's first review. */
function weekStart(now: Date): number {
  const d = new Date(now);
  d.setUTCHours(11, 0, 0, 0);
  while (d.getUTCDay() !== 2 || d.getTime() > now.getTime()) d.setUTCDate(d.getUTCDate() - 1);
  return d.getTime();
}

/** Parts that already changed (went live or rolled back) this NFL week: with several reviews a week, each part still changes once. */
export function lockedParts(changes: { part: string; at: string }[], now: Date): Set<string> {
  const from = weekStart(now);
  return new Set(changes.filter((a) => Date.parse(a.at) >= from && Date.parse(a.at) < now.getTime()).map((a) => a.part));
}

/**
 * State written before per-part activations kept one change in three fields.
 * Read it as a one-entry list, with the previous version supplying what the
 * part was before (the default if that version is gone: never larger stakes).
 */
async function legacyActivations(store: LearningStore, prev: ReviewState | null, active: PicksPolicy, hs: Hypothesis[]): Promise<Activation[]> {
  if (!prev?.previousPolicyId || !prev.activatedAt || !prev.activatedFrom || active.id === prev.previousPolicyId) return [];
  const h = hs.find((y) => y.id === prev.activatedFrom);
  const part = h ? partOf(h) : null;
  if (!h || !part) return [];
  const before = (await store.version(prev.previousPolicyId)) ?? DEFAULT_POLICY;
  const p = h.definition.kind === "su-method" ? { su: suInForce(before, h.league as "nfl" | "cfb") } : h.definition.kind === "stake-policy" ? { staking: before.staking } : undefined;
  return [{ part, hypothesis: h.id, at: prev.activatedAt, from: prev.previousPolicyId, to: active.id, ...(p ? { prev: p } : {}) }];
}

export async function runReview(store: LearningStore, x: ReviewInputs, opts: { dryRun?: boolean; reason?: string } = {}): Promise<ReviewResult> {
  const at = x.now.toISOString();
  const journal: JournalEntry[] = [];
  const write = async (e: JournalEntry) => {
    journal.push(e);
    if (!opts.dryRun) await store.append(e);
  };

  // Register the launch set the first time, before any of its sample exists.
  let hs = await store.hypotheses();
  const registered: string[] = [];
  if (!hs.length) {
    hs = seedHypotheses(at);
    for (const h of hs) if (!opts.dryRun) await store.putHypothesis(h);
    registered.push(...hs.map((h) => h.id));
    await write({ at, kind: "register", title: `Registered ${hs.length} hypotheses`, why: "Launch set: each research refinement vs its parent, the flat-risk and eighth-Kelly staking challengers, and report-only questions (timing, parlays, straight-up method, PEM). Their samples start now." });
  }

  // Hypotheses added after launch, registered now so their sample starts now.
  for (const h of laterHypotheses(at).filter((y) => !hs.some((z) => z.id === y.id))) {
    if (!opts.dryRun) await store.putHypothesis(h);
    hs = [...hs, h];
    registered.push(h.id);
    await write({ at, kind: "register", title: `Registered ${h.id}`, why: h.origin });
  }

  // Splits signals were report-only until 2026-10-27 (Jack: act through a pre-kickoff skip alert once one wins on 100+ rule bets).
  for (const h of hs.filter((y) => y.kind === "market" && !y.actionable && y.status === "collecting")) {
    const next = { ...h, actionable: true, origin: `${h.origin}; actionable from 2026-10-27 as a skip alert` };
    if (!opts.dryRun) await store.putHypothesis(next);
    hs = hs.map((y) => (y.id === h.id ? next : y));
    await write({ at, kind: "register", title: `${h.id} can now go live as a skip alert`, why: "Same test as any change, on 100+ settled rule bets; live means a phone alert about 45 minutes before kickoff when it flags a bet you were sent." });
  }

  // Generated cuts were report-only until 2026-10-20 (Jack: let it act on its own when it's best).
  // Ones already collecting become actionable; their sample and definition are unchanged.
  for (const h of hs.filter((y) => y.kind === "ats-cut" && !y.actionable && y.status === "collecting" && y.origin.startsWith("generated from"))) {
    const next = { ...h, actionable: true, origin: h.origin.replace(/; report-only until a person adds the cut to the code$/, "; goes live on its own if it passes the same test as any research cut") };
    if (!opts.dryRun) await store.putHypothesis(next);
    hs = hs.map((y) => (y.id === h.id ? next : y));
    await write({ at, kind: "register", title: `${h.id} can now go live on its own`, why: "Generated cuts are held to the same test as the built-in research cuts and activate automatically when they pass it." });
  }

  // Settle and score.
  const opps = x.forecasts.flatMap((f) =>
    opportunities(f.league, f.snaps, x.finals.find((m) => m.league === f.league)?.map ?? new Map(), x.closes.find((m) => m.league === f.league)?.map ?? new Map()),
  );
  const settled = opps.filter((o) => o.final).length;
  const bets = x.issued.flatMap((i) => issuedBets(i.league, i.records, x.finals.find((m) => m.league === i.league)?.map ?? new Map()));
  const cal = calibration(bets);
  let active = await store.active();
  const prev = await store.state();
  const historyBefore = await x.history();
  const sizing: SizingInputs = { decisions: x.decisions ?? [], days: x.decisionDays, issued: x.issued, finals: x.finals };
  let rollbackNote = "";

  // Rollback check on each live change, before anything new. A rollback
  // undoes only its own part; the others stay as they are.
  const live: Activation[] = prev?.activations ?? (await legacyActivations(store, prev, active, hs));
  const kept: Activation[] = [];
  const rolledBackAll: ReviewResult["rolledBackAll"] = [];
  const fails = live.length ? validate({ policy: active, replay: await x.replay(active), historyBefore, historyAfter: historyBefore }) : [];
  for (const a of live) {
    const h = hs.find((y) => y.id === a.hypothesis);
    if (!h) continue;
    const since = opps.filter((o) => o.first.at >= a.at);
    const d = h.definition;
    let c: Comparison | null = null;
    if (d.kind === "ats-cut") {
      c = compare(since.filter((o) => o.league === h.league).map((o) => ({ o, ch: scoreCut(d.test, o.first, o), inc: scoreCut(d.parentTest, o.first, o) })));
    } else if (d.kind === "totals-cut") {
      c = compare(since.filter((o) => o.league === h.league).map((o) => ({ o, ch: scoreTotal(d.test, o.first, o), inc: scoreTotal(d.parentTest, o.first, o) })));
    } else if (d.kind === "su-method" && a.prev?.su) {
      const l = h.league as "nfl" | "cfb";
      c = compare(since.filter((o) => o.league === l).map((o) => ({ o, ch: scoreSu(suInForce(active, l), o), inc: scoreSu(a.prev!.su!, o) })));
    } else if (d.kind === "stake-policy" && a.prev?.staking) {
      // The same replay as promotion: what each sizing would actually have
      // bet through the limits since activation. Rollback keeps the plain
      // MIN_T bar on the weekly t (easier to size back down than up).
      const r = sizingComparison(sizing, active.staking, a.prev.staking, a.at);
      c = r.comparison ?? null;
      if (!c) rollbackNote += ` Sizing rollback check: no complete recorded sends since ${a.at.slice(0, 10)}${r.view.restartedAfter ? ` (restarting after ${r.view.restartedAfter})` : ""}.`;
    } else if (d.kind === "market") {
      const t = x.ruleTest[h.league as "nfl" | "cfb"];
      if (t) c = compare(marketPairs(d.filter, h.league as League, t, since.filter((o) => o.league === h.league)));
    } else if (d.kind === "source") {
      // A source question never closes; its own test moves it back.
      kept.push(a);
      continue;
    }
    const why = shouldRollBack(c, fails);
    if (!why) {
      kept.push(a);
      continue;
    }
    // Nothing else changed since: the version it replaced comes back as it was.
    const exact = active.id === a.to ? await store.version(a.from) : null;
    const next = exact ?? revertPart(active, h, a, `p${at.replace(/[-:]/g, "").slice(0, 13)}r${rolledBackAll.length}`, at);
    rolledBackAll.push({ from: active.id, to: next.id, why, part: a.part });
    await write({ at, kind: "rollback", title: `Rolled back ${a.part}: ${h.id}`, why, policyBefore: active.id, policyAfter: next.id, evidence: c });
    if (!opts.dryRun) {
      if (!exact) await store.putVersion(next);
      await store.setActive(next);
    }
    active = next;
  }
  const rolledBack = rolledBackAll[0];

  // A staking challenger that matches the live sizing is the incumbent now
  // (flat 1u became live on 2026-10-10): retire it rather than compare it
  // with itself.
  for (const h of hs.filter((y) => y.status === "collecting" && isIncumbentStaking(y, active))) {
    if (!opts.dryRun) await store.putHypothesis({ ...h, status: "retired" });
    hs = hs.map((y) => (y.id === h.id ? { ...y, status: "retired" as const } : y));
    await write({ at, kind: "retire", title: `Retired ${h.id}`, why: `${active.id} already sizes this way; it is the incumbent, not a challenger.` });
  }

  // Evaluate and decide.
  const collecting = hs.filter((h) => h.status === "collecting");
  const evaluations = collecting.map((h) => evaluate(h, { opps, issued: bets, active, ruleTest: x.ruleTest, sizing, harris: x.harris }));
  const decisions = collecting.map((h, i) => decide(h, evaluations[i], { calibration: cal, active }));
  for (const d of decisions.filter((y) => y.verdict === "reject")) {
    const h = hs.find((y) => y.id === d.id)!;
    if (!opts.dryRun) await store.putHypothesis({ ...h, status: "rejected" });
    await write({ at, kind: "reject", title: `Rejected ${h.id}`, why: d.why, evidence: evaluations.find((e) => e.id === d.id)?.comparison });
  }

  // One activation per part: the strongest promotion in each part that
  // validates, applied in turn. A part rolled back this review, or already
  // changed this NFL week, waits.
  const activatedAll: ReviewResult["activatedAll"] = [];
  const priorChanges = prev?.changes ?? live.map((a) => ({ part: a.part, at: a.at }));
  const backParts = new Set([...rolledBackAll.map((r) => r.part), ...lockedParts(priorChanges, x.now)]);
  const promos = bestPerPart(
    decisions
      .filter((y) => y.verdict === "promote")
      .map((y) => ({ y, h: hs.find((z) => z.id === y.id)!, t: evaluations.find((e) => e.id === y.id)?.comparison?.t ?? 0 })),
  ).filter((p) => !backParts.has(partOf(p.h)!));
  for (const { y, h } of promos) {
    const part = partOf(h)!;
    // Ids are unique by time (and part order), so a rollback can never lead to a reused id.
    const next = applyPromotion(active, h, `p${at.replace(/[-:]/g, "").slice(0, 13)}${activatedAll.length ? `-${activatedAll.length}` : ""}`, at, y.to);
    const historyAfter = await x.history();
    const vfails = validate({ policy: next, replay: await x.replay(next), historyBefore, historyAfter });
    if (vfails.length) {
      await write({ at, kind: "retain", title: `Kept ${active.id}: ${h.id} failed validation`, why: vfails.join("; "), evidence: evaluations.find((e) => e.id === h.id)?.comparison });
      continue;
    }
    activatedAll.push({ from: active.id, to: next.id, hypothesis: h.id, part });
    // A part holds one live change: a newer one replaces the older one's rollback record.
    const prevPart = h.definition.kind === "su-method" ? { su: suInForce(active, h.league as "nfl" | "cfb") } : h.definition.kind === "stake-policy" ? { staking: active.staking } : undefined;
    for (let i = kept.length - 1; i >= 0; i--) if (kept[i].part === part) kept.splice(i, 1);
    kept.push({ part, hypothesis: h.id, at, from: active.id, to: next.id, ...(prevPart ? { prev: prevPart } : {}) });
    if (!opts.dryRun) {
      await store.putVersion(next);
      await store.setActive(next);
      // A source question never closes: it keeps testing from the switch, so the source can come back or go.
      if (h.kind !== "source") await store.putHypothesis({ ...h, status: "promoted" });
    }
    await write({ at, kind: "activate", title: `Activated ${next.id} (${h.id})`, why: y.why, policyBefore: active.id, policyAfter: next.id, rollbackTarget: active.id, evidence: evaluations.find((e) => e.id === h.id)?.comparison });
    active = next;
  }
  const activated = activatedAll[0] ? { from: activatedAll[0].from, to: activatedAll[0].to, hypothesis: activatedAll[0].hypothesis } : undefined;

  // Bounded new proposals from the evidence, registered before their sample.
  const fresh = propose(hs, evaluations, at);
  for (const h of fresh) {
    if (!opts.dryRun) await store.putHypothesis(h);
    registered.push(h.id);
    await write({ at, kind: "proposal", title: `Registered ${h.id}`, why: h.origin });
  }

  const retained = decisions.filter((d) => d.verdict === "retain");
  // Closest by progress toward the sample bar, not by sorting the reason text
  // (which put "0 of 30" first and reported the furthest hypothesis).
  const progress = (id: string) => {
    const c = evaluations.find((e) => e.id === id)?.comparison;
    if (!c) return -1;
    return Math.min(c.n / CRITERIA.MIN_OPPORTUNITIES, 1) + Math.min(c.weeks.length / CRITERIA.MIN_WEEKS, 1) + (c.t ?? 0) / 100;
  };
  const closest = retained.slice().sort((a, b) => progress(b.id) - progress(a.id))[0];
  const changes = [...rolledBackAll.map((r) => `rolled back ${r.part}`), ...activatedAll.map((a) => `activated ${a.hypothesis}`)];
  const outcome = changes.length ? `${changes.join("; ")}: now ${active.id}` : `no change: kept ${active.id}`;
  const why = changes.length
    ? [...rolledBackAll.map((r) => r.why), ...promos.filter((p) => activatedAll.some((a) => a.hypothesis === p.h.id)).map((p) => p.y.why)].join(" · ")
      : retained.length
        ? `${retained.length} hypotheses still collecting (closest: ${closest.id}, ${closest.why}). Settled matched games so far: ${settled}. Calibration: ${cal.n} settled issued bets, mean estimate ${cal.meanP}, win rate ${cal.winRate}.${rollbackNote}`
        : `nothing collecting met the criteria${rollbackNote}`;
  const state: ReviewState = {
    lastReviewAt: at,
    lastOutcome: outcome,
    nextReviewAt: nextReviewAt(x.now),
    settledOpportunities: settled,
    activePolicyId: active.id,
    // The single-change fields mirror the newest live change, for older readers.
    previousPolicyId: kept.at(-1)?.from,
    activatedAt: kept.at(-1)?.at,
    activatedFrom: kept.at(-1)?.hypothesis,
    activations: kept,
    changes: [...priorChanges, ...rolledBackAll.map((r) => ({ part: r.part, at })), ...activatedAll.map((a) => ({ part: a.part, at }))].filter((c) => x.now.getTime() - Date.parse(c.at) < 35 * 86_400_000),
    decisions: decisions.map((d) => {
      const h = hs.find((y) => y.id === d.id)!;
      const c = evaluations.find((e) => e.id === d.id)?.comparison;
      return { id: d.id, label: "label" in h.definition ? h.definition.label : d.id, verdict: d.verdict, why: d.why, ...(c ? { n: c.n, weeks: c.weeks.length, t: c.t } : {}) };
    }),
    calibration: { n: cal.n, meanP: cal.meanP, winRate: cal.winRate, brier: cal.brier },
    sizing: collecting.flatMap((h, i): SizingState[] => {
      const e = evaluations[i];
      if (h.definition.kind !== "stake-policy" || !e.sizing) return [];
      const c = e.comparison;
      return [{
        id: h.id,
        label: h.definition.label,
        verdict: decisions[i].verdict,
        why: decisions[i].why,
        n: c?.n ?? 0,
        weeks: c?.weeks.length ?? 0,
        t: c ? c.t : null,
        tNeeded: c?.tNeeded ?? null,
        challenger: c?.challenger ?? null,
        incumbent: c?.incumbent ?? null,
        view: e.sizing,
      }];
    }),
  };
  await write({ at, kind: "review", title: `Review (${opts.reason ?? "scheduled"}): ${outcome}`, why, policyAfter: active.id });
  if (!opts.dryRun) await store.setState(state);
  return { decisions, evaluations, activated, activatedAll, rolledBack, rolledBackAll, registered, journal, state };
}

export { CRITERIA };
