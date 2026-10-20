// First TD on the shared learning engine (lib/learning/engine.ts), as its own
// section with FTD_GATE. Candidates are the money checks at Kalshi's ask; the
// count-vs-Sam's-chances checks on the page stay report-only (they say where
// his numbers run hot or cold, not what to buy).

import type { Candidate } from "@/lib/learning/engine";
import { MARKET_SLICES, marketBets, type GradedGame } from "./trends";

export const FTD_SECTION = "nfl-firsttd";

/** Value refinements narrow "Sam's chance above Kalshi's cost". */
const PARENT: { [id: string]: string } = { "k-value3": "k-value", "k-short": "k-value", "k-p8-value": "k-value" };

export function ftdCandidates(list: GradedGame[]): Candidate[] {
  return MARKET_SLICES.map(([id, label, keep]) => ({
    id,
    label,
    ...(PARENT[id] ? { parent: PARENT[id] } : {}),
    bets: marketBets(list, keep).map((b) => ({ game: b.game.slug, week: b.game.week, at: b.kickoff ?? "", net: Math.round(b.net * 1000) / 1000 })),
  }));
}
