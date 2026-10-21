import "server-only";
import { redis } from "@/lib/redis/client";
import { samTeam } from "@/lib/firsttd/grade";
import { gradeGame, nameKey, type EspnBoxTeam } from "@/lib/props/grade";
import { fetchDavidSlate, type DavidMarket, type DavidSlate } from "@/lib/props/david";
import { PROPS_GATE, sectionView, type SectionView } from "@/lib/learning/engine";
import { loadJournal, loadSection, reviewIfDue } from "@/lib/learning/store";
import type { GradedPropsGame } from "@/lib/props/trends";
import type { StoredProps } from "@/lib/props/store";
import { readPropBets, type PropBetRow } from "../lines";
import { OUR_SECTION, ourPropCandidates } from "../learn";
import { readStats, type NflRow } from "./data";
import { NflRunning, type NflSummary } from "./history";
import { ourNflMarkets, type NflMarketExtra } from "./market";
import { projectNflGame, type NflParams, type NflPlayerInput, type NflProjection, type NflStat } from "./props";
import PARAMS from "./params.json";

// Our NFL props model, live. Each run:
// 1. Reads this season's weekly player stats from nflverse (the release CSV,
//    about 0.4MB gzipped, so it is read whole each run rather than copied)
//    and last season's summary from Redis (seeded by scripts/seed-nfl-models.mts).
// 2. For every game this week not yet started: projects each team's recent
//    regulars and anyone DraftKings posts a line for, less anyone ESPN lists
//    Out (an Out regular's share is handed to the rest), against DK's lines
//    from ESPN's odds feed; prices from ESPN, else David's board, else -110.
// 3. Grades saved games from ESPN's box score once final.
// 4. Runs the learning review on our own section (nfl-props-ours).
//
// Redis (new keys only):
//   models:v1:nfl:{season}:prior        last season's summary (NflSummary)
//   props:v1:ours:nfl:{season}:w{week}  hash ESPN event id -> OurNflStored
//   props:v1:ours:nfl:{season}:weeks    set of weeks

const P = PARAMS as NflParams;
const SITE = "https://site.api.espn.com/apis/site/v2/sports/football/nfl";
const PROPS = (ev: string, page: number) => `https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/events/${ev}/competitions/${ev}/odds/100/propBets?limit=1000&page=${page}`;
const NFLVERSE = (season: number) => `https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_${season}.csv.gz`;
const UA = { "user-agent": "Mozilla/5.0 (fantasy-hub NFL model)" };

export const NK = {
  prior: (s: number) => `models:v1:nfl:${s}:prior`,
  week: (s: number, w: number) => `props:v1:ours:nfl:${s}:w${w}`,
  weeks: (s: number) => `props:v1:ours:nfl:${s}:weeks`,
};

export interface OurNflStored extends StoredProps {
  extra: { [id: string]: NflMarketExtra };
  away: string;
  home: string;
}

async function json<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store", headers: UA, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}`);
  return (await res.json()) as T;
}

/** This season's nflverse rows (the gzipped release file). */
export async function nflverseRows(season: number): Promise<NflRow[]> {
  const res = await fetch(NFLVERSE(season), { cache: "no-store", headers: UA, signal: AbortSignal.timeout(30_000) });
  if (!res.ok || !res.body) throw new Error(`nflverse stats_player ${season} answered ${res.status}`);
  return readStats(await new Response(res.body.pipeThrough(new DecompressionStream("gzip"))).text());
}

const nflSeasonOf = (d: Date) => (d.getUTCMonth() < 7 ? d.getUTCFullYear() - 1 : d.getUTCFullYear());
const DAVID_MARKET: { [s in NflStat]: DavidMarket } = { pass_yds: "passing_yards", rush_yds: "rushing_yards", rec_yds: "receiving_yards", rec: "receptions" };

export interface OurNflReport {
  week: number | null;
  nflverseWeek: number | null;
  saved: string[];
  graded: string[];
  learning: string[];
  problems: string[];
}

async function loadWeek(season: number, week: number): Promise<{ [id: string]: OurNflStored }> {
  return (await redis.hgetall<{ [id: string]: OurNflStored }>(NK.week(season, week))) ?? {};
}

interface SbEvent {
  id: string;
  date?: string;
  status?: { type?: { state?: string; completed?: boolean } };
  competitions?: { competitors?: { homeAway?: string; team?: { id?: string; abbreviation?: string } }[] }[];
}

