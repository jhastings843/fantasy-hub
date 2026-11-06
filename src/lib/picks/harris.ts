import "server-only";
import { redis } from "@/lib/redis/client";
import { watchProblems } from "@/lib/notify/problems";
import { getPicksCore } from "./report";
import { weekOf } from "./parse";
import { type HarrisWeek, type SheetRow, parsePicks, toHarrisRows } from "./harris-sheet";
import { HARRIS_SITE, feedToSheet, fetchHarrisFeed } from "./harris-feed";
import { type HarrisReport, harrisReport, harrisSummary } from "./harris-track";
import { redisStore } from "./learning/store";

// John Harris (@jhnhrris): tracked, never used for a bet (Jack, 2026-10-08).
//
// His per-game lines come from his own website's JSON feed (harris-feed.ts),
// read by the hourly pulse (harrisFeedIfDue). No model, plain JSON. Until
// 2026-11-06 they came from a vision read of the sheet images on his X post;
// from week 8 on he stopped posting the full sheet, so that path is retired.
//
// scripts/pem-relay.mjs on Jack's Mac still finds his weekly "CONTEST PICKS"
// post on X and sends the text: his posted picks come from there. A post
// never touches the sheet rows.

const keyFor = (season: number, week: number) => `picks:v1:cfb:harris:${season}:w${week}`;
const indexKey = (season: number) => `picks:v1:cfb:harris:${season}:weeks`;
const seenKey = (tweetId: string) => `picks:v1:cfb:harris:tweet:${tweetId}`;
/** Set for FEED_EVERY_S after a feed read of that week, so the pulse asks his feed a few times a day at most. */
const feedKey = (season: number, week: number) => `picks:v1:cfb:harris:${season}:feed:w${week}`;
const FEED_EVERY_S = 6 * 3600;
/** One proposal per question, ever (a person decides; the flag stops repeats). */
const PROPOSED = (which: string) => `picks:v2:harris:proposed:${which}`;

/** The games a sheet for `week` can match: that week's finished games and, for the current week, the board. */
async function gamesFor(week: number): Promise<{ away: string; home: string }[]> {
  const core = (await getPicksCore("cfb")).value;
  if (!core) return [];
  const out = new Map<string, { away: string; home: string }>();
  for (const [k] of core.finals) {
    const [w, rest] = [Number(k.split(":")[0]), k.slice(k.indexOf(":") + 1)];
    if (w !== week) continue;
    const [away, home] = rest.split("@");
    out.set(rest, { away, home });
  }
  if (core.week === week) for (const r of core.rows) out.set(`${r.away}@${r.home}`, { away: r.away, home: r.home });
  return [...out.values()];
}

export interface HarrisIngest {
  season: number;
  /** Defaults to the college week of the post date. */
  week?: number;
  tweetId?: string;
  text?: string;
  postedAt?: string;
  /** Sheet rows: from his feed, or typed in by hand. A post (text only) leaves the week's rows as they are. */
  sheet?: SheetRow[];
  /** Where the sheet came from, for the stored week. */
  source?: string;
  /** Verified only when every row matched a game this week (the feed); otherwise any kept row will do. */
  strict?: boolean;
}

export async function ingestHarris(input: HarrisIngest): Promise<HarrisWeek | { skipped: string }> {
  if (input.tweetId && (await redis.get(seenKey(input.tweetId)))) return { skipped: "already read this post" };
  const day = (input.postedAt ? new Date(input.postedAt) : new Date()).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const week = input.week ?? weekOf("cfb", day);
  const prior = await redis.get<HarrisWeek>(keyFor(input.season, week)).catch(() => null);
  const picks = input.text ? parsePicks(input.text) : [];

  let out: HarrisWeek;
  if (input.sheet) {
    const games = await gamesFor(week);
    if (!games.length) throw new Error(`No college games on file for week ${week} to match the sheet against.`);
    const { rows, problems } = toHarrisRows(input.sheet, games);
    if (!rows.length && !picks.length) return { skipped: "no sheet rows matched and no picks" };
    out = {
      season: input.season,
      week,
      rows,
      picks: picks.length ? picks : (prior?.picks ?? []),
      // Every kept row passed its own arithmetic; the feed also needs every game matched.
      verified: rows.length > 0 && (!input.strict || problems.length === 0),
      problems,
      source: input.source ?? "typed in",
      at: new Date().toISOString(),
    };
  } else {
    // A post: his picks only. The rows, and whether they are verified, stay as the feed left them.
    if (!picks.length) return { skipped: "no picks in this post" };
    out = {
      season: input.season,
      week,
      rows: prior?.rows ?? [],
      picks,
      verified: prior?.verified ?? false,
      problems: prior?.problems ?? [],
      source: prior?.source ?? (input.tweetId ? `https://x.com/jhnhrris/status/${input.tweetId}` : "typed in"),
      at: new Date().toISOString(),
    };
  }
  await redis.set(keyFor(input.season, week), out);
  await redis.sadd(indexKey(input.season), week);
  if (input.tweetId) await redis.set(seenKey(input.tweetId), 1, { ex: 60 * 60 * 24 * 60 });
  return out;
}

