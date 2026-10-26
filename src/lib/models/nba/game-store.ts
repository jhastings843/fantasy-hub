import "server-only";
import { redis } from "@/lib/redis/client";
import type { NbaGame } from "./box";
import { GameRatings, ourNumbers, spreadResidual, type GameParams } from "./game";
import { readOpenClose, type CoreOdds } from "./game-lines";
import { signalRecords, type GameSnap, type SignalRecord, type TrackedNbaGame } from "./game-track";
import PARAMS from "./game-params.json";
import SEED from "./game-seed.json";

// Our NBA game model, live (tracked only; see game-track.ts). The props run
// (store.ts) calls `saveGameModel` for each game it builds a board for, with
// each side's points change from tonight's Out list, so the number uses the
// injury report as it stood at that read. The first save is the price the
// game is judged at; later saves (another slot, an injury reprice) replace
// `last` only. `gradeGameModel` fills the close and the final.
//
// Ratings: where they stood after 2025-26 (game-seed.json, from the fit),
// carried into this season, plus every final this season the props model has
// folded in (models:v1:nba:{season}:games).
//
// Redis: models:v1:nba:{season}:gamemodel  hash event id -> TrackedNbaGame

const P = PARAMS as GameParams;
const KEY = (s: number) => `models:v1:nba:${s}:gamemodel`;
const GAMES = (s: number) => `models:v1:nba:${s}:games`;
const ODDS = (id: string) => `https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba/events/${id}/competitions/${id}/odds`;
const r2 = (x: number) => Math.round(x * 100) / 100;

async function odds(event: string) {
  const res = await fetch(ODDS(event), { cache: "no-store", signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`ESPN odds answered ${res.status}`);
  return readOpenClose((await res.json()) as CoreOdds);
}

/** Ratings as of now: the seed, carried into the season, then this season's finals in tip order. */
export async function ratingsNow(season: number): Promise<GameRatings> {
  const r = new GameRatings(P.rating);
  r.season = SEED.season;
  r.lg = SEED.lg;
  r.lgPace = SEED.lgPace;
  for (const [m, src] of [[r.off, SEED.off], [r.def, SEED.def], [r.pace, SEED.pace]] as const) for (const [t, v] of Object.entries(src)) m.set(t, v);
  r.newSeason(String(season));
  const games = Object.values((await redis.hgetall<{ [id: string]: NbaGame }>(GAMES(season))) ?? {}).sort((a, b) => a.date.localeCompare(b.date));
  for (const g of games) r.add(g, g.spread);
  return r;
}

/**
 * Save our number for one game about to tip. `avail` is each side's projected
 * points with tonight's players minus with the full recent rotation (props model).
 * Returns a one-line summary, or null when DK has no spread and total yet.
 */
export async function saveGameModel(
  season: number,
  now: Date,
  g: { event: string; home: string; away: string; tip: string },
  avail: { home: number; away: number },
  out: { home: number; away: number },
  ratings: GameRatings,
): Promise<string | null> {
  const l = await odds(g.event);
  if (!l || l.close.spread === null || l.close.total === null) return null;
  const x = ratings.features({ date: g.tip, home: g.home, away: g.away }, l.close.spread, l.close.total, l.open, avail);
  const ours = ourNumbers(l.close.spread, l.close.total, x, P);
  const res = spreadResidual(x.spread, P.spread);
  const round = <T extends Record<string, number>>(o: T) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, r2(v)])) as T;
  const snap: GameSnap = {
    at: now.toISOString(),
    spread: l.close.spread,
    total: l.close.total,
    open: l.open,
    ours: { spread: r2(ours.spread), total: r2(x.rating.total) },
    res: r2(res),
    x: { spread: round(x.spread), total: round(x.total) },
    out,
  };
  const old = await redis.hget<TrackedNbaGame>(KEY(season), g.event);
  const row: TrackedNbaGame = { ...old, event: g.event, home: g.home, away: g.away, tip: g.tip, first: old?.first ?? snap, last: snap };
  await redis.hset(KEY(season), { [g.event]: row });
  return `${g.away}@${g.home} ${g.home} ${snap.spread} (ours ${snap.ours.spread}), total ${snap.total} (rating ${snap.ours.total})`;
}

/** Close and final for every saved game that has tipped and finished. */
export async function gradeGameModel(season: number, now: Date): Promise<string[]> {
  const rows = (await redis.hgetall<{ [id: string]: TrackedNbaGame }>(KEY(season))) ?? {};
  const todo = Object.values(rows).filter((r) => !r.final && new Date(r.tip) < now);
  if (!todo.length) return [];
  const finals = (await redis.hmget<{ [id: string]: NbaGame }>(GAMES(season), ...todo.map((r) => r.event))) ?? {};
  const done: string[] = [];
  for (const r of todo) {
    const g = finals[r.event];
    if (!g) continue;
    const l = await odds(r.event).catch(() => null);
    const close = l?.close ?? { spread: r.last.spread, total: r.last.total };
    await redis.hset(KEY(season), { [r.event]: { ...r, close, final: { home: g.score[r.home], away: g.score[r.away] } } });
    done.push(r.event);
  }
  return done;
}

export interface NbaGameModelView {
  games: TrackedNbaGame[];
  records: SignalRecord[];
  strong: number;
}

export async function getNbaGameModelView(season: number): Promise<NbaGameModelView> {
  const games = Object.values((await redis.hgetall<{ [id: string]: TrackedNbaGame }>(KEY(season))) ?? {}).sort((a, b) => a.tip.localeCompare(b.tip));
  return { games, records: signalRecords(games, P.strongSpread), strong: P.strongSpread };
}
