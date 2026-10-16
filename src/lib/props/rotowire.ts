// Rotowire's weekly projections, as Sleeper serves them (no key). A second,
// independent projection for the same markets as Sam's, saved with each
// pregame copy so it can be graded the same way. Matched by full name and
// team: Sam prints full names, Sleeper gives first and last.

import type { PropMarket, Stat } from "./parse";
import { nameKey } from "./grade";

const URL = (season: number, week: number) =>
  `https://api.sleeper.app/projections/nfl/${season}/${week}?season_type=regular&position[]=QB&position[]=RB&position[]=WR&position[]=TE`;

const FIELD: { [s in Stat]: string } = { pass_yds: "pass_yd", rush_yds: "rush_yd", rec_yds: "rec_yd", rec: "rec" };

export interface SleeperProjection {
  team?: string | null;
  company?: string;
  player?: { first_name?: string; last_name?: string; team?: string | null };
  stats?: { [k: string]: number | undefined };
}

// Sleeper writes the Rams LAR; Sam writes LA. Every other code matches.
const SAM: { [code: string]: string } = { LAR: "LA" };

/** Projections keyed "name|team" in Sam's team codes. */
export function indexProjections(rows: SleeperProjection[]): Map<string, { [k: string]: number | undefined }> {
  const out = new Map<string, { [k: string]: number | undefined }>();
  for (const r of rows) {
    const p = r.player;
    const team = r.team ?? p?.team;
    if (!p?.first_name || !p.last_name || !team || !r.stats) continue;
    out.set(`${nameKey(`${p.first_name} ${p.last_name}`)}|${SAM[team] ?? team}`, r.stats);
  }
  return out;
}

/** Rotowire's number for each of a game's markets it covers, by market id. */
export function projectionsFor(markets: PropMarket[], idx: Map<string, { [k: string]: number | undefined }>): { [id: string]: number } {
  const out: { [id: string]: number } = {};
  for (const m of markets) {
    if (!m.stat) continue;
    const v = idx.get(`${nameKey(m.player)}|${m.team}`)?.[FIELD[m.stat]];
    if (typeof v === "number" && Number.isFinite(v)) out[m.id] = Math.round(v * 10) / 10;
  }
  return out;
}

export async function fetchProjections(season: number, week: number): Promise<Map<string, { [k: string]: number | undefined }>> {
  const res = await fetch(URL(season, week), { cache: "no-store", signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Sleeper projections answered ${res.status}`);
  return indexProjections((await res.json()) as SleeperProjection[]);
}
