import "server-only";
import { redis } from "@/lib/redis/client";
import { etDate, nbaSeasonOf, nbaSeasonOfDate, nbaWeek, parseNbaPropsLinks, parseNbaPropsPage } from "./parse";
import { gradeGame, type EspnBoxTeam } from "./grade";
import { davidTrends } from "./david";
import { propTrends, sliceBets, Z_RETIRE, type GradedPropsGame } from "./trends";
import type { PropsRunReport, PropsView, StoredProps, SystemEntry } from "./store";

// Sam's NBA player props, run exactly like the NFL tracker in store.ts: each
// game's page is saved before tip (latest pregame copy wins, the first copy's
// consensus lines kept for line movement), graded from ESPN's box score once
// final, and sliced the same way. A slice joins the NBA system when its record
// on weeks before the current one clears the bar, counts money from the week
// it joined, and retires when its full record falls under z 1.
//
// NBA games are daily, so "week" is a Monday-to-Sunday week of the season:
// week 1 is the week holding October 21 of the season's first year. Sam's
// pages are named by the NBA's game id; ESPN's scoreboard supplies tip time,
// state and the event id for the box score.

const SAM_BOARD = "https://samthemodelman.smmodel.workers.dev/nba/";
const SAM_PAGE = (id: string) => `https://samthemodelman.smmodel.workers.dev/nba/props/${id}.html`;
const ESPN = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba";
const UA = { "user-agent": "Mozilla/5.0 (fantasy-hub props tracker)" };

const weekKey = (season: number, week: number) => `props:v1:nba:${season}:w${week}`;
const weeksKey = (season: number) => `props:v1:nba:${season}:weeks`;
const systemKey = (season: number) => `props:v1:nba:${season}:system`;

/** Sam writes the NBA's abbreviations; ESPN shortens a few. */
const TO_ESPN: { [k: string]: string } = { GSW: "GS", NYK: "NY", SAS: "SA", NOP: "NO", UTA: "UTAH", WAS: "WSH" };
const espnAbbr = (a: string) => TO_ESPN[a] ?? a;

async function get(url: string): Promise<string> {
  const res = await fetch(url, { cache: "no-store", headers: UA, signal: AbortSignal.timeout(12_000) });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return res.text();
}

interface EspnGame {
  id: string;
  tip?: string;
  state: string;
  completed: boolean;
  teams: string[];
}

/** ESPN's NBA games for a few Eastern days starting today, keyed by team. */
async function espnDays(now: Date, days = 3): Promise<EspnGame[]> {
  const out: EspnGame[] = [];
  for (let i = -1; i < days; i++) {
    const d = etDate(new Date(now.getTime() + i * 86_400_000)).replace(/-/g, "");
    const data = JSON.parse(await get(`${ESPN}/scoreboard?dates=${d}`)) as {
      events?: { id: string; date?: string; status?: { type?: { state?: string; completed?: boolean } }; competitions?: { competitors?: { team?: { abbreviation?: string } }[] }[] }[];
    };
    for (const e of data.events ?? []) {
      out.push({
        id: e.id,
        tip: e.date,
        state: e.status?.type?.state ?? "",
        completed: !!e.status?.type?.completed,
        teams: (e.competitions?.[0]?.competitors ?? []).map((c) => c.team?.abbreviation ?? "").filter(Boolean),
      });
    }
  }
  return out;
}

const findGame = (games: EspnGame[], away: string, home: string) =>
  games.find((g) => g.teams.includes(espnAbbr(away)) && g.teams.includes(espnAbbr(home)));

export async function loadNbaWeek(season: number, week: number): Promise<{ [gameId: string]: StoredProps }> {
  return (await redis.hgetall<{ [gameId: string]: StoredProps }>(weekKey(season, week))) ?? {};
}
async function saveGame(season: number, week: number, gameId: string, g: StoredProps) {
  await redis.hset(weekKey(season, week), { [gameId]: g });
  await redis.sadd(weeksKey(season), String(week));
}
export async function loadNbaSystem(season: number): Promise<SystemEntry[]> {
  const h = (await redis.hgetall<{ [id: string]: SystemEntry }>(systemKey(season))) ?? {};
  return Object.values(h).sort((a, b) => a.since - b.since || a.id.localeCompare(b.id));
}

