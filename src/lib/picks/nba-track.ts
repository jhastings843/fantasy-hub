// NBA picks, tracked the way NFL and College are (pure half; Redis and
// fetching live in nba-track-store.ts).
//
// Two models (Sam, and David Sasser from 2026-11-09) against DraftKings, each
// graded on his own side at the same saved DK line and price, on equal footing
// (David's core cuts are rule candidates like Sam's). Each game's read is saved before tip
// (first and latest pregame copy), graded from ESPN's final, and sliced into
// cuts. "The rule" is chosen exactly as the football rule is (engine.ts):
// a cut with MIN_SAMPLE+ decided games and a rate past BREAK_EVEN, ranked by
// the low end of its 90% Wilson range; tier 2 is the best other candidate
// judged only on the games it adds. Research cuts can only become candidates
// through the learning review, under the football CRITERIA
// (learning/model.ts): 30+ settled matched games over 3+ weeks and a paired
// one-sided t of 1.645 or better against the parent cut, counted only on
// games first seen after the hypothesis was registered; rolled back when it
// trails its parent on 20+ games at t <= -1.645.
//
// NBA is NOT staked yet (Jack, 2026-10-19). It goes live only when the gate
// below clears, and then under its own limits, separate from football's 30u.
//
// Lines are home-side (negative: home favored), like the rest of Picks.

import { BREAK_EVEN, MIN_SAMPLE, tally, type Result } from "./engine";
import { type Splits, readMarket } from "./splits";
import { CRITERIA } from "./learning/model";
import { samSpreadSide } from "./nba";

export type NbaMarket = "ats" | "su" | "ou";

/** One pregame read: DraftKings' numbers and Sam's and David's at that moment. */
export interface NbaSnap {
  at: string;
  line?: number;
  homePrice?: number;
  awayPrice?: number;
  total?: number;
  overPrice?: number;
  underPrice?: number;
  mlHome?: number;
  mlAway?: number;
  /** Sam's home line. Missing on a copy saved when only David had posted (from 2026-11-09). */
  model?: number;
  /** The home line Sam's page posted beside his model; his side is taken against it. Missing on copies saved before 2026-10-21. */
  samLine?: number;
  modelTotal?: number;
  /** David's home line, the DK home line his page posted beside it, and his total (from 2026-11-09). */
  david?: { model: number; line?: number; total?: number };
  /** Public betting splits and the opening line at this read (splits.ts), when the feed had the game. */
  splits?: Splits;
}

export interface NbaTracked {
  /** Units staked, set only once NBA is live, frozen at the last pregame copy. Counts toward the running window. */
  stake?: number;
  /** ESPN event id. */
  id: string;
  /** Eastern game date, YYYYMMDD. */
  day: string;
  /** Monday-to-Sunday week of the season (props/parse nbaWeek). */
  week: number;
  tip: string;
  home: string;
  away: string;
  first: NbaSnap;
  last: NbaSnap;
  final?: { home: number; away: number };
  /** Our own NBA game model's last pregame read (models/nba/game-store.ts), joined at load. Home spread and total. */
  ours?: { spread: number; total: number };
}

export interface NbaBet {
  /** Whose bet: David's, or Sam's when missing (every copy saved before 2026-11-09 is Sam's). */
  by?: "david";
  market: NbaMarket;
  side: "home" | "away" | "over" | "under";
  /** The number bet: the side's spread, the total, or 0 straight up. */
  line: number;
  price?: number;
  /** Points between Sam and DraftKings on that side; negative when DK has crossed his number. */
  edge: number;
  /** Spread only: Sam's posted side, but DraftKings has moved through his model. */
  crossed?: boolean;
  /** Sam's side is the underdog (spread or moneyline). */
  dog: boolean;
  result?: Result;
  /** Units on 1u risked at the saved price (-110 when none was saved). */
  net?: number;
  /** Spread only, when the last pregame copy had public splits: which market signals point against this bet (splits.ts). */
  mkt?: { rlmAgainst: boolean; publicOurs: boolean; sharpAgainst: boolean };
  /** Spread and total: our own game model on Sam's side or against it, when we saved a read (consensus research, 2026-11-04). */
  ours?: "agree" | "disagree";
  /** Sam's bets only: David on the same side or the other, when the copy saved David's read (2026-11-09). */
  david?: "agree" | "disagree";
}

