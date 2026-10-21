// Our models on the shared learning engine (lib/learning/engine.ts), each as
// its own section so its evidence never mixes with Sam's or David's. A
// model edge shows on the page from day one; it becomes a bet only when one
// of these slices clears the section's gate on games after it registered.

import type { Bet, Candidate } from "@/lib/learning/engine";
import { STAT_LABEL, type Stat } from "@/lib/props/parse";
import type { GradedBet } from "@/lib/props/grade";
import type { GradedPropsGame } from "@/lib/props/trends";

export const OUR_SECTION = {
  nbaProps: "nba-props-ours",
  nbaFirstBasket: "nba-firstbasket-ours",
  nflProps: "nfl-props-ours",
  nflFirstTd: "nfl-firsttd-ours",
} as const;

/** Edge bands: our chance on the side minus DK's no-vig chance. */
const BANDS: [string, string, number, number][] = [
  ["edge:lo", "Edge under 3 points", -1, 0.03],
  ["edge:mid", "Edge 3 to 6 points", 0.03, 0.06],
  ["edge:hi", "Edge 6 points or more", 0.06, 2],
];

const towardOf = (side: "over" | "under", first: number | undefined, last: number) =>
  first === undefined || first === last ? 0 : (side === "over" ? last > first : last < first) ? 1 : -1;

/** Slice ids and labels, in page order. Ids are stable: the engine keeps them in Redis. */
export function ourPropSlices(stats: Stat[]): [string, string][] {
  return [
    ["edge:all", "Every model edge (our chance beats DK's break-even)"],
    ...stats.map((s): [string, string] => [`edge:${s}`, `Edges: ${STAT_LABEL[s].toLowerCase()}`]),
    ["edge:over", "Edges on the over"],
    ["edge:under", "Edges on the under"],
    ...BANDS.map(([id, label]): [string, string] => [id, label]),
    ["lean:all", "Model lean, every prop"],
    ...stats.map((s): [string, string] => [`lean:${s}`, `Lean: ${STAT_LABEL[s].toLowerCase()}`]),
  ];
}

/** Every graded bet in one slice. */
export function ourSliceBets(list: GradedPropsGame[], id: string): { x: GradedPropsGame; bet: GradedBet; marketId: string; line: number }[] {
  const [group, key] = id.split(":");
  const out: { x: GradedPropsGame; bet: GradedBet; marketId: string; line: number }[] = [];
  for (const x of list) {
    const byId = new Map(x.game.markets.map((m) => [m.id, m]));
    for (const g of x.result.markets) {
      const m = byId.get(g.id);
      const bet = group === "edge" ? g.play : g.lean;
      if (!m || g.actual === null || !bet) continue;
      const band = BANDS.find((b) => b[0] === id);
      const keep =
        key === "all" ||
        key === m.stat ||
        key === bet.side ||
        (band !== undefined && m.gap !== null && m.gap >= band[2] && m.gap < band[3]);
      if (keep) out.push({ x, bet, marketId: m.id, line: m.line });
    }
  }
  return out;
}

export function ourPropCandidates(graded: GradedPropsGame[], stats: Stat[]): Candidate[] {
  return ourPropSlices(stats).map(([id, label]) => ({
    id,
    label,
    ...(id.endsWith(":all") ? {} : { parent: `${id.split(":")[0]}:all` }),
    bets: ourSliceBets(graded, id).map(
      ({ x, bet, marketId, line }): Bet => ({ game: x.slug, week: x.week, at: x.kickoff ?? x.capturedAt ?? "", net: bet.net, toward: towardOf(bet.side, x.first?.[marketId], line) }),
    ),
  }));
}

/** Won, lost, pushed and units over a set of graded bets. */
export function record(bets: { bet: GradedBet }[]): { w: number; l: number; p: number; units: number } {
  const r = { w: 0, l: 0, p: 0, units: 0 };
  for (const { bet } of bets) {
    if (bet.outcome === "W") r.w++;
    else if (bet.outcome === "L") r.l++;
    else r.p++;
    r.units += bet.net;
  }
  r.units = Math.round(r.units * 100) / 100;
  return r;
}
