// Shadow sizing, replayed the way it would have run live. Pure.
//
// The first staking comparison (before 2026-10-12) re-sized each settled
// issued bet with stakeFor() and never re-applied the limits. That flatters
// a policy that wants bigger stakes: its hypothetical bets might not have fit
// the weekly budget, the open-bets cap, a game's cap, or the room the other
// sport's held plays took, and it never sees the bets the live policy was
// refused that a smaller policy could have afforded.
//
// So every game-day send now records its DECISION (decisions-store.ts): the
// full eligible set it allocated over (this sport's picks, held ones, and
// the other sport's held rivals), each with the record, quoted price and
// eligibility it was judged on; the exposure it saw (weekly, open, per game,
// reserved by the same send); which games were final at that moment; and
// the stakes the live allocator set. Nothing is filled in later.
//
// A replay walks those decisions in order and runs the real allocator for
// one sizing policy, holding everything else fixed (eligibility, selection,
// prices, timing, limits). Each policy carries its OWN portfolio forward:
// its exposure at a decision is what was actually on the books, minus the
// live stakes made inside the replay window, plus the policy's own stakes,
// with a stake still open if its game was not final as known then. Before
// the window both policies share the real history. Games a policy did not
// take score zero.
//
// Two checks keep it honest. Replaying the live sizing must reproduce the
// stakes each decision actually set (a changed allocator, a revised rule or
// a bad record breaks this), and every confirmed staked send must match a
// recorded decision. Any gap restarts the sample after it: a shorter sample,
// never a filled-in one.

import { allocate, type Exposure } from "../allocate";
import { grade } from "../engine";
import { MIN_STAKE } from "../limits";
import type { League } from "../parse";
import type { StakingPolicy } from "../policy";
import { kelly, shrunk, stakeFor } from "../staking";
import { gradeTotal } from "../totals";
import { payout } from "../units";
import type { IssuedRecord } from "../issued";

/** One eligible bet as judged at decision time. Everything sizing needs; nothing learned later. */
export interface CandidateInfo {
  league: League;
  week: number;
  /** Engine key (week:away@home), for finals and settlement. */
  key: string;
  kind: "ats" | "ou";
  side: "home" | "away" | "over" | "under";
  /** Home spread or game total, as quoted. */
  line: number;
  /** American price quoted at the decision. */
  price: number;
  /** The tier (or totals rule) record the estimate came from. */
  rec: { w: number; l: number; activated?: boolean };
  /** Passed the fixed bet/pass gate at that price. */
  eligible: boolean;
  kickoff?: string;
  /** Held for a later game day (hold.ts): reserves room, never issued at this send. */
  held: boolean;
}

export interface SizingCandidate extends CandidateInfo {
  /** Allocator id ("ats:6:A@H", "rival:ou:nfl:A@H"). */
  id: string;
  /** Allocator game key (per-game cap scope). */
  game: string;
  /** The other sport's held play: competes for room, never this send's bet. */
  rival: boolean;
  /** Would have gone out in this send with a stake: released, on today's date, not already bet. */
  issuable: boolean;
}

export interface DecisionRecord {
  v: 1;
  at: string;
  /** The send's idempotency key; issued records carry the same one. */
  sendKey: string;
  league: League;
  season: number;
  week: number;
  /** NFL-numbered calendar week (college weeks run one ahead): the weekly budget's scope. */
  calWeek: number;
  /** Order inside one send: NFL 0, college 1 (college sees NFL's stakes as reserved). */
  order: number;
  policyId: string;
  staking: StakingPolicy;
  exposure: { weekly: number; outstanding: number; reserved: number; perGame: [string, number][] };
  candidates: SizingCandidate[];
  /** Stakes the live allocator set, by candidate id (absent: none). */
  live: { [id: string]: number };
  /** "league:key" the live exposure treated as settled. */
  settled: string[];
  /** "league:key" of every recent game final at the decision, both sports. */
  finalsKnown: string[];
}

