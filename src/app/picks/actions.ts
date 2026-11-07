"use server";

import { createElement, type ReactNode } from "react";
import { getPicksReport } from "@/lib/picks/report";
import type { League } from "@/lib/picks/parse";
import { GameExpand } from "./ats";

// One game's expanded panel on the spreads board, fetched when the row is
// opened (UX pass item 4). Read-only: the same cached report the page reads.

export async function loadAtsGame(league: League, away: string, home: string): Promise<ReactNode> {
  if ((league !== "nfl" && league !== "cfb") || typeof away !== "string" || typeof home !== "string" || away.length > 80 || home.length > 80) throw new Error("Bad game");
  const r = (await getPicksReport(league)).value;
  const g = r?.board.find((x) => x.away === away && x.home === home);
  if (!r || !g) throw new Error("Game not found");
  return createElement(GameExpand, { g, r });
}