const payout = (p?: number) => (p === undefined ? 100 / 110 : p > 0 ? p / 100 : 100 / -p);
const r1 = (x: number) => Math.round(x * 10) / 10;

/** Sam's bets on a game from its latest pregame copy (the copy that counts, as in football's rowsFromForecasts). */
export function nbaBets(g: NbaTracked): NbaBet[] {
  const s = g.last;
  const out: NbaBet[] = [];
  if (s.model === undefined) return out;
  const d = s.david;
  const dAts = d && s.line !== undefined && (s.line !== d.model || (d.line !== undefined && d.line !== d.model)) ? samSpreadSide(s.line, d.model, d.line).side : undefined;
  const dOver = d?.total !== undefined && s.total !== undefined && d.total !== s.total ? d.total > s.total : undefined;
  if (s.line !== undefined && (s.line !== s.model || (s.samLine !== undefined && s.samLine !== s.model))) {
    const { side, edge, crossed } = samSpreadSide(s.line, s.model, s.samLine);
    const home = side === "home";
    const m = s.splits && readMarket("nba", s.splits, s.line);
    const mkt = m ? { rlmAgainst: !!m.rlm && m.rlm !== side, publicOurs: m.publicSide === side, sharpAgainst: !!m.sharpSide && m.sharpSide !== side } : undefined;
    const ourSide = g.ours && g.ours.spread !== s.line ? (g.ours.spread < s.line ? "home" : "away") : undefined;
    out.push({ market: "ats", side, line: home ? s.line : -s.line, price: home ? s.homePrice : s.awayPrice, edge: r1(edge), crossed, dog: home ? s.line > 0 : s.line < 0, ...(mkt ? { mkt } : {}), ...(ourSide ? { ours: ourSide === side ? ("agree" as const) : ("disagree" as const) } : {}), ...(dAts ? { david: dAts === side ? ("agree" as const) : ("disagree" as const) } : {}) });
  }
  if (s.model !== 0) {
    const home = s.model < 0;
    const fav = s.line === undefined ? null : s.line < 0 ? "home" : s.line > 0 ? "away" : null;
    out.push({ market: "su", side: home ? "home" : "away", line: 0, price: home ? s.mlHome : s.mlAway, edge: r1(Math.abs(s.model)), dog: fav !== null && fav !== (home ? "home" : "away") });
  }
  if (s.total !== undefined && s.modelTotal !== undefined && s.modelTotal !== s.total) {
    const over = s.modelTotal > s.total;
    const ourOver = g.ours && g.ours.total !== s.total ? g.ours.total > s.total : undefined;
    out.push({ market: "ou", side: over ? "over" : "under", line: s.total, price: over ? s.overPrice : s.underPrice, edge: r1(Math.abs(s.modelTotal - s.total)), dog: false, ...(ourOver !== undefined ? { ours: ourOver === over ? ("agree" as const) : ("disagree" as const) } : {}), ...(dOver !== undefined ? { david: dOver === over ? ("agree" as const) : ("disagree" as const) } : {}) });
  }
  return g.final ? out.map((b) => settleNba(b, g.final!)) : out;
}

/**
 * David's bets on a game from the same latest pregame copy, built exactly as
 * Sam's are: his side from his own posted line (samSpreadSide), graded at the
 * saved DraftKings line and price. Tagged by: "david".
 */
export function davidBets(g: NbaTracked): NbaBet[] {
  const s = g.last;
  const d = s.david;
  if (!d) return [];
  const out: NbaBet[] = [];
  if (s.line !== undefined && (s.line !== d.model || (d.line !== undefined && d.line !== d.model))) {
    const { side, edge, crossed } = samSpreadSide(s.line, d.model, d.line);
    const home = side === "home";
    out.push({ by: "david", market: "ats", side, line: home ? s.line : -s.line, price: home ? s.homePrice : s.awayPrice, edge: r1(edge), crossed, dog: home ? s.line > 0 : s.line < 0 });
  }
  if (d.model !== 0) {
    const home = d.model < 0;
    const fav = s.line === undefined ? null : s.line < 0 ? "home" : s.line > 0 ? "away" : null;
    out.push({ by: "david", market: "su", side: home ? "home" : "away", line: 0, price: home ? s.mlHome : s.mlAway, edge: r1(Math.abs(d.model)), dog: fav !== null && fav !== (home ? "home" : "away") });
  }
  if (s.total !== undefined && d.total !== undefined && d.total !== s.total) {
    const over = d.total > s.total;
    out.push({ by: "david", market: "ou", side: over ? "over" : "under", line: s.total, price: over ? s.overPrice : s.underPrice, edge: r1(Math.abs(d.total - s.total)), dog: false });
  }
  return g.final ? out.map((b) => settleNba(b, g.final!)) : out;
}