/**
 * A send's decision from a composed report's sizing. A candidate is
 * issuable when this send would have bet it with a stake: this sport's own,
 * released (not held), kicking off on the send's date. Already-bet games
 * were never candidates.
 */
export function toDecision(
  r: { league: League; season: number; week: number | null; policy: { id: string; staking?: StakingPolicy }; sizing: { candidates: Omit<SizingCandidate, "issuable">[]; exposure: DecisionRecord["exposure"]; live: { [id: string]: number }; settled: string[] } },
  meta: { at: string; sendKey: string; order: number; onSendDate: (kickoff?: string) => boolean; finalsKnown: string[] },
): DecisionRecord | null {
  if (r.week === null || !r.policy.staking) return null;
  return {
    v: 1,
    at: meta.at,
    sendKey: meta.sendKey,
    league: r.league,
    season: r.season,
    week: r.week,
    calWeek: r.week - (r.league === "cfb" ? 1 : 0),
    order: meta.order,
    policyId: r.policy.id,
    staking: r.policy.staking,
    exposure: r.sizing.exposure,
    candidates: r.sizing.candidates.map((c) => ({ ...c, issuable: !c.rival && !c.held && meta.onSendDate(c.kickoff) })),
    live: r.sizing.live,
    settled: r.sizing.settled,
    finalsKnown: meta.finalsKnown,
  };
}

/** What a policy wants for a candidate: the same formulas compose.ts uses. */
export function sizeFor(c: CandidateInfo, staking: StakingPolicy): { want: number; priority: number } {
  const p = shrunk(c.rec.w, c.rec.l, staking.priorGames);
  const sized = c.eligible ? stakeFor(p, c.price, staking) : 0;
  return { want: c.rec.activated ? Math.min(sized, MIN_STAKE) : sized, priority: kelly(p, c.price) };
}

export interface Commit {
  d: DecisionRecord;
  c: SizingCandidate;
  stake: number;
}

export interface Run {
  d: DecisionRecord;
  stakes: Map<string, number>;
  /** Issuable candidates the policy wanted (1u+) that the limits refused outright. */
  refused: Set<string>;
  /** Issuable candidates the limits cut below the policy's want. */
  cut: Set<string>;
}

/** Weeks back a decision's settled and finals lists reach (report.ts recentKeys uses the same). */
export const SETTLED_HORIZON_WEEKS = 3;

/**
 * "league:week:away@home" keys from the last few weeks (either sport's
 * numbering), so a recorded decision stays small. Bets older than that are
 * long settled (replay() treats them so).
 */
export function recentKeys(keys: string[], week: number | null): string[] {
  if (week === null) return [];
  return keys.filter((k) => Number(k.split(":")[1]) >= week - SETTLED_HORIZON_WEEKS).sort();
}

const r6 = (x: number) => Math.round(x * 1e6) / 1e6;
const gk = (c: { league: League; key: string }) => `${c.league}:${c.key}`;
const sortDecisions = (ds: DecisionRecord[]) => ds.slice().sort((a, b) => a.at.localeCompare(b.at) || a.order - b.order);

/** The latest attempt per send and sport (an earlier one never shipped, or was superseded). */
export function latestDecisions(ds: DecisionRecord[]): DecisionRecord[] {
  const by = new Map<string, DecisionRecord>();
  for (const d of ds) {
    const k = `${d.sendKey}|${d.league}`;
    const cur = by.get(k);
    if (!cur || d.at > cur.at) by.set(k, d);
  }
  return [...by.values()];
}

/**
 * Mornings with no record at all. Daily sends are keyed "picks-day:YYYY-MM-DD";
 * every ET date from `since` through the latest recorded morning should have
 * a day marker. A missing one is a gap at the end of that day.
 */
