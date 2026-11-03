import "server-only";
import { Readable } from "node:stream";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import { PlayAgg, carryRatings, solveRatings, splitCsvLine, unpackRatings, type PowerParams, type Rating } from "./power";
import PARAMS from "./power-params.json";

// Our play-by-play ratings, live: this season's nflverse play by play
// (about 8 MB gzipped by midseason, streamed, never held whole), every play
// so far, solved on top of last season's final ratings carried in
// power-params.json. Cached three hours like the games file. Any failure
// returns null and the game shows no play-by-play line.

export const POWER = PARAMS as PowerParams & { last: { season: number; ratings: { [t: string]: number[] } } };
const URL = (s: number) => `https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_${s}.csv.gz`;

let cache: { at: number; season: number; ratings: Map<string, Rating> } | null = null;

export async function powerRatings(season: number): Promise<Map<string, Rating> | null> {
  if (cache && cache.season === season && Date.now() - cache.at < 3 * 3_600_000) return cache.ratings;
  // Last season's finals seed this one; a season the params don't cover starts everyone at average.
  const prior = POWER.last.season === season - 1 ? carryRatings(unpackRatings(POWER.last.ratings), POWER.carry) : new Map<string, Rating>();
  const agg = new PlayAgg(POWER.wp);
  try {
    const res = await fetch(URL(season), { cache: "no-store", signal: AbortSignal.timeout(60_000) });
    if (res.status === 404) return prior.size ? prior : null; // week 1: no file yet
    if (!res.ok || !res.body) throw new Error(`nflverse pbp answered ${res.status}`);
    const rl = createInterface({ input: Readable.fromWeb(res.body as import("node:stream/web").ReadableStream).pipe(createGunzip()), crlfDelay: Infinity });
    let first = true;
    for await (const line of rl) {
      const f = splitCsvLine(line);
      if (first) {
        agg.header(f);
        first = false;
      } else agg.row(f);
    }
  } catch {
    return null;
  }
  const ratings = solveRatings(agg.teamGames(), prior, POWER.prior);
  cache = { at: Date.now(), season, ratings };
  return ratings;
}