/** Sam's bets then David's: what the record, the cuts and the rule are built from. */
export const nbaAllBets = (g: NbaTracked): NbaBet[] => [...nbaBets(g), ...davidBets(g)];

export function settleNba(b: NbaBet, f: { home: number; away: number }): NbaBet {
  let x: number;
  if (b.market === "ou") x = b.side === "over" ? f.home + f.away - b.line : b.line - (f.home + f.away);
  else {
    const margin = b.side === "home" ? f.home - f.away : f.away - f.home;
    x = b.market === "ats" ? margin + b.line : margin;
  }
  const result: Result = x > 0 ? "W" : x < 0 ? "L" : "P";
  return { ...b, result, net: result === "W" ? Math.round(payout(b.price) * 1000) / 1000 : result === "L" ? -1 : 0 };
}

/* ------------------------------------------------------------------ cuts -- */

export interface NbaCut {
  id: string;
  market: NbaMarket;
  label: string;
  /** Research cuts are candidates for the rule only once the review activates them. */
  research?: { parent: string };
  /** Tested by the review but never activated by it: a person decides (the market signals, 2026-10-21). */
  reportOnly?: true;
  /** Whose bets the cut reads: David's, or Sam's when missing. */
  by?: "david";
  test: (b: NbaBet) => boolean;
}

/** A cut takes a bet only in its market and only from its own model. */
export const applies = (c: NbaCut, b: NbaBet) => b.market === c.market && (b.by ?? "sam") === (c.by ?? "sam") && c.test(b);

const absLine = (b: NbaBet) => Math.abs(b.line);

