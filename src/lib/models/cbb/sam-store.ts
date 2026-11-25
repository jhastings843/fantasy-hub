import "server-only";
import { redis } from "@/lib/redis/client";
import { watchProblems } from "@/lib/notify/problems";
import { boardFor, cbbSeason } from "./store";
import { SAM_DAY, SAM_DAYS, SAM_PRE, fetchSamCbb, matchSamRows, mergeSam, parseSamCbb, samPreOf, type SamCbbDay } from "./sam";

// Sam's CBB page into Redis (tracked only; sam.ts has the page and its signs).
// His page shows today's games, so the pulse reads it every ~25 minutes and a
// slice keeps his last read before tip, the same as David.
//
// Redis:
//   models:v1:cbb:{season}:sam:day:{yyyy-mm-dd}   the day's cards (SamCbbDay)
//   models:v1:cbb:{season}:sam:days               hash date -> { games, verified }
//   models:v1:cbb:{season}:sam:pre                hash event -> SamPre
//   models:v1:cbb:{season}:sam:claim              claim: one read per window

const ET = "America/New_York";
const CLAIM = (season: number) => `models:v1:cbb:${season}:sam:claim`;
const EVERY_S = 25 * 60;

const etDate = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: ET }).format(d);

/** His page now: one request to him, today's ESPN board (and tomorrow's, for a late tip past midnight ET). */
export async function ingestSamCbb(now = new Date(), html?: string): Promise<SamCbbDay | { skipped: string }> {
  const page = parseSamCbb(html ?? (await fetchSamCbb()));
  if (!page.rows.length) return { skipped: "his page has no games up" };
  const at = now.toISOString();
  const date = etDate(now);
  const next = etDate(new Date(now.getTime() + 86_400_000));
  const boards = (await Promise.all([date, next].map((d) => boardFor(d.replace(/-/g, ""))))).flat();
  if (!boards.length) throw new Error(`No college basketball games on our board for ${date} to match Sam's page against.`);
  const m = matchSamRows(page.rows, boards.map((g) => ({ id: g.id, tip: g.tip, home: { id: g.home.id, name: g.home.name }, away: { id: g.away.id, name: g.away.name } })));
  const problems = m.problems;
  const rows = m.rows;
  const season = cbbSeason(new Date(`${date}T12:00:00Z`));
  const prior = await redis.get<SamCbbDay>(SAM_DAY(season, date)).catch(() => null);
  const merged = mergeSam(prior?.rows, rows, at);
  const day: SamCbbDay = {
    season,
    date,
    rows: merged,
    verified: rows.some((r) => r.event) && problems.length === 0,
    problems,
    ...(page.updated ? { updated: page.updated } : {}),
    at,
  };
  await redis.set(SAM_DAY(season, date), day);
  await redis.hset(SAM_DAYS(season), { [date]: { games: merged.length, verified: day.verified } });
  const pre = samPreOf(merged);
  if (Object.keys(pre).length) await redis.hset(SAM_PRE(season), pre);
  return day;
}

/** For the pulse: his page at most every 25 minutes, November through April. */
export async function samCbbIfDue(now = new Date()): Promise<string> {
  const month = Number(new Intl.DateTimeFormat("en-US", { timeZone: ET, month: "numeric" }).format(now));
  if (month >= 5 && month <= 10) return "Sam CBB: off season";
  const season = cbbSeason(now);
  if ((await redis.set(CLAIM(season), now.toISOString(), { nx: true, ex: EVERY_S })) !== "OK") return "Sam CBB: nothing due";
  let r: Awaited<ReturnType<typeof ingestSamCbb>>;
  try {
    r = await ingestSamCbb(now);
  } catch (e) {
    await redis.del(CLAIM(season)).catch(() => {});
    throw e;
  }
  if ("skipped" in r) return `Sam CBB: ${r.skipped}`;
  await watchProblems("Sam CBB page", r.verified ? [] : r.problems.slice(0, 3));
  const saved = r.rows.filter((x) => x.pre).length;
  return `Sam CBB: ${r.date} ${r.rows.length} games, ${saved} with a pregame read${r.verified ? "" : `, not verified (${r.problems.length} problems)`}`;
}

/** Every day on file this season, oldest first. */
export async function samCbbDays(season: number): Promise<{ date: string; games: number; verified: boolean }[]> {
  try {
    const all = (await redis.hgetall<{ [date: string]: { games: number; verified: boolean } }>(SAM_DAYS(season))) ?? {};
    return Object.entries(all).map(([date, v]) => ({ date, games: v.games, verified: v.verified })).sort((a, b) => a.date.localeCompare(b.date));
  } catch {
    return [];
  }
}