export function missingDays(days: string[], since: string): Gap[] {
  const dates = new Set(days.flatMap((k) => (k.startsWith("picks-day:") ? [k.slice("picks-day:".length)] : [])));
  const latest = [...dates].sort().pop();
  if (!latest) return [];
  const gaps: Gap[] = [];
  // Start from the first marker on or after `since`: earlier days predate recording.
  const first = [...dates].filter((x) => x >= since.slice(0, 10)).sort()[0] ?? latest;
  for (let t = Date.parse(`${first}T12:00:00Z`); t <= Date.parse(`${latest}T12:00:00Z`); t += 86400000) {
    const date = new Date(t).toISOString().slice(0, 10);
    if (!dates.has(date)) gaps.push({ at: `${date}T23:59:59Z`, why: `no 9am decision recorded for ${date}` });
  }
  return gaps;
}

/** The stakes the live allocator committed: issuable candidates it staked. */
export function liveCommits(ds: DecisionRecord[]): Commit[] {
  return ds.flatMap((d) => d.candidates.filter((c) => c.issuable && !c.rival && (d.live[c.id] ?? 0) > 0).map((c) => ({ d, c, stake: d.live[c.id] })));
}

/**
 * Replays decisions (already in the window) for one sizing, carrying the
 * policy's own portfolio forward. `stakingOf` picks the sizing per decision:
 * a fixed policy for a challenger, or each decision's own for the live check.
 */
export function replay(decisions: DecisionRecord[], stakingOf: (d: DecisionRecord) => StakingPolicy): Run[] {
  const ds = sortDecisions(decisions);
  const live = liveCommits(ds);
  const liveGames = new Set(live.map((x) => gk(x.c)));
  const mine: Commit[] = [];
  const taken = new Set<string>();
  const runs: Run[] = [];
  // Once a game is final as known at some decision, it stays final.
  const finalSoFar = new Set<string>();
  ds.forEach((d, idx) => {
    // Settled as the live system knew it: its own settled set for games it
    // bet, and the finals on file for games only the replayed policy bet.
    for (const k of d.settled) finalSoFar.add(`live|${k}`);
    for (const k of d.finalsKnown) finalSoFar.add(`any|${k}`);
    // A game the live policy bet is settled exactly as the live exposure had
    // it (its settled list covers every issued game). A game only the replay
    // bet is settled by the finals known then; those lists reach back
    // SETTLED_HORIZON_WEEKS, and anything older is long final.
    const aged = (x: Commit) => x.c.week < d.week - SETTLED_HORIZON_WEEKS;
    const open = (x: Commit) =>
      liveGames.has(gk(x.c)) ? !finalSoFar.has(`live|${gk(x.c)}`) : !(aged(x) || finalSoFar.has(`any|${gk(x.c)}`));
    // Earlier sends are on the books; earlier parts of this send are `reserved`.
    const before = (list: Commit[]) => list.filter((x) => x.d.sendKey !== d.sendKey && ds.indexOf(x.d) < idx);
    const sameSend = (x: Commit) => x.d.sendKey === d.sendKey && x.d.order < d.order;
    const lp = before(live);
    const mp = before(mine);
    const sum = (list: Commit[], f: (x: Commit) => boolean) => list.filter(f).reduce((t, x) => t + x.stake, 0);
    const thisWeek = (x: Commit) => x.d.calWeek === d.calWeek;
    const sameGame = (x: Commit) => x.c.league === d.league && x.c.week === d.week;
    const perGame = new Map(d.exposure.perGame);
    for (const x of lp.filter(sameGame)) perGame.set(x.c.game, r6((perGame.get(x.c.game) ?? 0) - x.stake));
    for (const x of mp.filter(sameGame)) perGame.set(x.c.game, r6((perGame.get(x.c.game) ?? 0) + x.stake));
    const ex: Exposure = {
      weekly: r6(d.exposure.weekly - sum(lp, thisWeek) + sum(mp, thisWeek)),
      outstanding: r6(d.exposure.outstanding - sum(lp, open) + sum(mp, open)),
      reserved: r6(d.exposure.reserved - sum(live, sameSend) + sum(mine, sameSend)),
      perGame,
    };
    const staking = stakingOf(d);
    const cands = d.candidates.filter((c) => !taken.has(c.id));
    const wants = new Map(cands.map((c) => [c.id, sizeFor(c, staking)]));
    const a = allocate(cands.map((c) => ({ id: c.id, game: c.game, ...wants.get(c.id)! })), ex);
    const refused = new Set<string>();
    const cut = new Set<string>();
    for (const c of cands.filter((y) => y.issuable && !y.rival)) {
      const want = wants.get(c.id)!.want;
      const s = a.stakes.get(c.id) ?? 0;
      if (want >= MIN_STAKE && s === 0) refused.add(c.id);
      else if (s > 0 && s < want) cut.add(c.id);
      if (s > 0) {
        mine.push({ d, c, stake: s });
        taken.add(c.id);
      }
    }
    runs.push({ d, stakes: a.stakes, refused, cut });
  });
  return runs;
}