export const NBA_CUTS: NbaCut[] = [
  { id: "ats:all", market: "ats", label: "Every Sam side", test: () => true },
  { id: "ats:edge1", market: "ats", label: "Sam's edge 1+ pts", test: (b) => b.edge >= 1 },
  { id: "ats:edge2", market: "ats", label: "Sam's edge 2+ pts", test: (b) => b.edge >= 2 },
  { id: "ats:edge3", market: "ats", label: "Sam's edge 3+ pts", test: (b) => b.edge >= 3 },
  { id: "ats:edge4", market: "ats", label: "Sam's edge 4+ pts", test: (b) => b.edge >= 4 },
  { id: "ats:dog", market: "ats", label: "Sam on the underdog", test: (b) => b.dog },
  { id: "ats:fav", market: "ats", label: "Sam on the favorite", test: (b) => !b.dog && b.line !== 0 },
  { id: "ats:home", market: "ats", label: "Sam on the home team", test: (b) => b.side === "home" },
  { id: "ats:road", market: "ats", label: "Sam on the road team", test: (b) => b.side === "away" },
  { id: "ats:small", market: "ats", label: "Spread under 5", research: { parent: "ats:all" }, test: (b) => absLine(b) < 5 },
  { id: "ats:mid", market: "ats", label: "Spread 5 to 9.5", research: { parent: "ats:all" }, test: (b) => absLine(b) >= 5 && absLine(b) < 10 },
  { id: "ats:big", market: "ats", label: "Spread 10+", research: { parent: "ats:all" }, test: (b) => absLine(b) >= 10 },
  { id: "ats:dog-edge2", market: "ats", label: "Underdog, edge 2+", research: { parent: "ats:dog" }, test: (b) => b.dog && b.edge >= 2 },
  { id: "ats:home-dog", market: "ats", label: "Home underdog", research: { parent: "ats:dog" }, test: (b) => b.dog && b.side === "home" },
  { id: "ats:fav-edge3", market: "ats", label: "Favorite, edge 3+", research: { parent: "ats:fav" }, test: (b) => !b.dog && b.line !== 0 && b.edge >= 3 },
  // Public betting and line moves: every Sam side, minus the ones a signal
  // flags. Games without splits bet the same as the parent. Report only.
  { id: "ats:mkt-rlm", market: "ats", label: "Skip reverse line moves against Sam", research: { parent: "ats:all" }, reportOnly: true, test: (b) => !b.mkt?.rlmAgainst },
  { id: "ats:mkt-public", market: "ats", label: "Skip when the public (65%+) is on Sam's side", research: { parent: "ats:all" }, reportOnly: true, test: (b) => !b.mkt?.publicOurs },
  { id: "ats:mkt-sharp", market: "ats", label: "Skip sharp money against Sam", research: { parent: "ats:all" }, reportOnly: true, test: (b) => !b.mkt?.sharpAgainst },
  // Consensus with our own game model (Jack, 2026-11-04): tracked research vs its parent.
  { id: "ats:ours-agree", market: "ats", label: "Sam and our model agree", research: { parent: "ats:all" }, test: (b) => b.ours === "agree" },
  { id: "ats:ours-disagree", market: "ats", label: "Sam's side, our model disagrees", research: { parent: "ats:all" }, test: (b) => b.ours === "disagree" },
  // Sam with David (2026-11-09): tracked research vs its parent, like our model's consensus.
  { id: "ats:david-agree", market: "ats", label: "Sam and David on the same side", research: { parent: "ats:all" }, test: (b) => b.david === "agree" },
  { id: "ats:david-disagree", market: "ats", label: "Sam's side, David on the other", research: { parent: "ats:all" }, test: (b) => b.david === "disagree" },
  // David's own record (Jack, 2026-11-09: "track like we do Sam"): core cuts, rule candidates like Sam's.
  { id: "ats:d-all", market: "ats", by: "david", label: "Every David side", test: () => true },
  { id: "ats:d-edge2", market: "ats", by: "david", label: "David's edge 2+ pts", test: (b) => b.edge >= 2 },
  { id: "ats:d-edge3", market: "ats", by: "david", label: "David's edge 3+ pts", test: (b) => b.edge >= 3 },
  { id: "ats:d-dog", market: "ats", by: "david", label: "David on the underdog", test: (b) => b.dog },
  { id: "ats:d-fav", market: "ats", by: "david", label: "David on the favorite", test: (b) => !b.dog && b.line !== 0 },
  { id: "ou:all", market: "ou", label: "Every Sam total", test: () => true },
  { id: "ou:david-agree", market: "ou", label: "Sam and David agree on the total", research: { parent: "ou:all" }, test: (b) => b.david === "agree" },
  { id: "ou:david-disagree", market: "ou", label: "Sam's total, David on the other side", research: { parent: "ou:all" }, test: (b) => b.david === "disagree" },
  { id: "ou:d-all", market: "ou", by: "david", label: "Every David total", test: () => true },
  { id: "ou:d-edge3", market: "ou", by: "david", label: "David's total edge 3+ pts", test: (b) => b.edge >= 3 },
  { id: "ou:d-edge5", market: "ou", by: "david", label: "David's total edge 5+ pts", test: (b) => b.edge >= 5 },
  { id: "ou:d-over", market: "ou", by: "david", label: "David on the over", test: (b) => b.side === "over" },
  { id: "ou:d-under", market: "ou", by: "david", label: "David on the under", test: (b) => b.side === "under" },
  { id: "ou:ours-agree", market: "ou", label: "Sam and our model agree on the total", research: { parent: "ou:all" }, test: (b) => b.ours === "agree" },
  { id: "ou:edge3", market: "ou", label: "Total edge 3+ pts", test: (b) => b.edge >= 3 },
  { id: "ou:edge5", market: "ou", label: "Total edge 5+ pts", test: (b) => b.edge >= 5 },
  { id: "ou:over", market: "ou", label: "Sam on the over", test: (b) => b.side === "over" },
  { id: "ou:under", market: "ou", label: "Sam on the under", test: (b) => b.side === "under" },
  { id: "ou:under-edge5", market: "ou", label: "Under, edge 5+", research: { parent: "ou:under" }, test: (b) => b.side === "under" && b.edge >= 5 },
  { id: "su:all", market: "su", label: "Sam's winner, every game", test: () => true },
  { id: "su:dog", market: "su", label: "Sam picks the underdog to win", test: (b) => b.dog },
  { id: "su:fav", market: "su", label: "Sam picks the favorite", test: (b) => !b.dog },
  { id: "su:d-all", market: "su", by: "david", label: "David's winner, every game", test: () => true },
];
export const NBA_CUT = new Map(NBA_CUTS.map((c) => [c.id, c]));

