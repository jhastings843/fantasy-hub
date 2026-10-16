// Trends in Sam's prop model, from graded markets only.
//
// Every check is a slice of bets (Sam's plays, or the projection's lean on
// every market), settled at the price the playing book showed before kickoff,
// 1 unit risked each. A slice is judged against its own break-even: the sum
// of the implied chance of every price it took. Beating that by enough is the
// only thing that makes a slice worth money.
//
// Props come in volume (about 28 markets a game), so slices fill fast and many
// are checked at once. With ~30 slices, one will clear a 90% bar by luck most
// weeks. So the bar to call a slice "profitable" is stricter than the Picks
// tab's: MIN_BETS decided bets and z >= 1.96 (95%, one-sided 97.5%). And a
// slice that clears it only joins the system for the weeks AFTER it qualified
// (store.ts keeps that record), so the money it shows is out of sample.

import { STAT_LABEL, type PropMarket, type PropsGame, type Stat } from "./parse";
import type { GradedBet, GradedGame, GradedMarket } from "./grade";

export const MIN_BETS = 100;
const Z_EARN = 1.96;
const Z_LEAN = 1;
/** A slice in the system is retired when its full-season z falls under this. */
export const Z_RETIRE = 1;

export interface GradedPropsGame {
  week: number;
  slug: string;
  game: PropsGame;
  result: GradedGame;
  /** Consensus line per market at the first saved copy, for line movement. */
  first?: { [id: string]: number };
  /** Rotowire's projection per market (via Sleeper), saved with the copy. */
  rw?: { [id: string]: number };
  /** ESPN's fantasy projection per market. */
  espn?: { [id: string]: number };
  /** DraftKings' opening and current line per market (ESPN odds feed). */
  dk?: { [id: string]: { open: number; current: number } };
}

export type Verdict = "early" | "flat" | "lean-up" | "lean-down" | "profitable" | "losing";

export interface PropSlice {
  id: string;
  group: "play" | "lean" | "rw" | "espn";
  label: string;
  /** Decided bets (pushes excluded). */
  n: number;
  w: number;
  l: number;
  p: number;
  units: number;
  /** Sum of break-even chances over decided bets: the wins needed to be flat. */
  needed: number;
  z: number | null;
  verdict: Verdict;
  /** Mean consensus move toward the side between the first and last saved copy, in stat units. Null without both copies. */
  move: number | null;
}

export interface Accuracy {
  stat: Stat;
  n: number;
  /** Mean absolute miss of Sam's projection. */
  model: number;
  /** Mean absolute miss of the consensus line. */
  market: number;
  /** How often the projection was closer than the consensus. */
  closer: number;
  /** Mean absolute miss of Rotowire's projection, on the markets it covered. */
  rw: number | null;
  /** Mean absolute miss of ESPN's projection, on the markets it covered. */
  espn: number | null;
}

export interface PropTrends {
  markets: number;
  plays: number;
  slices: PropSlice[];
  accuracy: Accuracy[];
  findings: string[];
}

interface Row {
  week: number;
  slug: string;
  m: PropMarket;
  g: GradedMarket;
  bet: GradedBet;
  first?: number;
  /** Rotowire's projection for the market, when saved. */
  rw?: number;
  espn?: number;
  dk?: { open: number; current: number };
}

function slice(id: string, group: PropSlice["group"], label: string, rows: Row[]): PropSlice {
  const decided = rows.filter((r) => r.bet.outcome !== "P");
  const w = decided.filter((r) => r.bet.outcome === "W").length;
  const needed = decided.reduce((a, r) => a + r.bet.breakEven, 0);
  const variance = decided.reduce((a, r) => a + r.bet.breakEven * (1 - r.bet.breakEven), 0);
  const z = variance > 0 ? (w - needed) / Math.sqrt(variance) : null;
  const units = rows.reduce((a, r) => a + r.bet.net, 0);
  let verdict: Verdict = "flat";
  if (decided.length < MIN_BETS) verdict = "early";
  else if (z !== null && z >= Z_EARN && units > 0) verdict = "profitable";
  else if (z !== null && z <= -Z_EARN) verdict = "losing";
  else if (z !== null && z >= Z_LEAN) verdict = "lean-up";
  else if (z !== null && z <= -Z_LEAN) verdict = "lean-down";
  const moved = rows.filter((r) => r.first !== undefined);
  const move = moved.length
    ? moved.reduce((a, r) => a + (r.bet.side === "over" ? r.m.consensus - r.first! : r.first! - r.m.consensus), 0) / moved.length
    : null;
  return {
    id,
    group,
    label,
    n: decided.length,
    w,
    l: decided.length - w,
    p: rows.length - decided.length,
    units: Math.round(units * 100) / 100,
    needed: Math.round(needed * 10) / 10,
    z: z === null ? null : Math.round(z * 100) / 100,
    verdict,
    move: move === null ? null : Math.round(move * 100) / 100,
  };
}