// ------------------------------------------------------------------ evidence

export interface Gap {
  at: string;
  why: string;
}

const day = (iso: string) => iso.slice(0, 10);

/** Does replaying each decision's own sizing reproduce the stakes it set? */
export function reproductionGaps(ds: DecisionRecord[]): Gap[] {
  return replay(ds, (d) => d.staking).flatMap(({ d, stakes }) => {
    const ids = new Set([...Object.keys(d.live), ...stakes.keys()]);
    const off = [...ids].filter((id) => Math.abs((stakes.get(id) ?? 0) - (d.live[id] ?? 0)) > 1e-9);
    return off.length ? [{ at: d.at, why: `replaying the live sizing for ${d.league.toUpperCase()} on ${day(d.at)} did not reproduce ${off.length} of its stakes` }] : [];
  });
}

/** Every confirmed staked send has a matching decision, and every decided bet was confirmed sent. */
export function coverageGaps(ds: DecisionRecord[], issued: { league: League; records: IssuedRecord[] }[], since: string): Gap[] {
  const gaps: Gap[] = [];
  const bySend = new Map(ds.map((d) => [`${d.sendKey}|${d.league}`, d]));
  const matched = new Set<string>();
  for (const { league, records } of issued) {
    for (const rec of records.filter((r) => r.issuedAt >= since)) {
      const staked = [
        ...rec.plays.filter((p) => p.shownInEmail && p.units).map((p) => ({ id: `ats:${rec.week}:${p.away}@${p.home}`, units: p.units!, side: p.side as string, line: p.homeLine, price: p.price })),
        ...(rec.totals ?? []).filter((p) => p.shownInEmail && p.units).map((p) => ({ id: `ou:${rec.week}:${p.away}@${p.home}`, units: p.units!, side: p.side as string, line: p.line, price: p.price })),
      ];
      if (!staked.length) continue;
      const label = `${league.toUpperCase()} send on ${day(rec.issuedAt)}`;
      if (rec.status === "pending" || rec.status === "unconfirmed") {
        gaps.push({ at: rec.issuedAt, why: `${label} is ${rec.status}: its bets are exposure without a confirmed result` });
        continue;
      }
      const d = rec.idempotencyKey ? bySend.get(`${rec.idempotencyKey}|${league}`) : undefined;
      if (!d) {
        gaps.push({ at: rec.issuedAt, why: `${label} has no recorded decision (candidates and exposure unknown)` });
        continue;
      }
      matched.add(`${d.sendKey}|${d.league}`);
      // The whole wager, not just its size: side, line, price and units.
      const committed = new Map(liveCommits([d]).map((x) => [x.c.id, x]));
      const same =
        staked.length === committed.size &&
        staked.every((s) => {
          const x = committed.get(s.id);
          return !!x && Math.abs(x.stake - s.units) < 1e-9 && x.c.side === s.side && x.c.line === s.line && x.c.price === s.price;
        });
      if (!same) gaps.push({ at: rec.issuedAt, why: `${label}: the bets sent don't match the recorded decision` });
    }
  }
  for (const d of ds.filter((x) => x.at >= since && !matched.has(`${x.sendKey}|${x.league}`))) {
    if (liveCommits([d]).length) gaps.push({ at: d.at, why: `${d.league.toUpperCase()} bets decided on ${day(d.at)} were never confirmed sent` });
  }
  return gaps.sort((a, b) => a.at.localeCompare(b.at));
}

