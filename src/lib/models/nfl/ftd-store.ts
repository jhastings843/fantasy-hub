import "server-only";
import { redis } from "@/lib/redis/client";
import { samTeam, firstTouchdown, grade, type EspnScoringPlay, type Graded } from "@/lib/firsttd/grade";
import { kalshiFirstTd, type KalshiGame } from "@/lib/firsttd/kalshi";
import type { FtdGame } from "@/lib/firsttd/parse";
import type { GradedGame } from "@/lib/firsttd/trends";
import { nameKey } from "@/lib/props/grade";
import { ATTD_GATE, FTD_GATE, sectionView, type SectionView } from "@/lib/learning/engine";
import { SECTIONS, attdCandidates } from "../sections";
import { loadJournal, loadSection, reviewIfDue } from "@/lib/learning/store";
import { loadVenomPicks } from "./venom";
import { OUR_SECTION, ourFtdCandidates } from "../learn";
import { addTotals, ftdGame, impliedPoints, tdTotals, type FtdParams, type TdLine } from "./firsttd";
import { nflverseRows } from "./store";
import { morningOddsReads } from "./odds-api-store";
import PARAMS from "./ftd-params.json";
import ATTD_PARAMS from "./attd-params.json";
import type { Books } from "./ftd-price";
import { attdTeam, boxTds, gradeAttd, type AttdGraded, type AttdParams, type AttdResult, type AttdRow } from "./anytime";
import { readTdScorers, type PropBetRow } from "../lines";
import type { EspnBoxTeam } from "@/lib/props/grade";
import { live, primeParams } from "@/lib/models/params-store";

// Our NFL First TD model, live. Each run, for every game this week not yet
// started: each team's players from its last 3 games (nflverse) less anyone
// ESPN lists Out, their TD history (last season plus this one), the market's
// total and spread (ESPN's DraftKings line), and Kalshi's prices, saved as
// an FtdGame so the first TD tracker's grading and money checks read it.
// Graded from ESPN's scoring plays once final; learning section nfl-firsttd-ours.
// Anytime TD (from 2026-10-26) rides on the same run: the same lists and
// implied points through anytime.ts, with DraftKings' Anytime and 2+ TD
// prices from ESPN's odds feed, graded from the box score. Paper only.
//
// Redis (new keys only):
//   models:v1:nfl:{season}:tdprior      last season's TD totals per player
//   ftd:v1:ours:{season}:w{week}        hash slug -> OurFtdStored
//   ftd:v1:ours:{season}:weeks          set of weeks

