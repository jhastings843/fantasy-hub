import type { LeagueType } from "./types";

// Which tools apply to which league formats. A tool that doesn't apply is
// hidden from the nav rather than shown broken: a guillotine league has no
// trades, so it gets no trade tab.

export interface ToolDef {
  key: string;
  label: string;
  /** Appended to /l/[leagueId]. Empty string is the league home. */
  segment: string;
  types: LeagueType[];
}

const ALL: LeagueType[] = ["dynasty", "redraft", "guillotine"];

export const TOOLS: ToolDef[] = [
  { key: "home", label: "League", segment: "", types: ALL },
  // Second, because in season it is the tab opened most: it answers the one
  // question that has a deadline every week. Every format has starting slots,
  // including the guillotine league, where a lineup still has to be set after
  // waivers clear.
  { key: "lineup", label: "Lineup", segment: "lineup", types: ALL },
  { key: "plan", label: "Plan", segment: "plan", types: ALL },
  { key: "draft", label: "Draft", segment: "draft", types: ALL },
  // Guillotine has no trades under standard rules.
  { key: "trade", label: "Trade", segment: "trade", types: ["dynasty", "redraft"] },
  // The inverse: FAAB is the only way to acquire anyone in a guillotine league,
  // and the money never comes back, so the weekly bid decision earns its own
  // tool there and means nothing anywhere else.
  { key: "faab", label: "FAAB", segment: "faab", types: ["guillotine"] },
  { key: "players", label: "Players", segment: "players", types: ALL },
];

export function toolsFor(type: LeagueType): ToolDef[] {
  return TOOLS.filter((t) => t.types.includes(type));
}

export function toolSupports(key: string, type: LeagueType): boolean {
  const tool = TOOLS.find((t) => t.key === key);
  return tool ? tool.types.includes(type) : false;
}

export function leaguePath(leagueId: string, segment: string): string {
  return segment ? `/l/${leagueId}/${segment}` : `/l/${leagueId}`;
}