export async function runOurNflProps(now = new Date()): Promise<OurNflReport> {
  const report: OurNflReport = { week: null, nflverseWeek: null, saved: [], graded: [], learning: [], problems: [] };
  const season = nflSeasonOf(now);
  let events: SbEvent[] = [];
  try {
    const sb = await json<{ week?: { number?: number }; events?: SbEvent[] }>(`${SITE}/scoreboard`);
    report.week = sb.week?.number ?? null;
    events = sb.events ?? [];
  } catch (e) {
    report.problems.push(`ESPN NFL scoreboard: ${e instanceof Error ? e.message : String(e)}`);
  }
  const pre = events.filter((e) => e.status?.type?.state === "pre" && e.date && new Date(e.date) > now);
  const prior = await redis.get<NflSummary>(NK.prior(season));
  if (pre.length && !prior) report.problems.push(`no prior season summary at ${NK.prior(season)}: run scripts/seed-nfl-models.mts`);

  if (pre.length && prior && report.week) {
    let run: NflRunning | null = null;
    try {
      const rows = (await nflverseRows(season)).filter((r) => r.week < report.week!);
      report.nflverseWeek = rows.reduce((a, r) => Math.max(a, r.week), 0);
      run = new NflRunning();
      for (const w of [...new Set(rows.map((r) => r.week))].sort((a, b) => a - b)) run.addWeek(rows.filter((r) => r.week === w));
    } catch (e) {
      report.problems.push(`nflverse: ${e instanceof Error ? e.message : String(e)}`);
    }
    let david: DavidSlate | null = null;
    try {
      david = await fetchDavidSlate();
    } catch (e) {
      report.problems.push(`David's board: ${e instanceof Error ? e.message : String(e)}`);
    }
    const davidPrice = (name: string, stat: NflStat, line: number) => {
      const d = david?.props.find((x) => x.market === DAVID_MARKET[stat] && x.line === line && nameKey(x.player) === nameKey(name));
      return d && d.over !== null && d.under !== null ? { over: d.over, under: d.under } : null;
    };
    for (const e of run ? pre : []) {
      const cs = e.competitions?.[0]?.competitors ?? [];
      const home = cs.find((c) => c.homeAway === "home")?.team;
      const away = cs.find((c) => c.homeAway === "away")?.team;
      if (!home?.abbreviation || !away?.abbreviation || !home.id || !away.id) continue;
      const H = samTeam(home.abbreviation);
      const A = samTeam(away.abbreviation);
      try {
        const rows: PropBetRow[] = [];
        for (let page = 1; page <= 4; page++) {
          const d = await json<{ items?: PropBetRow[]; pageCount?: number }>(PROPS(e.id, page));
          rows.push(...(d.items ?? []));
          if (!d.pageCount || page >= d.pageCount) break;
        }
        const lines = readPropBets(rows, "nfl");
        if (![...lines.values()].some((l) => l.type.startsWith("Total Receiving Yards"))) continue; // DK hasn't posted yet
        // ESPN rosters give names and Out; nflverse rows are matched by name within the team.
        const names = new Map<string, { name: string; team: string }>();
        const outKeys = new Set<string>();
        for (const [t, T] of [[away, A], [home, H]] as const) {
          const r = await json<{ athletes?: { items?: { id?: string; fullName?: string; injuries?: { status?: string }[] }[] }[] }>(`${SITE}/teams/${t.id}/roster`);
          for (const g of r.athletes ?? [])
            for (const a of g.items ?? []) {
              if (!a.id || !a.fullName) continue;
              names.set(a.id, { name: a.fullName, team: T });
              if (a.injuries?.some((i) => i.status === "Out" || i.status === "Injured Reserve")) outKeys.add(`${T}|${nameKey(a.fullName)}`);
            }
        }
        const byKey = new Map<string, { id: string; pos: string }>(); // "TEAM|namekey" -> nflverse id
        for (const [id, p] of run!.players) {
          const team = p.games.at(-1)?.team;
          if (team === H || team === A) byKey.set(`${team}|${nameKey(p.name)}`, { id, pos: p.pos });
        }
        const espnOf = new Map<string, string>(); // nflverse id -> ESPN id
        for (const [eid, v] of names) {
          const m = byKey.get(`${v.team}|${nameKey(v.name)}`);
          if (m) espnOf.set(m.id, eid);
        }
        const players: NflPlayerInput[] = [];
        const absent: NflPlayerInput[] = [];
        const dkIds = new Set([...lines.values()].map((l) => l.athlete));
        for (const T of [A, H]) {
          const last = (run!.teams.get(T) ?? []).slice(-3);
          const pool = new Set(last.flatMap((g) => g.ids));
          for (const [nid, eid] of espnOf) if (dkIds.has(eid) && names.get(eid)!.team === T) pool.add(nid);
          for (const id of pool) {
            const p = run!.players.get(id);
            const eid = espnOf.get(id);
            if (!p || !eid || names.get(eid)?.team !== T) continue;
            const input = run!.player(id, T, p.pos, prior);
            const isOut = outKeys.has(`${T}|${nameKey(p.name)}`);
            if (!isOut) players.push(input);
            else if (last.length === 3 && last.every((g) => g.ids.includes(id))) absent.push(input);
          }
        }
        const teams = Object.fromEntries([A, H].map((t) => [t, run!.team(t, prior)]));
        const margin = await homeMargin(e.id);
        const proj = new Map<string, NflProjection>();
        for (const x of projectNflGame(players, teams, H, margin, prior.base, P, absent)) {
          const eid = espnOf.get(x.id);
          if (eid) proj.set(eid, x);
        }
        const { markets, extra } = ourNflMarkets(lines, proj, names, davidPrice, P);
        if (!markets.length) continue;
        const week = report.week!;
        const old = (await loadWeek(season, week))[e.id];
        const stored: OurNflStored = {
          ...old,
          game: { season, week, slug: e.id, away: A, home: H, breakEven: null, favorites: [], markets },
          capturedAt: now.toISOString(),
          firstSeenAt: old?.firstSeenAt ?? now.toISOString(),
          first: { ...Object.fromEntries(markets.map((m) => [m.id, m.line])), ...old?.first },
          kickoff: e.date,
          espnId: e.id,
          extra,
          away: A,
          home: H,
        };
        await redis.hset(NK.week(season, week), { [e.id]: stored });
        await redis.sadd(NK.weeks(season), String(week));
        report.saved.push(`${A}@${H} ${markets.length} props, ${markets.filter((m) => m.clears).length} edges, prices ${Object.values(extra).filter((x) => x.price !== "assumed").length} real`);
      } catch (err) {
        report.problems.push(`${A}@${H}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  // Grade saved games once final.
  const weeks = ((await redis.smembers(NK.weeks(season))) ?? []).map(Number).sort((a, b) => a - b);
  for (const wk of weeks) {
    for (const [id, g] of Object.entries(await loadWeek(season, wk))) {
      if (g.result || !g.kickoff || new Date(g.kickoff) > now) continue;
      try {
        const sum = await json<{ header?: { competitions?: { status?: { type?: { completed?: boolean } } }[] }; boxscore?: { players?: EspnBoxTeam[] } }>(`${SITE}/summary?event=${id}`);
        if (!sum.header?.competitions?.[0]?.status?.type?.completed) continue;
        if (!sum.boxscore?.players?.length) throw new Error("no box score yet");
        await redis.hset(NK.week(season, wk), { [id]: { ...g, result: gradeGame(g.game, sum.boxscore.players, {}, "nfl"), gradedAt: now.toISOString() } });
        report.graded.push(id);
      } catch (err) {
        report.problems.push(`grade ${id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  try {
    const cands = ourPropCandidates(await nflGradedList(season), ["pass_yds", "rush_yds", "rec_yds", "rec"]);
    for (const j of await reviewIfDue(OUR_SECTION.nflProps, season, report.week ?? weeks.at(-1) ?? 0, PROPS_GATE, cands, now)) if (j.kind !== "registered") report.learning.push(j.text);
  } catch (err) {
    report.problems.push(`learning: ${err instanceof Error ? err.message : String(err)}`);
  }
  return report;
}

/** Expected home margin from DraftKings' spread in ESPN's summary (positive: home favored). */
export async function homeMargin(event: string): Promise<number | null> {
  try {
    const s = await json<{ pickcenter?: { provider?: { name?: string }; spread?: number; homeTeamOdds?: { favorite?: boolean } }[] }>(`${SITE}/summary?event=${event}`);
    const pc = s.pickcenter?.find((p) => p.provider?.name === "DraftKings") ?? s.pickcenter?.[0];
    if (typeof pc?.spread !== "number") return null;
    return pc.homeTeamOdds?.favorite === false ? -Math.abs(pc.spread) : Math.abs(pc.spread);
  } catch {
    return null;
  }
}

export async function nflGradedList(season: number): Promise<GradedPropsGame[]> {
  const nums = ((await redis.smembers(NK.weeks(season))) ?? []).map(Number);
  const weeks = await Promise.all(nums.map(async (n) => [n, await loadWeek(season, n)] as const));
  return weeks
    .flatMap(([week, games]) => Object.entries(games).flatMap(([slug, g]) => (g.result ? [{ week, slug, game: g.game, result: g.result, first: g.first, kickoff: g.kickoff, capturedAt: g.capturedAt }] : [])))
    .sort((a, b) => b.week - a.week || (b.kickoff ?? "").localeCompare(a.kickoff ?? ""));
}

export interface OurNflView {
  season: number;
  week: number | null;
  board: OurNflStored[];
  graded: GradedPropsGame[];
  learning: SectionView;
}

export async function getOurNflView(season: number): Promise<OurNflView> {
  const nums = ((await redis.smembers(NK.weeks(season))) ?? []).map(Number).sort((a, b) => b - a);
  const week = nums[0] ?? null;
  const board = week ? Object.values(await loadWeek(season, week)).sort((a, b) => (a.kickoff ?? "").localeCompare(b.kickoff ?? "")) : [];
  const graded = await nflGradedList(season);
  const [state, journal] = await Promise.all([loadSection(OUR_SECTION.nflProps, season), loadJournal(OUR_SECTION.nflProps, season)]);
  return { season, week, board, graded, learning: sectionView(PROPS_GATE, state, ourPropCandidates(graded, ["pass_yds", "rush_yds", "rec_yds", "rec"]), journal) };
}
