"use server";

import { createElement, type ReactNode } from "react";
import { getOurNbaView } from "@/lib/models/nba/store";
import { getOurNflView } from "@/lib/models/nfl/store";
import { liveBox } from "@/lib/live/espn";
import { PropGameBody } from "./week";
import { DavidResearch, DavidResults, DavidWeek } from "./davidprops";

// Rows for one game on the Props board, fetched when the game is opened
// (UX pass item 4). Read-only: the same public data the page shows.

const seasonOf = (d: Date) => (d.getUTCMonth() < 7 ? d.getUTCFullYear() - 1 : d.getUTCFullYear());

export async function loadPropGame(sport: "nfl" | "nba", slug: string): Promise<ReactNode> {
  if ((sport !== "nfl" && sport !== "nba") || typeof slug !== "string" || slug.length > 200) throw new Error("Bad game");
  const season = seasonOf(new Date());
  const board = sport === "nba" ? (await getOurNbaView(season)).board : (await getOurNflView(season)).board;
  const g = board.find((x) => x.game.slug === slug);
  if (!g) throw new Error("Game not found");
  const now = Date.now();
  const started = !!g.kickoff && Date.parse(g.kickoff) <= now;
  const box = started && !g.result && g.espnId ? await liveBox(sport, g.espnId).catch(() => undefined) : undefined;
  const st = g.result || box?.game?.state === "post" ? "final" : started ? "live" : "pre";
  return createElement(PropGameBody, { g, sport, st, box, settled: sport === "nba" });
}

/** David Sasser's research-only panels on the Props page, loaded when opened. */
export async function loadDavid(which: "week" | "results" | "research"): Promise<ReactNode> {
  const season = seasonOf(new Date());
  const C = which === "results" ? DavidResults : which === "research" ? DavidResearch : DavidWeek;
  if (which !== "week" && which !== "results" && which !== "research") throw new Error("Bad panel");
  return createElement(C, { season });
}
