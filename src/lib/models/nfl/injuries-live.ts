import "server-only";
import { gunzipSync } from "node:zlib";
import { samTeam } from "@/lib/firsttd/grade";
import { isOut } from "@/lib/injuries/status";
import { nameKey } from "@/lib/props/grade";
import { parseCsv, readStats, type NflRow } from "./data";
import { bookFromRows, normTeam, outIds, rosterReport, teamOut, type ReportEntry, type TeamOut } from "./injuries";
import type { SpreadGame } from "./spread";

// "Who's out" for this week's NFL games, live (injuries.ts has the rules and
// the backtest). Same inputs as the backtest, read fresh:
//   usage       nflverse weekly stats, this season and last (an 8-game window
//               reaches back across the season break)
//   last QB     nflverse games.csv: the team's previous game's starter
//   last report nflverse injuries_{season}.csv at the team's previous game's week
//   now         ESPN team rosters, athletes[].items[].injuries[].status (as the
//               props pool reads them), matched to nflverse ids by name in the team.
//               Injured Reserve counts only for a player used in the team's last
//               game (nflverse's reports omit players already on IR, so the
//               backtest never saw them; long-term IR is old news)
// Cached three hours, like the games file. Any failure returns null and the
// game shows no injury flag. The flag is display only (Jack, 2026-11-02).

const REL = "https://github.com/nflverse/nflverse-data/releases/download";
const SITE = "https://site.api.espn.com/apis/site/v2/sports/football/nfl";
const TTL = 3 * 3_600_000;

let cache: { at: number; season: number; stats: NflRow[]; reports: Map<string, ReportEntry[]>; espnIds: Map<string, string> } | null = null;

async function get(url: string): Promise<Response> {
  const r = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(30_000) });
  if (!r.ok) throw new Error(`${url} answered ${r.status}`);
  return r;
}

async function inputs(season: number) {
  if (cache && cache.season === season && Date.now() - cache.at < TTL) return cache;
  const stats = async (s: number) => {
    try {
      return readStats(gunzipSync(Buffer.from(await (await get(`${REL}/stats_player/stats_player_week_${s}.csv.gz`)).arrayBuffer())).toString("utf8"));
    } catch {
      return [] as NflRow[]; // week 1: this season's file may not exist yet
    }
  };
  const [prev, cur] = await Promise.all([stats(season - 1), stats(season)]);
  const reports = new Map<string, ReportEntry[]>();
  try {
    const [head, ...rows] = parseCsv(await (await get(`${REL}/injuries/injuries_${season}.csv`)).text());
    const col = (n: string) => head.indexOf(n);
    for (const r of rows) {
      const k = `${r[col("week")]}|${normTeam(r[col("team")])}`;
      const list = reports.get(k) ?? [];
      list.push({ id: r[col("gsis_id")], pos: r[col("position")], status: r[col("report_status")] });
      reports.set(k, list);
    }
  } catch {
    // Not published yet this season: nobody counts as out last week, so everyone out now is new.
  }
  const teams = (await (await get(`${SITE}/teams`)).json()) as { sports?: { leagues?: { teams?: { team?: { id?: string; abbreviation?: string } }[] }[] }[] };
  const espnIds = new Map<string, string>();
  for (const t of teams.sports?.[0]?.leagues?.[0]?.teams ?? []) if (t.team?.id && t.team.abbreviation) espnIds.set(samTeam(t.team.abbreviation), t.team.id);
  cache = { at: Date.now(), season, stats: [...prev, ...cur], reports, espnIds };
  return cache;
}

/** Each named team's qbOut and skillOut right now, keyed by nflverse code; null when the inputs can't be read. */
export async function nflTeamsOut(season: number, games: SpreadGame[], teams: string[]): Promise<Map<string, TeamOut> | null> {
  try {
    const inp = await inputs(season);
    const book = bookFromRows(inp.stats);
    const done = [...games].filter((g) => g.homeScore !== null).sort((a, b) => a.gameday.localeCompare(b.gameday));
    const out = new Map<string, TeamOut>();
    await Promise.all(
      [...new Set(teams)].map(async (team) => {
        const T = normTeam(team);
        const espn = inp.espnIds.get(team) ?? inp.espnIds.get(T);
        if (!espn) return;
        const last = done.filter((g) => normTeam(g.home) === T || normTeam(g.away) === T).at(-1);
        const lastQb = last ? (normTeam(last.home) === T ? last.homeQb : last.awayQb) : undefined;
        const prevOut = last && last.season === season ? outIds(inp.reports.get(`${last.week}|${T}`) ?? []) : new Set<string>();
        const players = new Map<string, { id: string; pos: string }>();
        for (const r of inp.stats) if (normTeam(r.team) === T) players.set(nameKey(r.name), { id: r.id, pos: r.pos });
        const roster = (await (await get(`${SITE}/teams/${espn}/roster`)).json()) as { athletes?: { items?: { fullName?: string; injuries?: { status?: string }[] }[] }[] };
        const now = roster.athletes?.flatMap((g) => g.items ?? []).flatMap((a) => (a.fullName ? [{ key: nameKey(a.fullName), status: (a.injuries?.find((i) => isOut(i.status)) ?? a.injuries?.[0])?.status }] : [])) ?? [];
        // nflverse's weekly reports leave out players already on IR, so the backtest never counted them.
        // Live, IR counts only for last game's starting QB or a player with a target or carry in it: that IR is news.
        const lastIds = new Set(last ? inp.stats.filter((r) => r.season === last.season && r.week === last.week && normTeam(r.team) === T && r.tgt + r.car > 0).map((r) => r.id) : []);
        const report = rosterReport(now, players).filter((r) => r.status !== "Injured Reserve" || lastIds.has(r.id) || r.id === lastQb);
        const nameById = new Map(inp.stats.filter((r) => normTeam(r.team) === T).map((r) => [r.id, r.name]));
        out.set(team, teamOut(report, { lastQb, prevOut, share: (id) => book.share(T, id), nameOf: (id) => nameById.get(id) }));
      }),
    );
    return out;
  } catch {
    return null;
  }
}
