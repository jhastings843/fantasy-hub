import "server-only";
import { redis } from "@/lib/redis/client";
import { samTeam, firstTouchdown, grade, type EspnScoringPlay, type Graded } from "@/lib/firsttd/grade";
import { kalshiFirstTd, type KalshiGame } from "@/lib/firsttd/kalshi";
import type { FtdGame } from "@/lib/firsttd/parse";
import type { GradedGame } from "@/lib/firsttd/trends";
import { nameKey } from "@/lib/props/grade";
import { FTD_GATE, sectionView, type SectionView } from "@/lib/learning/engine";
import { loadJournal, loadSection, reviewIfDue } from "@/lib/learning/store";
import { OUR_SECTION, ourFtdCandidates } from "../learn";
import { addTotals, ftdGame, impliedPoints, tdTotals, type FtdParams, type TdLine } from "./firsttd";
import { nflverseRows } from "./store";
import PARAMS from "./ftd-params.json";

// Our NFL First TD model, live. Each run, for every game this week not yet
// started: each team's players from its last 3 games (nflverse) less anyone
// ESPN lists Out, their TD history (last season plus this one), the market's
// total and spread (ESPN's DraftKings line), and Kalshi's prices, saved as
// an FtdGame so the first TD tracker's grading and money checks read it.
// Graded from ESPN's scoring plays once final; learning section nfl-firsttd-ours.
//
// Redis (new keys only):
//   models:v1:nfl:{season}:tdprior      last season's TD totals per player
//   ftd:v1:ours:{season}:w{week}        hash slug -> OurFtdStored
//   ftd:v1:ours:{season}:weeks          set of weeks

const P = PARAMS as FtdParams;
const SITE = "https://site.api.espn.com/apis/site/v2/sports/football/nfl";
const UA = { "user-agent": "Mozilla/5.0 (fantasy-hub first TD model)" };

export const FK = {
  tdprior: (s: number) => `models:v1:nfl:${s}:tdprior`,
  week: (s: number, w: number) => `ftd:v1:ours:${s}:w${w}`,
  weeks: (s: number) => `ftd:v1:ours:${s}:weeks`,
};

export interface OurFtdStored {
  game: FtdGame;
  capturedAt: string;
  firstSeenAt: string;
  kickoff?: string;
  espnId: string;
  kalshi?: KalshiGame;
  result?: Graded;
  gradedAt?: string;
}

async function json<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store", headers: UA, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}`);
  return (await res.json()) as T;
}

const nflSeasonOf = (d: Date) => (d.getUTCMonth() < 7 ? d.getUTCFullYear() - 1 : d.getUTCFullYear());

async function loadWeek(season: number, week: number): Promise<{ [slug: string]: OurFtdStored }> {
  return (await redis.hgetall<{ [slug: string]: OurFtdStored }>(FK.week(season, week))) ?? {};
}

/** DraftKings' total and expected home margin (positive: home favored) from ESPN's summary. */
async function marketLine(event: string): Promise<{ total: number; margin: number } | null> {
  const s = await json<{ pickcenter?: { provider?: { name?: string }; spread?: number; overUnder?: number; homeTeamOdds?: { favorite?: boolean } }[] }>(`${SITE}/summary?event=${event}`);
  const pc = s.pickcenter?.find((p) => p.provider?.name === "DraftKings") ?? s.pickcenter?.[0];
  if (typeof pc?.spread !== "number" || typeof pc.overUnder !== "number") return null;
  return { total: pc.overUnder, margin: pc.homeTeamOdds?.favorite === false ? -Math.abs(pc.spread) : Math.abs(pc.spread) };
}

export interface OurFtdReport {
  week: number | null;
  saved: string[];
  graded: string[];
  learning: string[];
  problems: string[];
}

