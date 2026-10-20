// Player props on the shared learning engine (lib/learning/engine.ts). Every
// slice on the props page is a candidate; its bets are graded at the saved
// price, keyed by game so the engine can judge per game. NFL props (Sam and
// David) and NBA props (Sam) are separate sections with separate evidence;
// both use PROPS_GATE.

import type { Bet, Candidate } from "@/lib/learning/engine";
import { DAVID_SLICES, davidSliceBets, type DavidWeekGame, type SamIndex } from "./david";
import { slicesFor, sliceBets, type GradedPropsGame } from "./trends";
import type { League } from "./parse";

export const PROPS_SECTION: { [l in League]: string } = { nfl: "nfl-props", nba: "nba-props" };

/** The broader slice a slice narrows: its group's "all", David's plays inside his board, an agree/split inside each model's side. */
export function parentOf(id: string): string | undefined {
  const [g, k] = id.split(":");
  if (g === "h2h") return k === "sam" || k === "david" ? undefined : k === "split-sam" ? "h2h:sam" : "h2h:david";
  if (k === "all") return g === "dplay" ? "dboard:all" : undefined;
  return `${g}:all`;
}

/** +1 when the line moved toward the side between the first and last pregame copy, -1 against, 0 none or unknown. */
const towardOf = (side: "over" | "under", first: number | undefined, last: number) =>
  first === undefined || first === last ? 0 : (side === "over" ? last > first : last < first) ? 1 : -1;

/** Every props slice as a learning candidate. Late copies never count. */
export function propCandidates(graded: GradedPropsGame[], league: League, dGames: DavidWeekGame[] = [], sam: SamIndex = new Map()): Candidate[] {
  const list = graded.filter((x) => !x.late);
  const meta = new Map(list.map((x) => [`${x.week}|${x.slug}`, x]));
  const sams: Candidate[] = slicesFor(league).map(([id, label]) => ({
    id,
    label,
    bets: sliceBets(list, id).map((b): Bet => {
      const x = meta.get(`${b.week}|${b.slug}`);
      return { game: b.slug, week: b.week, at: x?.kickoff ?? x?.capturedAt ?? "", net: b.bet.net, toward: towardOf(b.bet.side, x?.first?.[b.market.id], b.market.consensus) };
    }),
  }));
  const davids: Candidate[] =
    league === "nfl"
      ? DAVID_SLICES.map(([id, label]) => ({
          id,
          label,
          bets: davidSliceBets(dGames, sam, id).map((b): Bet => ({ game: b.p.gameId, week: b.week, at: b.p.kickoff, net: b.bet.net, toward: towardOf(b.bet.side, b.first, b.p.line) })),
        }))
      : [];
  const all = [...sams, ...davids];
  const ids = new Set(all.map((c) => c.id));
  return all.map((c) => {
    const parent = parentOf(c.id);
    return parent && ids.has(parent) ? { ...c, parent } : c;
  });
}