const groupOf = (id: string): PropSlice["group"] => {
  const g = id.split(":")[0];
  return g === "play" || g === "rw" || g === "espn" ? g : "lean";
};
const STATS: Stat[] = ["pass_yds", "rush_yds", "rec_yds", "rec"];
/** How far the projection sits from the line, as a share of the line. */
const reach = (m: PropMarket) => Math.abs(m.model - m.line) / Math.max(m.line, 1);

/** Every slice the page and the system read, built from the same rows. */
export function propTrends(list: GradedPropsGame[]): PropTrends {
  const plays: Row[] = [];
  const leans: Row[] = [];
  const rws: Row[] = [];
  const espns: Row[] = [];
  const acc = new Map<Stat, { n: number; model: number; market: number; closer: number; rwN: number; rw: number; eN: number; e: number }>();
  let markets = 0;
  for (const x of list) {
    const byId = new Map(x.game.markets.map((m) => [m.id, m]));
    for (const g of x.result.markets) {
      const m = byId.get(g.id);
      if (!m || g.actual === null) continue;
      markets++;
      const first = x.first?.[m.id];
      const rw = x.rw?.[m.id];
      const espn = x.espn?.[m.id];
      const base = { week: x.week, slug: x.slug, m, g, first, rw, espn, dk: x.dk?.[m.id] };
      if (g.play) plays.push({ ...base, bet: g.play });
      if (g.lean) leans.push({ ...base, bet: g.lean });
      if (g.rw) rws.push({ ...base, bet: g.rw });
      if (g.espn) espns.push({ ...base, bet: g.espn });
      if (m.stat) {
        const a = acc.get(m.stat) ?? { n: 0, model: 0, market: 0, closer: 0, rwN: 0, rw: 0, eN: 0, e: 0 };
        if (espn !== undefined) {
          a.eN++;
          a.e += Math.abs(g.actual - espn);
        }
        if (rw !== undefined) {
          a.rwN++;
          a.rw += Math.abs(g.actual - rw);
        }
        const dm = Math.abs(g.actual - m.model);
        const dc = Math.abs(g.actual - m.consensus);
        a.n++;
        a.model += dm;
        a.market += dc;
        if (dm < dc) a.closer++;
        acc.set(m.stat, a);
      }
    }
  }

  const slices: PropSlice[] = SLICES.map(([id, label]) =>
    slice(id, groupOf(id), label, ({ play: plays, rw: rws, espn: espns, lean: leans }[groupOf(id)]).filter((r) => matches(id, r, list))),
  );

  const accuracy: Accuracy[] = STATS.flatMap((stat) => {
    const a = acc.get(stat);
    if (!a?.n) return [];
    const r = (x: number) => Math.round((x / a.n) * 10) / 10;
    return [{ stat, n: a.n, model: r(a.model), market: r(a.market), closer: a.closer, rw: a.rwN ? Math.round((a.rw / a.rwN) * 10) / 10 : null, espn: a.eN ? Math.round((a.e / a.eN) * 10) / 10 : null }];
  });

  const findings = slices
    .filter((x) => x.verdict === "profitable" || x.verdict === "losing")
    .sort((a, b) => Math.abs(b.z ?? 0) - Math.abs(a.z ?? 0))
    .map(
      (x) =>
        `${x.label}: ${x.w}-${x.l}${x.p ? `-${x.p}` : ""}, ${x.units >= 0 ? "+" : ""}${x.units}u, ${x.w} wins against ${x.needed} needed to break even, so it is ${
          x.verdict === "profitable" ? "beating" : "losing to"
        } the prices.`,
    );

  return { markets, plays: plays.length, slices, accuracy, findings };
}