/** One week from his website feed: one request, no model. */
export async function ingestHarrisFeed(season: number, week: number): Promise<HarrisWeek | { skipped: string }> {
  const table = await fetchHarrisFeed(week);
  if (!table.rows.length) return { skipped: `his feed has no week ${week} games yet` };
  return ingestHarris({ season, week, sheet: feedToSheet(table), source: HARRIS_SITE, strict: true });
}

/**
 * For the hourly pulse: the current college week from his feed, at most
 * every six hours, and the week before it while it is not verified (his
 * final lines land after the games). Two requests at most per run.
 */
export async function harrisFeedIfDue(): Promise<string> {
  const core = (await getPicksCore("cfb")).value;
  if (!core?.week) return "Harris feed: college core unavailable";
  const season = core.season;
  const out: string[] = [];
  const problems: string[] = [];
  for (const week of [core.week - 1, core.week].filter((w) => w >= 1)) {
    if (week < core.week) {
      const stored = await redis.get<HarrisWeek>(keyFor(season, week)).catch(() => null);
      if (stored?.verified && stored.source === HARRIS_SITE) continue;
    }
    if ((await redis.set(feedKey(season, week), new Date().toISOString(), { nx: true, ex: FEED_EVERY_S })) !== "OK") continue;
    try {
      const r = await ingestHarrisFeed(season, week);
      out.push("skipped" in r ? `w${week} ${r.skipped}` : `w${week} ${r.rows.length} games${r.verified ? "" : `, not verified (${r.problems.length} problems)`}`);
      if (!("skipped" in r) && !r.verified) problems.push(`week ${week}: ${r.problems[0] ?? "no rows matched"}`);
    } catch (e) {
      // Let the next pulse try again rather than wait six hours.
      await redis.del(feedKey(season, week)).catch(() => {});
      throw e;
    }
  }
  // A week that reads but does not verify (usually a team name we fold differently) pushes Jack after a streak.
  if (out.length) await watchProblems("Harris feed", problems);
  return out.length ? `Harris feed: ${out.join("; ")}` : "Harris feed: nothing due";
}

export async function harrisWeeks(season: number): Promise<HarrisWeek[]> {
  try {
    const weeks = (await redis.smembers(indexKey(season))).map(Number).sort((a, b) => a - b);
    const all = await Promise.all(weeks.map((w) => redis.get<HarrisWeek>(keyFor(season, w))));
    return all.filter((w): w is HarrisWeek => !!w);
  } catch {
    return [];
  }
}

/** The tracker as of now, from the stored sheets and the college core's finals and graded games. */
export async function harrisNow(): Promise<HarrisReport | null> {
  const core = (await getPicksCore("cfb")).value;
  if (!core) return null;
  return harrisReport(await harrisWeeks(core.season), new Map(core.finals), core.graded);
}

/**
 * Run with each strategy review: if either question clears the bar, file a
 * proposal once (a person decides; nothing changes a bet). Returns the summary.
 */
export async function harrisReview(now = new Date()): Promise<string> {
  const r = await harrisNow();
  if (!r) return "Harris tracker: college core unavailable.";
  const summary = harrisSummary(r);
  const which = r.clears.agreement ? "agreement" : r.clears.picks ? "picks" : r.clears.edge ? "edge" : null;
  if (which && (await redis.set(PROPOSED(which), now.toISOString(), { nx: true })) === "OK") {
    await redisStore.append({
      at: now.toISOString(),
      kind: "proposal",
      title:
        which === "agreement"
          ? "Proposal: use Harris agreement as a college filter"
          : which === "picks"
            ? "Proposal: Harris's posted picks as a college signal"
            : "Proposal: Harris's 3+ point edges as a college signal",
      why: `${summary} A person decides whether to add it to the rule; nothing changes on its own.`,
      evidence: r,
    });
  }
  return summary;
}
