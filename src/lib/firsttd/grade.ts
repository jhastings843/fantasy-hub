// Grading a saved first TD page against what happened, from ESPN's game
// summary (scoringPlays: no key, no quota, already used by the Picks tab).
//
// Sam's three blocks are "this team's players", "the other team's players"
// and "no offensive first TD: a defensive or special-teams score, or no
// touchdown at all". So the first touchdown of the game is graded as an
// offensive score only when it is a rushing or passing touchdown (or an
// offense recovering its own fumble in the end zone); a pick-six, a fumble
// return or a return TD lands in "none", exactly as the page defines it.

import { pricedPlayers, type FtdGame } from "./parse";

const ESPN_TO_SAM: { [abbr: string]: string } = { WSH: "WAS", LAR: "LA", JAC: "JAX" };
export const samTeam = (espn: string) => ESPN_TO_SAM[espn] ?? espn;

export interface EspnScoringPlay {
  type?: { text?: string };
  text?: string;
  period?: { number?: number };
  clock?: { displayValue?: string };
  scoringType?: { name?: string };
  team?: { abbreviation?: string };
}

export type FirstTd =
  | { kind: "offense"; team: string; scorer: string; how: "rush" | "pass" | "other"; period: number; clock: string }
  | { kind: "none"; detail: string; team?: string; period?: number; clock?: string };

/** The game's first touchdown, from a finished game's scoring plays. */
export function firstTouchdown(plays: EspnScoringPlay[]): FirstTd {
  const td = plays.find((p) => p.scoringType?.name === "touchdown");
  if (!td) return { kind: "none", detail: "No touchdown scored" };
  const type = td.type?.text ?? "";
  const team = samTeam(td.team?.abbreviation ?? "");
  const period = td.period?.number ?? 0;
  const clock = td.clock?.displayValue ?? "";
  const offense = /^(Passing|Rushing) Touchdown$/i.test(type) || /recovery \(own\)/i.test(type);
  if (!offense) return { kind: "none", detail: type || "Non-offensive touchdown", team, period, clock };
  // "Parker Washington 51 Yd pass from Trevor Lawrence (Cam Little Kick)", "Will Shipley 2 Yd Rush".
  const scorer = (td.text ?? "").match(/^(.+?)\s+(?:\d+|no gain)\s+(?:Yd|Yard|Yds)\b/i)?.[1]?.trim() ?? (td.text ?? "").split(" ").slice(0, 2).join(" ");
  const how = /^Passing/i.test(type) ? "pass" : /^Rushing/i.test(type) ? "rush" : "other";
  return { kind: "offense", team, scorer, how, period, clock };
}

const SUFFIX = /\b(jr|sr|ii|iii|iv|v)\.?$/i;
const squash = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");

/** Sam's "J.Smith-Njigba" against ESPN's "Jaxon Smith-Njigba". */
export function sameName(sam: string, espn: string): boolean {
  const [ini, ...rest] = sam.split(".");
  const samLast = squash(rest.join(".").replace(SUFFIX, ""));
  const parts = espn.replace(SUFFIX, "").trim().split(/\s+/);
  if (!parts.length || !samLast) return false;
  const first = parts[0];
  const last = squash(parts.slice(1).join(" "));
  return squash(first).startsWith(squash(ini)) && last === samLast;
}

export interface Graded {
  first: FirstTd;
  /** The team that scored the first offensive TD, or null for "none". */
  team: string | null;
  /** Did the side Sam made likelier to score first do it? Null when "none". */
  teamHit: boolean | null;
  /** The scorer's key on Sam's page, when he is on it. */
  key: string | null;
  /** Where the scorer sat: his chance, his rank among priced players, or why he had none. */
  p: number | null;
  rank: number | null;
  bucket: "priced" | "thin" | "out" | "unlisted" | "none";
  pickHit: boolean;
  /** Sam's chance for what happened: the player's, the team's remainder, or "none". */
  pOutcome: number;
}

export function grade(g: FtdGame, first: FirstTd): Graded {
  const fav = [...g.teams].sort((a, b) => b.pFirst - a.pFirst)[0];
  if (first.kind === "none") {
    return { first, team: null, teamHit: null, key: null, p: null, rank: null, bucket: "none", pickHit: false, pOutcome: g.none };
  }
  const side = g.teams.find((t) => t.team === first.team);
  const player = side?.players.find((p) => sameName(p.name, first.scorer)) ?? null;
  const priced = pricedPlayers(g);
  const rank = player && player.p !== null && !player.out ? priced.findIndex((p) => p.key === player.key) + 1 : null;
  const bucket: Graded["bucket"] = !player ? "unlisted" : player.out ? "out" : player.thin || player.p === null ? "thin" : "priced";
  const pickHit = !!g.pick && g.pick.team === first.team && !!player && player.name === g.pick.name;
  // A THIN scorer is charged the side's unprinted THIN share, split evenly
  // among its THIN players (an estimate: the page won't say how it splits).
  const thinCount = side?.players.filter((p) => p.thin && !p.out).length ?? 0;
  const pOutcome =
    bucket === "priced" ? player!.p! : bucket === "thin" ? (thinCount ? (side?.thin ?? 0) / thinCount : 0) : (side?.rest ?? 0);
  return {
    first,
    team: first.team,
    teamHit: fav ? fav.team === first.team : null,
    key: player?.key ?? null,
    p: bucket === "priced" ? player!.p : null,
    rank,
    bucket,
    pickHit,
    pOutcome,
  };
}