export interface NbaCutRecord {
  id: string;
  label: string;
  market: NbaMarket;
  research: boolean;
  /** David's cut (else Sam's). */
  david: boolean;
  w: number;
  l: number;
  p: number;
  pct: number;
  lo: number;
  hi: number;
  /** Units at the saved prices. */
  units: number;
  weeks: number;
}

export interface NbaRow {
  game: NbaTracked;
  bet: NbaBet;
}

/** Every settled bet, one row per game, market and model. */
export function settledRows(games: NbaTracked[]): NbaRow[] {
  return games.flatMap((g) => (g.final ? nbaAllBets(g).filter((b) => b.result).map((bet) => ({ game: g, bet })) : []));
}

export function cutRecord(cut: NbaCut, rows: NbaRow[]): NbaCutRecord {
  const hit = rows.filter((r) => applies(cut, r.bet));
  const t = tally(hit.map((r) => r.bet.result!));
  return {
    id: cut.id,
    label: cut.label,
    market: cut.market,
    research: !!cut.research,
    david: cut.by === "david",
    w: t.w,
    l: t.l,
    p: t.p,
    pct: t.pct,
    lo: t.lo,
    hi: t.hi,
    units: Math.round(hit.reduce((a, r) => a + (r.bet.net ?? 0), 0) * 100) / 100,
    weeks: new Set(hit.map((r) => r.game.week)).size,
  };
}

/* ------------------------------------------------------------------ rule -- */

export interface NbaRule {
  market: "ats" | "ou";
  tier1: NbaCutRecord | null;
  tier2: NbaCutRecord | null;
}

const qualifies = (r: NbaCutRecord) => r.w + r.l >= MIN_SAMPLE && r.pct > BREAK_EVEN;
const rank = (a: NbaCutRecord, b: NbaCutRecord) => b.lo - a.lo || b.w + b.l - (a.w + a.l);

/** The football rule, on NBA cuts: candidates are core cuts plus research cuts the review activated. */
export function nbaRule(rows: NbaRow[], market: "ats" | "ou", activated: string[]): NbaRule {
  const pool = NBA_CUTS.filter((c) => c.market === market && (!c.research || activated.includes(c.id)));
  const recs = pool.map((c) => cutRecord(c, rows)).filter(qualifies).sort(rank);
  const tier1 = recs[0] ?? null;
  if (!tier1) return { market, tier1: null, tier2: null };
  // Tier 2: judged only on the games tier 1 doesn't already take.
  const t1 = NBA_CUT.get(tier1.id)!;
  // A game tier 1 bets (either model) is taken, for both models' rows.
  const taken = new Set(rows.filter((r) => applies(t1, r.bet)).map((r) => r.game.id));
  const rest = rows.filter((r) => !(r.bet.market === market && taken.has(r.game.id)));
  const second = pool
    .filter((c) => c.id !== tier1.id)
    .map((c) => ({ ...cutRecord(c, rest), id: c.id }))
    .filter(qualifies)
    .sort(rank)[0];
  return { market, tier1, tier2: second ?? null };
}

/** Which tier (if any) an unsettled bet falls in. */
export function tierOf(b: NbaBet, rule: NbaRule): 1 | 2 | null {
  if (b.market !== rule.market) return null;
  if (rule.tier1 && applies(NBA_CUT.get(rule.tier1.id)!, b)) return 1;
  if (rule.tier2 && applies(NBA_CUT.get(rule.tier2.id)!, b)) return 2;
  return null;
}

/* ---------------------------------------------------- go-live and limits -- */

/**
 * When NBA bets start carrying stakes (set 2026-10-19, before any NBA record
 * existed). All four must hold for the spread rule's tier 1:
 */