export async function runOurFirstTd(now = new Date()): Promise<OurFtdReport> {
  const report: OurFtdReport = { week: null, saved: [], graded: [], learning: [], problems: [] };
  const season = nflSeasonOf(now);
  type Ev = { id: string; date?: string; status?: { type?: { state?: string } }; competitions?: { competitors?: { homeAway?: string; team?: { id?: string; abbreviation?: string } }[] }[] };
  let events: Ev[] = [];
  try {
    const sb = await json<{ week?: { number?: number }; events?: Ev[] }>(`${SITE}/scoreboard`);
    report.week = sb.week?.number ?? null;
    events = sb.events ?? [];
  } catch (e) {
    report.problems.push(`ESPN NFL scoreboard: ${e instanceof Error ? e.message : String(e)}`);
  }
  const pre = events.filter((e) => e.status?.type?.state === "pre" && e.date && new Date(e.date) > now);
  const prior = await redis.get<{ [id: string]: Omit<TdLine, "team"> }>(FK.tdprior(season));
  if (pre.length && !prior) report.problems.push(`no TD prior at ${FK.tdprior(season)}: run scripts/seed-nfl-models.mts`);
  if (pre.length && prior && report.week) {
    const week = report.week;
    let rows: Awaited<ReturnType<typeof nflverseRows>> = [];
    try {
      rows = (await nflverseRows(season)).filter((r) => r.week < week);
    } catch (e) {
      report.problems.push(`nflverse: ${e instanceof Error ? e.message : String(e)}`);
    }
    const cur = tdTotals(rows);
    let kalshi = new Map<string, KalshiGame>();
    try {
      kalshi = await kalshiFirstTd(now);
    } catch (e) {
      report.problems.push(`Kalshi: ${e instanceof Error ? e.message : String(e)}`);
    }
    for (const e of rows.length ? pre : []) {
      const cs = e.competitions?.[0]?.competitors ?? [];
      const home = cs.find((c) => c.homeAway === "home")?.team;
      const away = cs.find((c) => c.homeAway === "away")?.team;
      if (!home?.abbreviation || !away?.abbreviation || !home.id || !away.id) continue;
      const H = samTeam(home.abbreviation);
      const A = samTeam(away.abbreviation);
      const slug = `${season}_${String(week).padStart(2, "0")}_${A}_${H}`;
      try {
        const line = await marketLine(e.id);
        if (!line) continue; // no market yet
        const lists: { [team: string]: TdLine[] } = {};
        for (const [t, T] of [[away, A], [home, H]] as const) {
          const r = await json<{ athletes?: { items?: { fullName?: string; injuries?: { status?: string }[] }[] }[] }>(`${SITE}/teams/${t.id}/roster`);
          const out = new Set<string>();
          for (const g of r.athletes ?? []) for (const a of g.items ?? []) if (a.fullName && a.injuries?.some((i) => i.status === "Out" || i.status === "Injured Reserve")) out.add(nameKey(a.fullName));
          const weeks = [...new Set(rows.filter((x) => x.team === T).map((x) => x.week))].sort((a, b) => a - b).slice(-3);
          const ids = [...new Set(rows.filter((x) => x.team === T && weeks.includes(x.week)).map((x) => x.id))];
          lists[T] = ids.flatMap((id) => {
            const tot = addTotals(prior[id], cur.get(id));
            return tot && !out.has(nameKey(tot.name)) ? [{ ...tot, team: T }] : [];
          });
        }
        const pts = impliedPoints(line.total, line.margin);
        const when = new Date(e.date!).toLocaleString("en-US", { timeZone: "America/New_York", weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" });
        const game = ftdGame({ season, week, slug, away: A, home: H, when }, pts.home, pts.away, lists, P);
        const old = (await loadWeek(season, week))[slug];
        const k = kalshi.get(`${A}@${H}`) ?? old?.kalshi;
        await redis.hset(FK.week(season, week), {
          [slug]: { ...old, game, capturedAt: now.toISOString(), firstSeenAt: old?.firstSeenAt ?? now.toISOString(), kickoff: e.date, espnId: e.id, ...(k ? { kalshi: k } : {}) } satisfies OurFtdStored,
        });
        await redis.sadd(FK.weeks(season), String(week));
        report.saved.push(`${A}@${H} ${game.teams.reduce((a, t) => a + t.players.length, 0)} players${k ? ", Kalshi" : ""}`);
      } catch (err) {
        report.problems.push(`${A}@${H}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  const weeks = ((await redis.smembers(FK.weeks(season))) ?? []).map(Number).sort((a, b) => a - b);
  for (const wk of weeks) {
    for (const [slug, g] of Object.entries(await loadWeek(season, wk))) {
      if (g.result || !g.kickoff || new Date(g.kickoff) > now) continue;
      try {
        const sum = await json<{ header?: { competitions?: { status?: { type?: { completed?: boolean } } }[] }; scoringPlays?: EspnScoringPlay[] }>(`${SITE}/summary?event=${g.espnId}`);
        if (!sum.header?.competitions?.[0]?.status?.type?.completed) continue;
        await redis.hset(FK.week(season, wk), { [slug]: { ...g, result: grade(g.game, firstTouchdown(sum.scoringPlays ?? [])), gradedAt: now.toISOString() } });
        report.graded.push(slug);
      } catch (err) {
        report.problems.push(`grade ${slug}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  try {
    const cands = ourFtdCandidates(await ftdGraded(season));
    for (const j of await reviewIfDue(OUR_SECTION.nflFirstTd, season, report.week ?? weeks.at(-1) ?? 0, FTD_GATE, cands, now)) if (j.kind !== "registered") report.learning.push(j.text);
  } catch (err) {
    report.problems.push(`learning: ${err instanceof Error ? err.message : String(err)}`);
  }
  return report;
}

export async function ftdGraded(season: number): Promise<(GradedGame & { slug: string; week: number })[]> {
  const nums = ((await redis.smembers(FK.weeks(season))) ?? []).map(Number);
  const weeks = await Promise.all(nums.map(async (n) => [n, await loadWeek(season, n)] as const));
  return weeks
    .flatMap(([week, games]) => Object.entries(games).flatMap(([slug, g]) => (g.result ? [{ slug, week, game: g.game, result: g.result, kalshi: g.kalshi, kickoff: g.kickoff, capturedAt: g.capturedAt }] : [])))
    .sort((a, b) => b.week - a.week || a.slug.localeCompare(b.slug));
}

export interface OurFtdView {
  season: number;
  week: number | null;
  board: OurFtdStored[];
  graded: (GradedGame & { slug: string; week: number })[];
  learning: SectionView;
}

export async function getOurFtdView(season: number): Promise<OurFtdView> {
  const nums = ((await redis.smembers(FK.weeks(season))) ?? []).map(Number).sort((a, b) => b - a);
  const week = nums[0] ?? null;
  const board = week ? Object.values(await loadWeek(season, week)).sort((a, b) => (a.kickoff ?? "").localeCompare(b.kickoff ?? "")) : [];
  const graded = await ftdGraded(season);
  const [state, journal] = await Promise.all([loadSection(OUR_SECTION.nflFirstTd, season), loadJournal(OUR_SECTION.nflFirstTd, season)]);
  return { season, week, board, graded, learning: sectionView(FTD_GATE, state, ourFtdCandidates(graded), journal) };
}
