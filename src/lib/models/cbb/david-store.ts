import "server-only";
import { redis } from "@/lib/redis/client";
import { watchProblems } from "@/lib/notify/problems";
import { boardFor, cbbSeason } from "./store";
import { matchRows } from "./harris";
import { DAVID_DAY, DAVID_DAYS, DAVID_PRE, davidPreOf, fetchDavidCbb, mergeDavid, parseDavidCbb, type DavidCbbDay, type DavidCbbRow } from "./david";

// David Sasser's CBB page into Redis (tracked only; david.ts has the page and
// its signs). His page shows today's games only and drops a game at tip, so
// the pulse reads it every ~30 minutes; a slice keeps his last read before tip.
//
// Redis:
//   models:v1:cbb:{season}:david:day:{yyyy-mm-dd}   the day's cards (DavidCbbDay)
//   models:v1:cbb:{season}:david:days               hash date -> { games, verified }
//   models:v1:cbb:{season}:david:pre                hash event -> DavidPre
//   models:v1:cbb:{season}:david:claim              claim: one read per window

const ET = "America/New_York";
const CLAIM = (season: number) => `models:v1:cbb:${season}:david:claim`;
const EVERY_S = 25 * 60;

const etDate = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: ET }).format(d);

/** His page now: one request to him, one ESPN board per ET date his tips fall on. */
export async function ingestDavidCbb(now = new Date(), html?: string): Promise<DavidCbbDay | { skipped: string }> {
  const page = parseDavidCbb(html ?? (await fetchDavidCbb()));
  if (!page.rows.length) return { skipped: "his page has no games up" };
  const at = now.toISOString();
  // Tips after midnight ET sit on the next ESPN day: match against each date his tips touch.
  const dates = [...new Set(page.rows.map((r) => (r.davidTip ? etDate(new Date(r.davidTip)) : page.date ?? etDate(now))))];
  const boards = (await Promise.all(dates.map((d) => boardFor(d.replace(/-/g, ""))))).flat();
  if (!boards.length) throw new Error(`No college basketball games on our board for ${dates.join(", ")} to match David's page against.`);
  const m = matchRows(page.rows, boards.map((g) => ({ id: g.id, tip: g.tip, home: g.home, away: g.away })));
  const date = page.date ?? dates[0];
  const season = cbbSeason(new Date(`${date}T12:00:00Z`));
  const prior = await redis.get<DavidCbbDay>(DAVID_DAY(season, date)).catch(() => null);
  const merged = mergeDavid(prior?.rows, m.rows as DavidCbbRow[], at);
  const day: DavidCbbDay = {
    season,
    date,
    rows: merged,
    verified: m.rows.length > 0 && m.problems.length === 0,
    problems: m.problems,
    ...(m.setAside.length ? { setAside: m.setAside } : {}),
    ...(page.updated ? { updated: page.updated } : {}),
    at,
  };
  await redis.set(DAVID_DAY(season, date), day);
  await redis.hset(DAVID_DAYS(season), { [date]: { games: merged.length, verified: day.verified } });
  const pre = davidPreOf(merged);
  if (Object.keys(pre).length) await redis.hset(DAVID_PRE(season), pre);
  return day;
}

/** For the hourly pulse: his page at most every 25 minutes, November through April. */
export async function davidCbbIfDue(now = new Date()): Promise<string> {
  const month = Number(new Intl.DateTimeFormat("en-US", { timeZone: ET, month: "numeric" }).format(now));
  if (month >= 5 && month <= 10) return "David CBB: off season";
  const season = cbbSeason(now);
  if ((await redis.set(CLAIM(season), now.toISOString(), { nx: true, ex: EVERY_S })) !== "OK") return "David CBB: nothing due";
  let r: Awaited<ReturnType<typeof ingestDavidCbb>>;
  try {
    r = await ingestDavidCbb(now);
  } catch (e) {
    await redis.del(CLAIM(season)).catch(() => {});
    throw e;
  }
  if ("skipped" in r) return `David CBB: ${r.skipped}`;
  // A name we fold differently leaves a game unmatched: push Jack (three in a row, like Harris).
  await watchProblems("David CBB page", r.verified ? [] : r.problems.slice(0, 3));
  const saved = r.rows.filter((x) => x.pre).length;
  return `David CBB: ${r.date} ${r.rows.length} games, ${saved} with a pregame read${r.verified ? "" : `, not verified (${r.problems.length} problems)`}`;
}

/** Every day on file this season, oldest first. */
export async function davidCbbDays(season: number): Promise<{ date: string; games: number; verified: boolean }[]> {
  try {
    const all = (await redis.hgetall<{ [date: string]: { games: number; verified: boolean } }>(DAVID_DAYS(season))) ?? {};
    return Object.entries(all).map(([date, v]) => ({ date, games: v.games, verified: v.verified })).sort((a, b) => a.date.localeCompare(b.date));
  } catch {
    return [];
  }
}