export const NBA_GO_LIVE = {
  /** Decided games in the tier-1 cut. Football's rule needs 10; this is ten times that. */
  MIN_GAMES: 100,
  /** Distinct weeks they come from. */
  MIN_WEEKS: 4,
  /** The low end of the 90% Wilson range must clear the -110 break-even. */
  MIN_LOW: BREAK_EVEN,
  /** And it must be ahead at the prices actually saved. */
  MIN_UNITS: 0,
} as const;

/**
 * NBA's own envelope once live, separate from football's: nothing here
 * counts against the 30u weekly or outstanding caps, and football never
 * counts against these.
 *
 * The 10u is a RUNNING week (Jack, 2026-10-19), not Monday to Sunday: at most
 * WINDOW_UNITS staked on games in any WINDOW_DAYS days, so a bet's units come
 * back a week after its game instead of all at once on Monday. DAILY caps a
 * single day, so a busy Tuesday can't spend what a strong Sunday needs.
 */
export const NBA_LIMITS = {
  MIN_STAKE: 1, // a cutoff: anything sizing under 1u is not a bet
  MAX_STAKE: 3,
  PER_GAME: 3,
  WINDOW_UNITS: 10,
  WINDOW_DAYS: 7,
  DAILY: 4,
  KELLY: 0.25,
  /** Tier record pulled toward 50% over this many games, as football's p1 does. */
  SHRINK_GAMES: 100,
} as const;

export interface NbaGate {
  live: boolean;
  checks: { label: string; have: string; need: string; ok: boolean }[];
}

export function nbaGate(rule: NbaRule): NbaGate {
  const t = rule.tier1;
  const n = t ? t.w + t.l : 0;
  const checks = [
    { label: "Decided games in the spread rule's tier 1", have: `${n}`, need: `${NBA_GO_LIVE.MIN_GAMES}+`, ok: n >= NBA_GO_LIVE.MIN_GAMES },
    { label: "Weeks they come from", have: `${t?.weeks ?? 0}`, need: `${NBA_GO_LIVE.MIN_WEEKS}+`, ok: (t?.weeks ?? 0) >= NBA_GO_LIVE.MIN_WEEKS },
    {
      label: "Low end of its 90% range",
      have: t ? `${(t.lo * 100).toFixed(1)}%` : "none",
      need: `over ${(NBA_GO_LIVE.MIN_LOW * 100).toFixed(1)}%`,
      ok: !!t && t.lo > NBA_GO_LIVE.MIN_LOW,
    },
    { label: "Units at the saved prices", have: t ? `${t.units >= 0 ? "+" : ""}${t.units.toFixed(1)}u` : "none", need: "above 0", ok: !!t && t.units > NBA_GO_LIVE.MIN_UNITS },
  ];
  return { live: checks.every((c) => c.ok), checks };
}

/** Quarter Kelly on the tier's shrunk record at the quoted price, inside NBA's own limits. Null: not a bet. */
export function nbaStake(tier: NbaCutRecord, price: number | undefined): number | null {
  if (price === undefined) return null;
  const n = tier.w + tier.l;
  const p = (tier.w + 0.5 * NBA_LIMITS.SHRINK_GAMES) / (n + NBA_LIMITS.SHRINK_GAMES);
  const b = payout(price);
  const f = (p * (b + 1) - 1) / b;
  const raw = f * NBA_LIMITS.KELLY * 100; // 1u = 1% of the bankroll
  if (raw < NBA_LIMITS.MIN_STAKE) return null;
  return Math.min(NBA_LIMITS.MAX_STAKE, NBA_LIMITS.PER_GAME, Math.floor(raw * 4) / 4);
}

/** YYYYMMDD plus or minus whole days. */
const shiftDay = (day: string, by: number) => {
  const d = new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(4, 6)) - 1, Number(day.slice(6, 8)) + by));
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
};

export interface NbaRoom {
  /** Units staked on games in the running window that ends with `day`, not counting `day` itself. */
  window: number;
  /** Units already staked on `day`. */
  today: number;
  /** What `day` can still take: the smaller of the daily and running-window room. */
  room: number;
  /** When the oldest stake in the window drops out (YYYYMMDD), if any. */
  frees: string | null;
}