/** Every slice, in page order. Ids are stable: the system keeps them in Redis. */
export const SLICES: [string, string][] = [
  ["play:all", "Every Sam play"],
  ...STATS.map((st): [string, string] => [`play:${st}`, `Plays: ${STAT_LABEL[st].toLowerCase()}`]),
  ["play:over", "Plays on the over"],
  ["play:under", "Plays on the under"],
  ["play:gap-lo", "Gap under 0.035"],
  ["play:gap-mid", "Gap 0.035 to 0.06"],
  ["play:gap-hi", "Gap 0.06 or more"],
  ["play:agree", "Projection agrees with the play"],
  ["play:against", "Projection points the other way"],
  ["play:off", "Playing book 1.5+ off the consensus (yards)"],
  ["play:fav", "Sam's listed favorites"],
  ["play:rw-agree", "Plays Rotowire's projection backs"],
  ["play:espn-agree", "Plays ESPN's projection backs"],
  ["play:all3", "Plays both Rotowire and ESPN back"],
  ["play:dk-toward", "DraftKings moved toward the play since its open"],
  ["play:dk-against", "DraftKings moved against the play since its open"],
  ["lean:all", "Projection lean, every market"],
  ...STATS.map((st): [string, string] => [`lean:${st}`, `Lean: ${STAT_LABEL[st].toLowerCase()}`]),
  ["lean:over", "Lean over"],
  ["lean:under", "Lean under"],
  ["lean:near", "Projection within 10% of the line"],
  ["lean:mid", "Projection 10% to 25% off the line"],
  ["lean:far", "Projection 25%+ off the line"],
  ["lean:noplay", "Lean where Sam has no play"],
  ["lean:rw-agree", "Sam and Rotowire lean the same way"],
  ["lean:all3", "Sam, Rotowire and ESPN all lean the same way"],
  ["rw:all", "Rotowire lean, every market"],
  ["espn:all", "ESPN lean, every market"],
];

function isFavorite(list: GradedPropsGame[], r: Row): boolean {
  const x = list.find((y) => y.slug === r.slug && y.week === r.week);
  return !!x?.game.favorites.some((f) => f.player === r.m.player && f.statLabel.toLowerCase() === r.m.statLabel.toLowerCase());
}

/** A projection's side from the shown line (Rotowire, ESPN), when it has a number for the market. */
export const rwSide = (m: PropMarket, rw: number | undefined) => (rw === undefined ? null : rw > m.line ? "over" : rw < m.line ? "under" : null);

/** Bets in a slice, for the system's out-of-sample record. */
export function sliceBets(list: GradedPropsGame[], id: string): { week: number; slug: string; market: PropMarket; bet: GradedBet }[] {
  const out: { week: number; slug: string; market: PropMarket; bet: GradedBet }[] = [];
  for (const x of list) {
    const byId = new Map(x.game.markets.map((m) => [m.id, m]));
    for (const g of x.result.markets) {
      const m = byId.get(g.id);
      if (!m || g.actual === null) continue;
      const grp = groupOf(id);
      const bet = grp === "play" ? g.play : grp === "rw" ? g.rw : grp === "espn" ? g.espn : g.lean;
      if (!bet) continue;
      if (matches(id, { week: x.week, slug: x.slug, m, g, bet, rw: x.rw?.[m.id], espn: x.espn?.[m.id], dk: x.dk?.[m.id] }, list)) out.push({ week: x.week, slug: x.slug, market: m, bet });
    }
  }
  return out;
}

/** Does a market fall in a slice? Keyed by slice id. */
export function matches(id: string, r: Row, list: GradedPropsGame[]): boolean {
  const [group, key] = id.split(":");
  const m = r.m;
  const side = r.bet.side;
  if (key === "all") return true;
  if ((STATS as string[]).includes(key)) return m.stat === key;
  if (key === "over" || key === "under") return side === key;
  if (key === "rw-agree") return rwSide(m, r.rw) === side;
  if (key === "espn-agree") return rwSide(m, r.espn) === side;
  if (key === "all3") return rwSide(m, r.rw) === side && rwSide(m, r.espn) === side && (group !== "lean" || m.lean === side);
  if (key === "dk-toward" || key === "dk-against") {
    if (!r.dk || r.dk.current === r.dk.open) return false;
    const toward = side === "over" ? r.dk.current > r.dk.open : r.dk.current < r.dk.open;
    return key === "dk-toward" ? toward : !toward;
  }
  if (group === "play") {
    if (key === "gap-lo") return (m.gap ?? 0) < 0.035;
    if (key === "gap-mid") return (m.gap ?? 0) >= 0.035 && (m.gap ?? 0) < 0.06;
    if (key === "gap-hi") return (m.gap ?? 0) >= 0.06;
    if (key === "agree") return m.lean === side;
    if (key === "against") return m.lean !== null && m.lean !== side;
    if (key === "off") return m.stat !== "rec" && Math.abs(r.bet.line - m.consensus) >= 1.5;
    if (key === "fav") return isFavorite(list, r);
  } else if (group === "lean") {
    if (key === "near") return reach(m) < 0.1;
    if (key === "mid") return reach(m) >= 0.1 && reach(m) < 0.25;
    if (key === "far") return reach(m) >= 0.25;
    if (key === "noplay") return !m.clears;
  }
  return false;
}