const P = live("nfl-ftd", PARAMS as FtdParams);
const AP = live("nfl-attd", ATTD_PARAMS as AttdParams);
const PROPS = (ev: string, page: number) => `https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/events/${ev}/competitions/${ev}/odds/100/propBets?limit=1000&page=${page}`;
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
  /** DraftKings' First TD prices (American) by nameKey, from The Odds API's morning-of read. Shown only; money checks still read Kalshi. */
  dk?: { at: string; prices: { [nameKey: string]: number } };
  /** FanDuel's First TD prices from the same read (from 2026-10-22). */
  fd?: { at: string; prices: { [nameKey: string]: number } };
  result?: Graded;
  gradedAt?: string;
  /** Our Anytime TD board with DraftKings' prices (from 2026-10-26). */
  attd?: { at: string; rows: AttdRow[] };
  attdResult?: AttdResult;
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
  await primeParams();
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
    const { reads } = await morningOddsReads(
      season,
      pre.flatMap((e) => {
        const cs = e.competitions?.[0]?.competitors ?? [];
        const h = cs.find((c) => c.homeAway === "home")?.team?.abbreviation;
        const a = cs.find((c) => c.homeAway === "away")?.team?.abbreviation;
        return h && a && e.date ? [{ espnId: e.id, home: samTeam(h), away: samTeam(a), kickoff: e.date }] : [];
      }),
      now,
    );
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
        const espnName = new Map<string, string>();
        for (const [t, T] of [[away, A], [home, H]] as const) {
          const r = await json<{ athletes?: { items?: { id?: string; fullName?: string; injuries?: { status?: string }[] }[] }[] }>(`${SITE}/teams/${t.id}/roster`);
          const out = new Set<string>();
          for (const g of r.athletes ?? [])
            for (const a of g.items ?? []) {
              if (a.id && a.fullName) espnName.set(a.id, nameKey(a.fullName));
              if (a.fullName && a.injuries?.some((i) => i.status === "Out" || i.status === "Injured Reserve")) out.add(nameKey(a.fullName));
            }
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
        let attd = old?.attd;
        try {
          const rows: PropBetRow[] = [];
          for (let page = 1; page <= 4; page++) {
            const d = await json<{ items?: PropBetRow[]; pageCount?: number }>(PROPS(e.id, page));
            rows.push(...(d.items ?? []));
            if (!d.pageCount || page >= d.pageCount) break;
          }
          // ESPN lists the market but has carried no prices so far; The Odds API's game-day morning read fills the anytime price.
          const dk = new Map([...readTdScorers(rows)].flatMap(([id, x]) => (espnName.has(id) ? [[espnName.get(id)!, x] as const] : [])));
          for (const [k, price] of Object.entries(reads.get(e.id)?.anytime ?? {})) if (dk.get(k)?.anytime === undefined) dk.set(k, { ...dk.get(k), anytime: price });
          const players = [A, H].flatMap((T) =>
            attdTeam(lists[T] ?? [], T === H ? pts.home : pts.away, AP).map((x): AttdRow => {
              const key = nameKey(x.name);
              const q = dk.get(key);
              return { ...x, key, ...(q?.anytime !== undefined ? { dk: q.anytime } : {}), ...(q?.two !== undefined ? { dk2: q.two } : {}) };
            }),
          );
          // Keep prices from an earlier read of the day once the morning read has aged out.
          const was = new Map((old?.attd?.rows ?? []).map((r) => [r.key, r]));
          for (const r of players) {
            if (r.dk === undefined && was.get(r.key)?.dk !== undefined) r.dk = was.get(r.key)!.dk;
            if (r.dk2 === undefined && was.get(r.key)?.dk2 !== undefined) r.dk2 = was.get(r.key)!.dk2;
          }
          if (players.length) attd = { at: now.toISOString(), rows: players.sort((a, b) => b.anytime - a.anytime) };
        } catch (err) {
          report.problems.push(`${A}@${H} anytime TD: ${err instanceof Error ? err.message : String(err)}`);
        }
        const k = kalshi.get(`${A}@${H}`) ?? old?.kalshi;
        const read = reads.get(e.id);
        const dk = read && Object.keys(read.firstTd).length ? { at: read.at, prices: read.firstTd } : old?.dk;
        const fd = read?.fd && Object.keys(read.fd.firstTd).length ? { at: read.at, prices: read.fd.firstTd } : old?.fd;
        await redis.hset(FK.week(season, week), {
          [slug]: { ...old, game, capturedAt: now.toISOString(), firstSeenAt: old?.firstSeenAt ?? now.toISOString(), kickoff: e.date, espnId: e.id, ...(k ? { kalshi: k } : {}), ...(dk ? { dk } : {}), ...(fd ? { fd } : {}), ...(attd ? { attd } : {}) } satisfies OurFtdStored,
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
      if ((g.result && (!g.attd || g.attdResult)) || !g.kickoff || new Date(g.kickoff) > now) continue;
      try {
        const sum = await json<{ header?: { competitions?: { status?: { type?: { completed?: boolean } } }[] }; scoringPlays?: EspnScoringPlay[]; boxscore?: { players?: EspnBoxTeam[] } }>(`${SITE}/summary?event=${g.espnId}`);
        if (!sum.header?.competitions?.[0]?.status?.type?.completed) continue;
        const attdResult = g.attd && sum.boxscore?.players?.length ? gradeAttd(g.attd.rows, boxTds(sum.boxscore.players)) : g.attdResult;
        await redis.hset(FK.week(season, wk), { [slug]: { ...g, result: g.result ?? grade(g.game, firstTouchdown(sum.scoringPlays ?? [])), ...(attdResult ? { attdResult } : {}), gradedAt: now.toISOString() } });
        report.graded.push(slug);
      } catch (err) {
        report.problems.push(`grade ${slug}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  try {
    const cands = ourFtdCandidates(await ftdGraded(season));
    for (const j of await reviewIfDue(OUR_SECTION.nflFirstTd, season, report.week ?? weeks.at(-1) ?? 0, FTD_GATE, cands, now)) if (j.kind !== "registered") report.learning.push(j.text);
    const attd = attdCandidates(await attdGraded(season), await loadVenomPicks(season));
    for (const j of await reviewIfDue(SECTIONS.nflAttd, season, report.week ?? weeks.at(-1) ?? 0, ATTD_GATE, attd, now)) if (j.kind !== "registered") report.learning.push(`Anytime TD: ${j.text}`);
  } catch (err) {
    report.problems.push(`learning: ${err instanceof Error ? err.message : String(err)}`);
  }
  return report;
}

export async function ftdGraded(season: number): Promise<(GradedGame & Books & { slug: string; week: number })[]> {
  const nums = ((await redis.smembers(FK.weeks(season))) ?? []).map(Number);
  const weeks = await Promise.all(nums.map(async (n) => [n, await loadWeek(season, n)] as const));
  return weeks
    .flatMap(([week, games]) => Object.entries(games).flatMap(([slug, g]) => (g.result ? [{ slug, week, game: g.game, result: g.result, kalshi: g.kalshi, dk: g.dk, fd: g.fd, kickoff: g.kickoff, capturedAt: g.capturedAt }] : [])))
    .sort((a, b) => b.week - a.week || a.slug.localeCompare(b.slug));
}

/** Every graded Anytime TD board, newest week first. */
export async function attdGraded(season: number): Promise<(AttdGraded & { at: string })[]> {
  const nums = ((await redis.smembers(FK.weeks(season))) ?? []).map(Number);
  const weeks = await Promise.all(nums.map(async (n) => [n, await loadWeek(season, n)] as const));
  return weeks
    .flatMap(([week, games]) => Object.entries(games).flatMap(([slug, g]) => (g.attd && g.attdResult ? [{ slug, week, at: g.kickoff ?? g.capturedAt, rows: g.attd.rows, result: g.attdResult }] : [])))
    .sort((a, b) => b.week - a.week || a.slug.localeCompare(b.slug));
}

export interface OurFtdView {
  season: number;
  week: number | null;
  board: OurFtdStored[];
  graded: (GradedGame & Books & { slug: string; week: number })[];
  learning: SectionView;
}

export async function getOurFtdView(season: number): Promise<OurFtdView> {
  await primeParams();
  const nums = ((await redis.smembers(FK.weeks(season))) ?? []).map(Number).sort((a, b) => b - a);
  const week = nums[0] ?? null;
  const board = week ? Object.values(await loadWeek(season, week)).sort((a, b) => (a.kickoff ?? "").localeCompare(b.kickoff ?? "")) : [];
  const graded = await ftdGraded(season);
  const [state, journal] = await Promise.all([loadSection(OUR_SECTION.nflFirstTd, season), loadJournal(OUR_SECTION.nflFirstTd, season)]);
  return { season, week, board, graded, learning: sectionView(FTD_GATE, state, ourFtdCandidates(graded), journal) };
}

/** Anytime TD's learner: its section, judged on ATTD_GATE. */
export async function getAttdLearning(season: number): Promise<SectionView> {
  await primeParams();
  const [state, journal, graded, venom] = await Promise.all([loadSection(SECTIONS.nflAttd, season), loadJournal(SECTIONS.nflAttd, season), attdGraded(season), loadVenomPicks(season)]);
  return sectionView(ATTD_GATE, state, attdCandidates(graded, venom), journal);
}