/**
 * Room for one game day under the running window and the daily cap.
 * `placed` is every staked game; games in `reopen` (that day's not-yet-tipped
 * games, about to be re-allocated) don't count against it.
 */
export function nbaRoom(placed: { id: string; day: string; stake?: number }[], day: string, reopen: string[] = []): NbaRoom {
  const start = shiftDay(day, -(NBA_LIMITS.WINDOW_DAYS - 1));
  const staked = placed.filter((p) => (p.stake ?? 0) > 0 && !reopen.includes(p.id) && p.day >= start && p.day <= day);
  const window = staked.filter((p) => p.day < day).reduce((a, p) => a + p.stake!, 0);
  const today = staked.filter((p) => p.day === day).reduce((a, p) => a + p.stake!, 0);
  const oldest = staked.map((p) => p.day).sort()[0];
  return {
    window,
    today,
    room: Math.max(0, Math.min(NBA_LIMITS.DAILY - today, NBA_LIMITS.WINDOW_UNITS - window - today)),
    frees: oldest ? shiftDay(oldest, NBA_LIMITS.WINDOW_DAYS) : null,
  };
}

/**
 * One day's stakes inside the room: biggest edge first, each bet at most its
 * own Kelly stake, cut to quarter units; a bet the leftover room can't cover
 * at MIN_STAKE is dropped, never rounded up.
 */
export function allocateNbaDay(cands: { id: string; stake: number; edge: number }[], room: number): Map<string, number> {
  const out = new Map<string, number>();
  let left = room;
  for (const c of [...cands].sort((a, b) => b.edge - a.edge || a.id.localeCompare(b.id))) {
    const s = Math.floor(Math.min(c.stake, left) * 4) / 4;
    if (s < NBA_LIMITS.MIN_STAKE) continue;
    out.set(c.id, s);
    left -= s;
  }
  return out;
}

/* -------------------------------------------------------------- learning -- */

export interface NbaHypothesis {
  id: string; // the research cut's id
  parent: string;
  registeredAt: string;
  status: "collecting" | "active" | "rolled-back";
  activatedAt?: string;
  rolledBackAt?: string;
}

export interface NbaJournalEntry {
  at: string;
  kind: "register" | "review" | "activate" | "retain" | "rollback";
  text: string;
}

export interface NbaComparison {
  /** Matched opportunities: games first seen after registration where the parent or the challenger bets. */
  n: number;
  weeks: number;
  /** Mean per-game units, challenger minus parent. */
  mean: number;
  t: number | null;
}

/**
 * Challenger (research cut) vs its parent, paired per game on games that tip
 * after `since` (Jack, 2026-11-03; was games first seen after it): each
 * game's difference is the challenger's net (0 when it passes) minus the
 * parent's.
 */
