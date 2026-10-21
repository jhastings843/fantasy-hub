import "server-only";
import { redis } from "@/lib/redis/client";
import { etDate, nbaSeasonOfDate, nbaWeek } from "@/lib/props/parse";
import { settle } from "@/lib/props/grade";
import { push } from "@/lib/notify/pushover";
import { affected, changes, followup, readFeed, type Affected, type FeedEntry, type Followup, type StatusChange } from "./news";
import { K, loadWeek, runOurNbaProps, scoreboard, type OurStoredProps } from "./store";
import type { PlayerEntry } from "./history";

// The injury-news watcher, run by the pulse every fifteen minutes (news.ts
// has the rules). Redis:
//   news:v1:nba:status:{date}       hash athlete id -> status at the last read (Eastern date)
//   news:v1:nba:{season}:events     hash event id -> NewsEvent

const FEED = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/injuries";
const STATUS = (date: string) => `news:v1:nba:status:${date}`;
const EVENTS = (s: number) => `news:v1:nba:${s}:events`;
/** A rotation player: this many minutes a game over his last five, or last season when he has under three games. */
const ROTATION_MIN = 15;
/** Games repriced per run, so one pulse stays inside its time. */
const MAX_GAMES = 3;
const APP = process.env.APP_URL ?? "https://fantasy-hub-tan.vercel.app";

export interface NewsEvent {
  id: string;
  at: string;
  date: string;
  game: string;
  week: number;
  away: string;
  home: string;
  tip: string;
  news: StatusChange;
  affected: Affected[];
  /** Filled once the game has tipped: DK at its last pregame copy, and the result once final. */
  after?: { [marketId: string]: Followup };
  gradedAt?: string;
}

const rotationPlayer = (e: PlayerEntry | undefined, priorMinPerGame: number | null) => {
  const g = e?.games.slice(-5) ?? [];
  if (g.length >= 3) return g.reduce((a, x) => a + x.min, 0) / g.length >= ROTATION_MIN;
  return (priorMinPerGame ?? 0) >= ROTATION_MIN;
};