/** Save today's pregame NBA props pages, grade finals, update the NBA system. Safe to call any time. */
export async function runNbaProps(now = new Date()): Promise<PropsRunReport> {
  const report: PropsRunReport = { week: null, captured: [], kept: [], missed: [], graded: [], system: [], david: { week: null, saved: [], graded: [] }, problems: [] };
  let ids: string[] = [];
  try {
    ids = parseNbaPropsLinks(await get(SAM_BOARD));
  } catch (e) {
    report.problems.push(`Sam's NBA board: ${e instanceof Error ? e.message : String(e)}`);
  }
  const season = ids.map(nbaSeasonOf).find((x): x is number => x !== null) ?? nbaSeasonOfDate(now);
  report.week = nbaWeek(now, season);
  let espn: EspnGame[] = [];
  try {
    espn = await espnDays(now);
  } catch (e) {
    report.problems.push(`ESPN NBA scoreboard: ${e instanceof Error ? e.message : String(e)}`);
  }

  for (const id of ids) {
    try {
      const html = await get(SAM_PAGE(id));
      const t = html.match(/<title>\s*([A-Z]{2,4}) at ([A-Z]{2,4})/);
      const ev = t ? findGame(espn, t[1], t[2]) : undefined;
      if (!ev?.tip) {
        report.problems.push(`${id}: no ESPN game for ${t ? `${t[1]} at ${t[2]}` : "this page"}`);
        continue;
      }
      const week = nbaWeek(new Date(ev.tip), season);
      const old = (await loadNbaWeek(season, week))[id];
      if (ev.state !== "pre" || new Date(ev.tip) <= now) {
        (old ? report.kept : report.missed).push(id);
        continue;
      }
      const g = parseNbaPropsPage(id, html, week);
      if (!g) throw new Error("page did not read");
      await saveGame(season, week, id, {
        ...old,
        game: g,
        capturedAt: now.toISOString(),
        firstSeenAt: old?.firstSeenAt ?? now.toISOString(),
        first: { ...Object.fromEntries(g.markets.map((m) => [m.id, m.consensus])), ...old?.first },
        kickoff: ev.tip,
        espnId: ev.id,
      });
      report.captured.push(id);
    } catch (e) {
      report.problems.push(`${id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Grade every saved game whose ESPN game is final.
  const weeks = ((await redis.smembers(weeksKey(season))) ?? []).map(Number).sort((a, b) => a - b);
  for (const wk of weeks) {
    const games = await loadNbaWeek(season, wk);
    for (const [id, g] of Object.entries(games)) {
      if (g.result || !g.espnId || (g.kickoff && new Date(g.kickoff) > now)) continue;
      try {
        const sum = JSON.parse(await get(`${ESPN}/summary?event=${g.espnId}`)) as {
          header?: { competitions?: { status?: { type?: { completed?: boolean } } }[] };
          boxscore?: { players?: EspnBoxTeam[] };
        };
        if (!sum.header?.competitions?.[0]?.status?.type?.completed) continue;
        if (!sum.boxscore?.players?.length) throw new Error("no box score yet");
        await saveGame(season, wk, id, { ...g, result: gradeGame(g.game, sum.boxscore.players, {}, "nba"), gradedAt: now.toISOString() });
        report.graded.push(id);
      } catch (e) {
        report.problems.push(`grade ${id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  // The system, the NFL tracker's rule: join on weeks before this one, money from this week on.
  try {
    const current = report.week;
    const graded = (await nbaGradedList(season)).filter((x) => !x.late);
    const before = propTrends(graded.filter((x) => x.week < current), "nba").slices;
    const all = propTrends(graded, "nba").slices;
    const sys = new Map((await loadNbaSystem(season)).map((e) => [e.id, e]));
    for (const sl of before) {
      if (sl.verdict !== "profitable" || sys.has(sl.id) || current < 1) continue;
      const e: SystemEntry = { id: sl.id, label: sl.label, since: current, at: now.toISOString(), z: sl.z ?? 0, n: sl.n };
      if (await redis.hsetnx(systemKey(season), sl.id, e)) report.system.push(`joined: ${sl.label}`);
    }
    for (const e of sys.values()) {
      if (e.retired) continue;
      const sl = all.find((x) => x.id === e.id);
      if (sl && sl.z !== null && sl.z < Z_RETIRE) {
        await redis.hset(systemKey(season), { [e.id]: { ...e, retired: { week: current, at: now.toISOString(), z: sl.z } } });
        report.system.push(`retired: ${e.label}`);
      }
    }
  } catch (e) {
    report.problems.push(`NBA system: ${e instanceof Error ? e.message : String(e)}`);
  }
  return report;
}

async function nbaGradedList(season: number): Promise<GradedPropsGame[]> {
  const nums = ((await redis.smembers(weeksKey(season))) ?? []).map(Number);
  const weeks = await Promise.all(nums.map(async (n) => [n, await loadNbaWeek(season, n)] as const));
  return weeks
    .flatMap(([week, games]) =>
      Object.entries(games).flatMap(([slug, g]) => (g.result ? [{ week, slug, game: g.game, result: g.result, first: g.first, kickoff: g.kickoff, ...(g.late ? { late: g.late } : {}) }] : [])),
    )
    .sort((a, b) => b.week - a.week || (b.kickoff ?? "").localeCompare(a.kickoff ?? "") || a.slug.localeCompare(b.slug));
}

/** Everything the NBA props pages show, in the NFL view's shape (no David board on the NBA side). */
export async function getNbaPropsView(season: number): Promise<PropsView> {
  const nums = ((await redis.smembers(weeksKey(season))) ?? []).map(Number).sort((a, b) => b - a);
  const week = nums[0] ?? null;
  const current = week ? await loadNbaWeek(season, week) : {};
  const graded = await nbaGradedList(season);
  const sys = await loadNbaSystem(season);
  const system = sys.map((e) => {
    const bets = sliceBets(graded, e.id).filter((b) => b.week >= e.since && (!e.retired || b.week < e.retired.week));
    const w = bets.filter((b) => b.bet.outcome === "W").length;
    const l = bets.filter((b) => b.bet.outcome === "L").length;
    return { ...e, w, l, p: bets.length - w - l, units: Math.round(bets.reduce((a, b) => a + b.bet.net, 0) * 100) / 100 };
  });
  return {
    season,
    week,
    current,
    graded,
    trends: propTrends(graded, "nba"),
    system,
    active: sys.filter((e) => !e.retired).map((e) => e.id),
    david: { week: null, games: [], trends: davidTrends([], new Map()), sam: {} },
  };
}