export function compareCut(rows: NbaRow[], cutId: string, since: string): NbaComparison {
  const cut = NBA_CUT.get(cutId)!;
  const parent = NBA_CUT.get(cut.research!.parent)!;
  const d: number[] = [];
  const weeks = new Set<number>();
  for (const r of rows) {
    if (r.bet.market !== cut.market || Date.parse(r.game.tip || r.game.first.at) < Date.parse(since)) continue;
    const pBets = applies(parent, r.bet);
    const cBets = applies(cut, r.bet);
    if (!pBets && !cBets) continue;
    d.push((cBets ? r.bet.net ?? 0 : 0) - (pBets ? r.bet.net ?? 0 : 0));
    weeks.add(r.game.week);
  }
  const n = d.length;
  const mean = n ? d.reduce((a, b) => a + b, 0) / n : 0;
  const sd = n > 1 ? Math.sqrt(d.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : 0;
  return { n, weeks: weeks.size, mean: Math.round(mean * 1000) / 1000, t: n > 1 && sd > 0 ? Math.round((mean / (sd / Math.sqrt(n))) * 100) / 100 : null };
}

/** New hypotheses: every research cut not yet registered. Their sample starts now. */
export function registerNew(hyps: NbaHypothesis[], now: string): NbaHypothesis[] {
  const have = new Set(hyps.map((h) => h.id));
  return NBA_CUTS.filter((c) => c.research && !have.has(c.id)).map((c) => ({ id: c.id, parent: c.research!.parent, registeredAt: now, status: "collecting" as const }));
}

/**
 * One review: at most one activation per market (spreads, totals: the
 * strongest t that clears the criteria in each, as football does per part
 * since 2026-10-27), and a rollback for any active cut trailing its parent
 * since activation. Returns the new hypothesis states and journal entries.
 */
export function reviewNba(rows: NbaRow[], hyps: NbaHypothesis[], now: string): { hyps: NbaHypothesis[]; journal: NbaJournalEntry[] } {
  const journal: NbaJournalEntry[] = [];
  const next = hyps.map((h) => ({ ...h }));
  for (const h of next.filter((x) => x.status === "active")) {
    const c = compareCut(rows, h.id, h.activatedAt!);
    if (c.n >= CRITERIA.ROLLBACK_MIN_OPPORTUNITIES && c.t !== null && c.t <= -CRITERIA.MIN_T) {
      h.status = "rolled-back";
      h.rolledBackAt = now;
      journal.push({ at: now, kind: "rollback", text: `${NBA_CUT.get(h.id)!.label}: trailing ${NBA_CUT.get(h.parent)!.label} on ${c.n} games since it went in (t ${c.t}). Out of the rule.` });
    }
  }
  const ready = next
    .filter((h) => h.status === "collecting" && !NBA_CUT.get(h.id)?.reportOnly)
    .map((h) => ({ h, c: compareCut(rows, h.id, h.registeredAt) }))
    .filter(({ c }) => c.n >= CRITERIA.MIN_OPPORTUNITIES && c.weeks >= CRITERIA.MIN_WEEKS && c.t !== null && c.t >= CRITERIA.MIN_T_CUT)
    .sort((a, b) => (b.c.t ?? 0) - (a.c.t ?? 0));
  // Daily reviews, one change per market per 7 days: a market with a cut that went in or came out this past week waits.
  const recent = (x?: string) => !!x && Date.parse(now) - Date.parse(x) < 7 * 86_400_000;
  const markets = new Set<string>(next.filter((h) => recent(h.activatedAt) || recent(h.rolledBackAt)).map((h) => NBA_CUT.get(h.id)!.market));
  const picked = ready.filter(({ h }) => {
    const m = NBA_CUT.get(h.id)!.market;
    if (markets.has(m)) return false;
    markets.add(m);
    return true;
  });
  for (const { h, c } of picked) {
    h.status = "active";
    h.activatedAt = now;
    journal.push({ at: now, kind: "activate", text: `${NBA_CUT.get(h.id)!.label} beat ${NBA_CUT.get(h.parent)!.label} on ${c.n} games over ${c.weeks} weeks (t ${c.t}); it is now a candidate for the NBA ${NBA_CUT.get(h.id)!.market === "ats" ? "spread" : "totals"} rule.` });
  }
  const collecting = next.filter((h) => h.status === "collecting").length;
  journal.push({
    at: now,
    kind: picked.length ? "review" : "retain",
    text: picked.length
      ? `Review: ${picked.length} research cut${picked.length > 1 ? "s" : ""} activated (one per market at most); ${collecting} still collecting.`
      : `Review: no change. ${collecting} research cut${collecting === 1 ? "" : "s"} collecting; none has ${CRITERIA.MIN_OPPORTUNITIES}+ games over ${CRITERIA.MIN_WEEKS}+ weeks with t ${CRITERIA.MIN_T_CUT}+ yet.`,
  });
  return { hyps: next, journal };
}

/** The review runs daily, after each night's games (2026-10-27; it was weekly): due 20 hours after the last one. */
export function reviewDue(lastAt: string | undefined, now: Date): boolean {
  return !lastAt || now.getTime() - Date.parse(lastAt) >= 20 * 3_600_000;
}

/**
 * Today's games still to tip that have no saved copy of Sam's read. Sam posts
 * only the day's games and sometimes late, after the last scheduled save
 * before tip (two games a night went unsaved Oct 23 to 26), so the pulse
 * rechecks his page while this is non-empty.
 */
export function samGaps<G extends { id: string; tip: string; state: string }>(today: G[], saved: Set<string>, now: Date): G[] {
  return today.filter((g) => g.state === "pre" && new Date(g.tip) > now && !saved.has(g.id));
}