export async function runNbaNews(now = new Date()): Promise<string> {
  const season = nbaSeasonOfDate(now);
  const date = etDate(now);
  const games = (await scoreboard(now, 0, 0)).filter((g) => g.state === "pre" && g.tip && new Date(g.tip) > now);
  const graded = await gradeEvents(season, now);
  if (!games.length) return `no NBA games ahead today${graded ? `; graded ${graded}` : ""}`;

  const res = await fetch(FEED, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`ESPN injuries answered ${res.status}`);
  const teams = new Set(games.flatMap((g) => g.teams.map((t) => t.abbr)));
  const feed = readFeed(await res.json()).filter((e) => teams.has(e.team));
  const prev = (await redis.hgetall<{ [id: string]: string }>(STATUS(date))) ?? {};
  const save = async () => {
    await redis.del(STATUS(date));
    await redis.hset(STATUS(date), { "_": "read", ...Object.fromEntries(feed.map((e) => [e.id, e.status])) });
    await redis.expire(STATUS(date), 3 * 86_400);
  };
  // The day's first read is the baseline: everything on it was known this morning.
  if (!Object.keys(prev).length) {
    await save();
    return `baseline: ${feed.filter((e) => e.status === "Out").length} out on ${teams.size} teams`;
  }
  delete prev["_"];

  const all = changes(prev, feed);
  if (!all.length) {
    await save();
    return `no changes${graded ? `; graded ${graded}` : ""}`;
  }
  // Rotation players only.
  const prior = await redis.get<{ priors: { [id: string]: { games: number; min: number } } }>(K.prior(season));
  const entries = (await redis.hmget<{ [id: string]: PlayerEntry }>(K.players(season), ...all.map((c) => c.id))) ?? {};
  const news = all.filter((c) => {
    const pr = prior?.priors[c.id];
    return rotationPlayer(entries[c.id], pr && pr.games ? pr.min / pr.games : null);
  });
  const lines: string[] = [];
  const outIds = new Set(feed.filter((e) => e.status === "Out").map((e) => e.id));
  const backIds = new Set(news.filter((c) => c.change === "back").map((c) => c.id));
  const byGame = new Map<string, StatusChange[]>();
  for (const c of news) {
    const g = games.find((x) => x.teams.some((t) => t.abbr === c.team));
    if (g) byGame.set(g.id, [...(byGame.get(g.id) ?? []), c]);
  }
  for (const [gid, cs] of [...byGame].slice(0, MAX_GAMES)) {
    const g = games.find((x) => x.id === gid)!;
    const week = nbaWeek(new Date(g.tip!), season);
    const before: OurStoredProps | undefined = (await loadWeek(season, week))[gid];
    const r = await runOurNbaProps(now, { only: new Set([gid]), extraOut: outIds, extraIn: backIds });
    const after: OurStoredProps | undefined = (await loadWeek(season, week))[gid];
    // Only teammates' minutes change, so the moved props are the news team's (both teams' when news hits each side).
    const hit = before && after && after.capturedAt !== before.capturedAt ? affected(before.game.markets, after.game.markets, after.extra) : [];
    const away = g.teams.find((t) => !t.home)?.abbr ?? "";
    const home = g.teams.find((t) => t.home)?.abbr ?? "";
    for (const c of cs) {
      const ev: NewsEvent = { id: `${date}|${c.id}|${c.change}`, at: now.toISOString(), date, game: gid, week, away, home, tip: g.tip!, news: c, affected: hit.slice(0, 20) };
      await redis.hset(EVENTS(season), { [ev.id]: ev });
    }
    const edges = hit.filter((a) => a.edge && a.gap !== null && a.gap > 0).slice(0, 3);
    const who = cs.map((c) => `${c.name} ${c.change === "out" ? "OUT" : "back"}`).join(", ");
    lines.push(`${away}@${home}: ${who}; ${hit.length} props moved, ${edges.length} edges${r.problems.length ? ` (${r.problems.join("; ")})` : ""}`);
    if (edges.length) {
      const fmt = (a: Affected) => `${a.player} ${a.side} ${a.line} ${a.stat}${a.price !== null ? ` ${a.price > 0 ? "+" : ""}${a.price}` : ""}: ours ${a.after} (${Math.round(a.chance * 100)}%)`;
      await push({ title: `NBA news: ${who}`, message: edges.map(fmt).join("\n"), url: `${APP}/props?m=nba`, urlTitle: "Open NBA props" });
    }
  }
  await save();
  return lines.join(" | ") || `${all.length} changes, none a rotation player`;
}

/** Grade events whose game has tipped: DK's last pregame line per market, and the result once final. */
async function gradeEvents(season: number, now: Date): Promise<number> {
  const evs = Object.values((await redis.hgetall<{ [id: string]: NewsEvent }>(EVENTS(season))) ?? {}).filter((e) => !e.gradedAt && new Date(e.tip) <= now);
  let n = 0;
  for (const e of evs) {
    const board = (await loadWeek(season, e.week))[e.game];
    if (!board?.result) continue;
    const res = new Map(board.result.markets.map((m) => [m.id, m]));
    const after: NewsEvent["after"] = {};
    for (const a of e.affected) {
      const actual = res.get(a.id)?.actual;
      after[a.id] = followup(a, board.game.markets.find((m) => m.id === a.id), actual === null || actual === undefined ? undefined : settle(a.side, a.line, actual));
    }
    await redis.hset(EVENTS(season), { [e.id]: { ...e, after, gradedAt: now.toISOString() } });
    n++;
  }
  return n;
}

export async function getNewsEvents(season: number): Promise<NewsEvent[]> {
  const h = (await redis.hgetall<{ [id: string]: NewsEvent }>(EVENTS(season))) ?? {};
  return Object.values(h).sort((a, b) => b.at.localeCompare(a.at));
}

export type { FeedEntry };
