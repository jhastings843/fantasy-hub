import "server-only";
import { redis } from "@/lib/redis/client";
import { watchProblems } from "@/lib/notify/problems";
import { boardFor, cbbSeason } from "./store";
import { HARRIS_DAY, HARRIS_DAYS, HARRIS_PRE, feedRows, fetchHarrisCbb, matchRows, mergeDay, preOf, type HarrisCbbDay } from "./harris";

// John Harris's daily CBB sheet into Redis (tracked only; harris.ts has the
// feed and its signs). Each read is matched to that day's ESPN board, stored
// per day, and his last pregame numbers per game go to one small hash that
// the learner's Harris slices read (store.ts). Plain JSON, no model.
//
// Redis:
//   models:v1:cbb:{season}:harris:day:{yyyy-mm-dd}   the day's sheet (HarrisCbbDay)
//   models:v1:cbb:{season}:harris:days               hash date -> { games, verified } (the Learning page reads only this)
//   models:v1:cbb:{season}:harris:pre                hash event -> HarrisPre
//   models:v1:cbb:{season}:harris:feed:{date}        claim: one read per window

const ET = "America/New_York";
const CLAIM = (season: number, date: string) => `models:v1:cbb:${season}:harris:feed:${date}`;
/** Today's sheet once an hour (his lines move through the day; a slice keeps the last read before tip). */
const TODAY_EVERY_S = 50 * 60;
/** Yesterday's, every six hours until it is verified and read after its last tip. */
const YESTERDAY_EVERY_S = 6 * 3600;
/** His pickDates start Nov 1. */
const FIRST_DAY = (season: number) => `${season}-11-01`;

const etDate = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: ET }).format(d);
const dayBefore = (date: string) => new Date(Date.parse(`${date}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
const seasonOfDate = (date: string) => cbbSeason(new Date(`${date}T12:00:00Z`));

/** One day from his feed: one request to him, one to ESPN's board. */
export async function ingestHarrisCbb(date: string, now = new Date()): Promise<HarrisCbbDay | { skipped: string }> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`Send the date as YYYY-MM-DD (got ${date}).`);
  const season = seasonOfDate(date);
  const table = await fetchHarrisCbb(date);
  const rows = feedRows(table);
  if (!rows.length) return { skipped: `his feed has no games on ${date} yet` };
  const board = await boardFor(date.replace(/-/g, ""));
  if (!board.length) throw new Error(`No college basketball games on our board for ${date} to match his sheet against.`);
  const m = matchRows(rows, board.map((g) => ({ id: g.id, tip: g.tip, home: g.home, away: g.away })));
  const prior = await redis.get<HarrisCbbDay>(HARRIS_DAY(season, date)).catch(() => null);
  const at = now.toISOString();
  const merged = mergeDay(prior?.rows, m.rows, at);
  const day: HarrisCbbDay = {
    season,
    date,
    rows: merged,
    verified: m.rows.length > 0 && m.problems.length === 0,
    problems: m.problems,
    ...(m.unpriced.length ? { unpriced: m.unpriced } : {}),
    at,
  };
  await redis.set(HARRIS_DAY(season, date), day);
  await redis.hset(HARRIS_DAYS(season), { [date]: { games: merged.length, verified: day.verified } });
  const pre = preOf(merged);
  if (Object.keys(pre).length) await redis.hset(HARRIS_PRE(season), pre);
  return day;
}

/**
 * For the hourly pulse: today's sheet at most once an hour and yesterday's
 * every six hours until it is verified and was read after its last tip. Two
 * requests to his feed per run at most.
 */
export async function harrisCbbIfDue(now = new Date()): Promise<string> {
  // May through October: no games (his pickDates start Nov 1).
  const month = Number(new Intl.DateTimeFormat("en-US", { timeZone: ET, month: "numeric" }).format(now));
  if (month >= 5 && month <= 10) return "Harris CBB: off season";
  const today = etDate(now);
  const out: string[] = [];
  const problems: string[] = [];
  for (const date of [dayBefore(today), today]) {
    const season = seasonOfDate(date);
    if (date < FIRST_DAY(season)) continue;
    if (date < today) {
      const stored = await redis.get<HarrisCbbDay>(HARRIS_DAY(season, date)).catch(() => null);
      const lastTip = (stored?.rows ?? []).map((r) => r.tip ?? "").sort().at(-1) ?? "";
      if (stored?.verified && lastTip && stored.at > lastTip) continue;
    }
    if ((await redis.set(CLAIM(season, date), now.toISOString(), { nx: true, ex: date < today ? YESTERDAY_EVERY_S : TODAY_EVERY_S })) !== "OK") continue;
    try {
      const r = await ingestHarrisCbb(date, now);
      out.push("skipped" in r ? `${date} ${r.skipped}` : `${date} ${r.rows.length} games${r.verified ? "" : `, not verified (${r.problems.length} problems)`}`);
      if (!("skipped" in r) && !r.verified) problems.push(`${date}: ${r.problems[0] ?? "no rows matched"}`);
    } catch (e) {
      // Let the next pulse try again rather than wait out the window.
      await redis.del(CLAIM(season, date)).catch(() => {});
      throw e;
    }
  }
  // A day that reads but does not verify (usually a team name we fold differently) pushes Jack after a streak.
  if (out.length) await watchProblems("Harris CBB feed", problems);
  return out.length ? `Harris CBB: ${out.join("; ")}` : "Harris CBB: nothing due";
}

/** Every day on file this season, oldest first: games and whether it verified. */
export async function harrisCbbDays(season: number): Promise<{ date: string; games: number; verified: boolean }[]> {
  try {
    const all = (await redis.hgetall<{ [date: string]: { games: number; verified: boolean } }>(HARRIS_DAYS(season))) ?? {};
    return Object.entries(all).map(([date, v]) => ({ date, games: v.games, verified: v.verified })).sort((a, b) => a.date.localeCompare(b.date));
  } catch {
    return [];
  }
}
