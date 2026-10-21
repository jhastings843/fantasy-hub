import "server-only";
import { redis } from "@/lib/redis/client";
import { parseBoardLinks, parseFirstTdPage, parseSlug, type FtdGame } from "./parse";
import { firstTouchdown, grade, samTeam, type EspnScoringPlay, type Graded } from "./grade";
import { trends, type GradedGame, type Trends } from "./trends";
import { kalshiFirstTd, type KalshiGame } from "./kalshi";
import { isMembersPage } from "@/lib/props/parse";
import { FTD_SECTION, ftdCandidates } from "./learn";
import { FTD_GATE, sectionView, type SectionView } from "@/lib/learning/engine";
import { loadJournal, loadSection, reviewIfDue } from "@/lib/learning/store";

// The first TD tracker's memory. Sam only keeps the current week online, so
// each game's page is saved before kickoff (the latest pregame copy wins, as
// his injury notes change through the week) and graded from ESPN once the
// game is final. A game first seen after kickoff is never saved: a copy read
// mid-game could already know the answer.
//
// One Redis value per week, plus a set of the weeks on file.

const SAM_BOARD = "https://samthemodelman.smmodel.workers.dev/nfl/";
const SAM_PAGE = (slug: string) => `https://samthemodelman.smmodel.workers.dev/nfl/firsttd/${slug}.html`;
const ESPN = "https://site.api.espn.com/apis/site/v2/sports/football/nfl";
const UA = { "user-agent": "Mozilla/5.0 (fantasy-hub first TD tracker)" };

const weekKey = (season: number, week: number) => `ftd:v1:${season}:w${week}`;
const weeksKey = (season: number) => `ftd:v1:${season}:weeks`;

export interface StoredGame {
  game: FtdGame;
  capturedAt: string;
  firstSeenAt: string;
  kickoff?: string;
  espnId?: string;
  /** Kalshi's first TD prices, read at the same capture as the page. */
  kalshi?: KalshiGame;
  result?: Graded;
  gradedAt?: string;
}
export interface StoredWeek {
  season: number;
  week: number;
  games: { [slug: string]: StoredGame };
}

async function get(url: string): Promise<string> {
  const res = await fetch(url, { cache: "no-store", headers: UA, signal: AbortSignal.timeout(12_000) });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return res.text();
}
async function json<T>(url: string): Promise<T> {
  return JSON.parse(await get(url)) as T;
}

interface EspnEvent {
  id: string;
  date?: string;
  status?: { type?: { state?: string; completed?: boolean } };
  competitions?: { competitors?: { homeAway?: string; team?: { abbreviation?: string } }[] }[];
}

/** The week's ESPN games keyed "AWAY@HOME" in Sam's team codes. */
async function espnWeek(season: number, week: number) {
  const data = await json<{ events?: EspnEvent[] }>(`${ESPN}/scoreboard?week=${week}&seasontype=2&dates=${season}`);
  const out = new Map<string, { id: string; kickoff?: string; state: string; completed: boolean }>();
  for (const e of data.events ?? []) {
    const cs = e.competitions?.[0]?.competitors ?? [];
    const h = samTeam(cs.find((c) => c.homeAway === "home")?.team?.abbreviation ?? "");
    const a = samTeam(cs.find((c) => c.homeAway === "away")?.team?.abbreviation ?? "");
    out.set(`${a}@${h}`, { id: e.id, kickoff: e.date, state: e.status?.type?.state ?? "", completed: !!e.status?.type?.completed });
  }
  return out;
}

export async function loadWeek(season: number, week: number): Promise<StoredWeek> {
  return (await redis.get<StoredWeek>(weekKey(season, week))) ?? { season, week, games: {} };
}
async function saveWeek(w: StoredWeek) {
  await redis.set(weekKey(w.season, w.week), w);
  await redis.sadd(weeksKey(w.season), String(w.week));
}

export interface RunReport {
  week: number | null;
  captured: string[];
  kept: string[];
  missed: string[];
  /** Not published yet: Sam releases the Sunday and Monday pages on Saturday. */
  waiting: string[];
  graded: string[];
  /** What the learning review did, when it ran. */
  learning: string[];
  /** Pages behind Sam's members paywall (since 2026-10-21): skipped, not a problem. */
  paywalled: string[];
  problems: string[];
}

