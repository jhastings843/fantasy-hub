import "server-only";
import { redis } from "@/lib/redis/client";
import { etDate, nbaSeasonOf, nbaSeasonOfDate, nbaWeek, parseNbaPropsLinks, parseNbaPropsPage } from "./parse";
import { gradeGame, type EspnBoxTeam } from "./grade";
import { davidTrends } from "./david";
import { propTrends, type GradedPropsGame } from "./trends";
import { systemOf, type PropsRunReport, type PropsView, type StoredProps } from "./store";
import { PROPS_SECTION, propCandidates } from "./learn";
import { PROPS_GATE, activeIds, sectionView } from "@/lib/learning/engine";
import { loadJournal, loadSection, reviewIfDue } from "@/lib/learning/store";

// Sam's NBA player props, run exactly like the NFL tracker in store.ts: each
// game's page is saved before tip (latest pregame copy wins, the first copy's
// consensus lines kept for line movement), graded from ESPN's box score once
// final, and sliced the same way. Its slices run on the shared learning
// engine (lib/learning) as their own section, with their own evidence.
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

  // Learning: the shared engine's weekly review, on the NBA's own evidence.
  try {
    const cands = propCandidates(await nbaGradedList(season), "nba");
    for (const j of await reviewIfDue(PROPS_SECTION.nba, season, report.week, PROPS_GATE, cands, now)) if (j.kind !== "registered") report.system.push(j.text);
  } catch (e) {
    report.problems.push(`NBA learning: ${e instanceof Error ? e.message : String(e)}`);
  }
  return report;
}

async function nbaGradedList(season: number): Promise<GradedPropsGame[]> {
  const nums = ((await redis.smembers(weeksKey(season))) ?? []).map(Number);
  const weeks = await Promise.all(nums.map(async (n) => [n, await loadNbaWeek(season, n)] as const));
  return weeks
    .flatMap(([week, games]) =>
      Object.entries(games).flatMap(([slug, g]) => (g.result ? [{ week, slug, game: g.game, result: g.result, first: g.first, kickoff: g.kickoff, capturedAt: g.capturedAt, ...(g.late ? { late: g.late } : {}) }] : [])),
    )
    .sort((a, b) => b.week - a.week || (b.kickoff ?? "").localeCompare(a.kickoff ?? "") || a.slug.localeCompare(b.slug));
}

/** Everything the NBA props pages show, in the NFL view's shape (no David board on the NBA side). */
export async function getNbaPropsView(season: number): Promise<PropsView> {
  const nums = ((await redis.smembers(weeksKey(season))) ?? []).map(Number).sort((a, b) => b - a);
  const week = nums[0] ?? null;
  // NBA plays daily: the board is a rolling few days, so a Monday keeps Sunday's games.
  const recent = await Promise.all(nums.slice(0, 2).map((n) => loadNbaWeek(season, n)));
  const current = Object.assign({}, ...recent.reverse()) as { [gameId: string]: StoredProps };
  const graded = await nbaGradedList(season);
  const [state, journal] = await Promise.all([loadSection(PROPS_SECTION.nba, season), loadJournal(PROPS_SECTION.nba, season)]);
  const learning = sectionView(PROPS_GATE, state, propCandidates(graded, "nba"), journal);
  return {
    season,
    week,
    current,
    graded,
    trends: propTrends(graded, "nba"),
    system: systemOf(learning),
    active: activeIds(state),
    david: { week: null, games: [], trends: davidTrends([], new Map()), sam: {} },
    learning,
  };
}