/** One opportunity both policies saw, scored after the fact. Skipped is zero. */
export interface SizingPair {
  at: string;
  calWeek: number;
  id: string;
  ch: { stake: number; units: number };
  inc: { stake: number; units: number };
}

export interface SizingEvidence {
  /** Start of the usable sample (after registration, recording and the last gap). */
  since: string | null;
  decisions: number;
  /** Gaps found since registration; the sample restarts after the last one. */
  gaps: Gap[];
  /** Settled opportunities where either policy bet. */
  pairs: SizingPair[];
  /** Bets either policy made whose games aren't final yet. Their whole calendar week waits. */
  unsettled: number;
  /** Calendar weeks left out until every replayed bet in them is final. */
  pendingWeeks: number[];
  /** The challenger wanted more than the incumbent on at least one bet (calibration gate). */
  sizesUp: boolean;
  /** Bets each policy wanted that the limits refused outright, or cut. */
  refused: { challenger: number; incumbent: number };
  cut: { challenger: number; incumbent: number };
}

/**
 * The sizing comparison for a challenger against the incumbent, from
 * `since` (registration, or a policy's activation).
 */
export function sizingEvidence(
  all: DecisionRecord[],
  issued: { league: League; records: IssuedRecord[] }[],
  finals: { league: League; map: Map<string, { home: number; away: number }> }[],
  x: { challenger: StakingPolicy; incumbent: StakingPolicy; since: string; days?: string[] },
): SizingEvidence {
  const inScope = sortDecisions(all.filter((d) => d.at >= x.since));
  const gaps = [...coverageGaps(inScope, issued, x.since), ...reproductionGaps(inScope), ...(x.days ? missingDays(x.days, x.since) : [])].sort((a, b) =>
    a.at.localeCompare(b.at),
  );
  const last = gaps[gaps.length - 1];
  const ds = last ? inScope.filter((d) => d.at > last.at) : inScope;
  const ch = replay(ds, () => x.challenger);
  const inc = replay(ds, () => x.incumbent);
  let pairs: SizingPair[] = [];
  let unsettled = 0;
  let sizesUp = false;
  const pending = new Set<number>();
  ds.forEach((d, i) => {
    const f = finals.find((m) => m.league === d.league)?.map;
    for (const c of d.candidates) if (sizeFor(c, x.challenger).want > sizeFor(c, x.incumbent).want) sizesUp = true;
    for (const c of d.candidates.filter((y) => y.issuable && !y.rival)) {
      const a = ch[i].stakes.get(c.id) ?? 0;
      const b = inc[i].stakes.get(c.id) ?? 0;
      if (!a && !b) continue;
      const fin = f?.get(c.key);
      if (!fin) {
        unsettled++;
        pending.add(d.calWeek);
        continue;
      }
      const res = c.kind === "ats" ? grade(fin, c.line, c.side as "home" | "away") : gradeTotal(fin.home + fin.away, c.line, c.side as "over" | "under");
      pairs.push({ at: d.at, calWeek: d.calWeek, id: c.id, ch: { stake: a, units: payout(res, a, c.price) }, inc: { stake: b, units: payout(res, b, c.price) } });
    }
  });
  // A week's budget ties its bets together: score it only once all are final.
  pairs = pairs.filter((p) => !pending.has(p.calWeek));
  const count = (runs: Run[], k: "refused" | "cut") => runs.reduce((t, r) => t + r[k].size, 0);
  return {
    since: ds[0]?.at ?? null,
    decisions: ds.length,
    gaps,
    pairs,
    unsettled,
    pendingWeeks: [...pending].sort((a, b) => a - b),
    sizesUp,
    refused: { challenger: count(ch, "refused"), incumbent: count(inc, "refused") },
    cut: { challenger: count(ch, "cut"), incumbent: count(inc, "cut") },
  };
}