/** Save this week's pregame pages and grade anything final. Safe to call any time. */
export async function runFirstTd(now = new Date()): Promise<RunReport> {
  const report: RunReport = { week: null, captured: [], kept: [], missed: [], waiting: [], graded: [], learning: [], paywalled: [], problems: [] };
  let slugs: string[] = [];
  try {
    slugs = parseBoardLinks(await get(SAM_BOARD));
  } catch (e) {
    report.problems.push(`Sam's board: ${e instanceof Error ? e.message : String(e)}`);
  }
  const first = slugs.map(parseSlug).find(Boolean);
  if (first) {
    report.week = first.week;
    const w = await loadWeek(first.season, first.week);
    let espn = new Map<string, { id: string; kickoff?: string; state: string; completed: boolean }>();
    try {
      espn = await espnWeek(first.season, first.week);
    } catch (e) {
      report.problems.push(`ESPN week ${first.week}: ${e instanceof Error ? e.message : String(e)}`);
    }
    let kalshi = new Map<string, KalshiGame>();
    try {
      kalshi = await kalshiFirstTd(now);
    } catch (e) {
      report.problems.push(`Kalshi: ${e instanceof Error ? e.message : String(e)}`);
    }
    for (const slug of slugs) {
      const id = parseSlug(slug);
      if (!id || id.week !== first.week) continue;
      const ev = espn.get(`${id.away}@${id.home}`);
      const have = w.games[slug];
      const k = kalshi.get(`${id.away}@${id.home}`) ?? have?.kalshi;
      // Pregame only: ESPN says "pre", or ESPN hasn't answered and the clock agrees.
      const pre = ev ? ev.state === "pre" : !have?.kickoff || new Date(have.kickoff) > now;
      if (!pre) {
        if (have) report.kept.push(slug);
        else report.missed.push(slug);
        continue;
      }
      try {
        const html = await get(SAM_PAGE(slug));
        if (isMembersPage(html)) {
          report.paywalled.push(slug);
          continue;
        }
        if (/Not out yet/i.test(html) && !/class="ftd-pick"/.test(html)) {
          if (!have) report.waiting.push(slug);
          continue;
        }
        const g = parseFirstTdPage(slug, html);
        if (!g) throw new Error("page did not read");
        w.games[slug] = {
          ...have,
          game: g,
          capturedAt: now.toISOString(),
          firstSeenAt: have?.firstSeenAt ?? now.toISOString(),
          ...(k ? { kalshi: k } : {}),
          ...(ev ? { kickoff: ev.kickoff, espnId: ev.id } : {}),
        };
        report.captured.push(slug);
      } catch (e) {
        report.problems.push(`${slug}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    await saveWeek(w);
  }

  // Grade every saved week with ungraded games (this one and any before it).
  const season = first?.season ?? now.getUTCFullYear();
  const weeks = ((await redis.smembers(weeksKey(season))) ?? []).map(Number).sort((a, b) => a - b);
  for (const wk of weeks) {
    const w = await loadWeek(season, wk);
    const open = Object.entries(w.games).filter(([, g]) => !g.result);
    if (!open.length) continue;
    let espn: Awaited<ReturnType<typeof espnWeek>>;
    try {
      espn = await espnWeek(season, wk);
    } catch (e) {
      report.problems.push(`ESPN week ${wk}: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    let changed = false;
    for (const [slug, g] of open) {
      const ev = espn.get(`${g.game.away}@${g.game.home}`);
      if (!ev?.completed) continue;
      try {
        const sum = await json<{ scoringPlays?: EspnScoringPlay[] }>(`${ESPN}/summary?event=${ev.id}`);
        g.result = grade(g.game, firstTouchdown(sum.scoringPlays ?? []));
        g.gradedAt = now.toISOString();
        g.espnId = ev.id;
        changed = true;
        report.graded.push(slug);
      } catch (e) {
        report.problems.push(`grade ${slug}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    if (changed) await saveWeek(w);
  }

  // Learning: the shared engine's weekly review on the money checks (FTD_GATE).
  try {
    const current = first?.week ?? weeks.at(-1) ?? 0;
    const graded = await gradedGames(season);
    for (const j of await reviewIfDue(FTD_SECTION, season, current, FTD_GATE, ftdCandidates(graded), now)) if (j.kind !== "registered") report.learning.push(j.text);
  } catch (e) {
    report.problems.push(`learning: ${e instanceof Error ? e.message : String(e)}`);
  }
  return report;
}

async function gradedGames(season: number): Promise<(GradedGame & { slug: string; week: number })[]> {
  const nums = ((await redis.smembers(weeksKey(season))) ?? []).map(Number);
  const weeks = await Promise.all(nums.map((n) => loadWeek(season, n)));
  return weeks
    .flatMap((w) =>
      Object.entries(w.games).flatMap(([slug, g]) => (g.result ? [{ slug, week: w.week, game: g.game, result: g.result, kalshi: g.kalshi, kickoff: g.kickoff, capturedAt: g.capturedAt }] : [])),
    )
    .sort((a, b) => b.week - a.week || a.slug.localeCompare(b.slug));
}

export interface FirstTdView {
  season: number;
  current: StoredWeek | null;
  weeks: StoredWeek[];
  graded: (GradedGame & { slug: string; week: number })[];
  trends: Trends;
  /** The shared learning engine's view of First TD. */
  learning: SectionView;
}

/** Everything the tab shows, read from Redis only. */
export async function getFirstTdView(season: number): Promise<FirstTdView> {
  const nums = ((await redis.smembers(weeksKey(season))) ?? []).map(Number).sort((a, b) => b - a);
  const weeks = (await Promise.all(nums.map((n) => loadWeek(season, n)))).filter((w) => Object.keys(w.games).length);
  const graded = await gradedGames(season);
  const [state, journal] = await Promise.all([loadSection(FTD_SECTION, season), loadJournal(FTD_SECTION, season)]);
  return { season, current: weeks[0] ?? null, weeks, graded, trends: trends(graded), learning: sectionView(FTD_GATE, state, ftdCandidates(graded), journal) };
}
