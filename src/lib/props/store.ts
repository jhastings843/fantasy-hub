import "server-only";
import { redis } from "@/lib/redis/client";
import { samTeam } from "@/lib/firsttd/grade";
import { parsePropsLinks, parsePropsPage, parseSlug, type PropsGame } from "./parse";
import { gradeGame, type EspnBoxTeam, type GradedGame } from "./grade";
import { fetchProjections, projectionsFor } from "./rotowire";
import { espnFor, fetchDkLines, fetchEspnProjections } from "./espn";
import { MIN_BETS, propTrends, sliceBets, SLICES, Z_RETIRE, type GradedPropsGame, type PropTrends } from "./trends";

// The props tracker's memory, built like the first TD tracker: Sam keeps only
// the current week online, so each game's props page is saved before kickoff
// (the latest pregame copy wins, and the first copy's consensus lines are kept
// to measure how the market moved), with Rotowire's projection for the same
// markets alongside. ESPN's box score grades it once final.
//
// One Redis hash per week (field = game slug), a set of the weeks on file,
// and the system: the slices that earned a place, write-once per slice.

const SAM_BOARD = "https://samthemodelman.smmodel.workers.dev/nfl/";
const SAM_PAGE = (slug: string) => `https://samthemodelman.smmodel.workers.dev/nfl/props/${slug}.html`;
const ESPN = "https://site.api.espn.com/apis/site/v2/sports/football/nfl";
const UA = { "user-agent": "Mozilla/5.0 (fantasy-hub props tracker)" };

const weekKey = (season: number, week: number) => `props:v1:${season}:w${week}`;
const weeksKey = (season: number) => `props:v1:${season}:weeks`;
const systemKey = (season: number) => `props:v1:${season}:system`;

export interface StoredProps {
  game: PropsGame;
  capturedAt: string;
  firstSeenAt: string;
  /** Consensus line per market at the first copy. */
  first: { [id: string]: number };
  /** Rotowire's projection per market, from the latest copy's capture. */
  rw?: { [id: string]: number };
  /** ESPN's fantasy projection per market, from the latest copy's capture. */
  espn?: { [id: string]: number };
  /** DraftKings' opening and latest pregame line per market (ESPN odds feed). */
  dk?: { [id: string]: { open: number; current: number } };
  kickoff?: string;
  espnId?: string;
  result?: GradedGame;
  gradedAt?: string;
}

/** A slice's place in the system: when it qualified, and when (if) it was retired. */
export interface SystemEntry {
  id: string;
  label: string;
  since: number; // first week it counts for (the week after it qualified)
  at: string;
  z: number;
  n: number;
  retired?: { week: number; at: string; z: number };
}

async function get(url: string): Promise<string> {
  const res = await fetch(url, { cache: "no-store", headers: UA, signal: AbortSignal.timeout(12_000) });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return res.text();
}

interface EspnEvent {
  id: string;
  date?: string;
  status?: { type?: { state?: string; completed?: boolean } };
  competitions?: { competitors?: { homeAway?: string; team?: { id?: string; abbreviation?: string } }[] }[];
}
interface EspnGame {
  id: string;
  kickoff?: string;
  state: string;
  completed: boolean;
  teamIds: string[];
}
async function espnWeek(season: number, week: number) {
  const data = JSON.parse(await get(`${ESPN}/scoreboard?week=${week}&seasontype=2&dates=${season}`)) as { events?: EspnEvent[] };
  const out = new Map<string, EspnGame>();
  for (const e of data.events ?? []) {
    const cs = e.competitions?.[0]?.competitors ?? [];
    const h = samTeam(cs.find((c) => c.homeAway === "home")?.team?.abbreviation ?? "");
    const a = samTeam(cs.find((c) => c.homeAway === "away")?.team?.abbreviation ?? "");
    const teamIds = cs.map((c) => c.team?.id).filter((x): x is string => !!x);
    out.set(`${a}@${h}`, { id: e.id, kickoff: e.date, state: e.status?.type?.state ?? "", completed: !!e.status?.type?.completed, teamIds });
  }
  return out;
}

export async function loadWeek(season: number, week: number): Promise<{ [slug: string]: StoredProps }> {
  return (await redis.hgetall<{ [slug: string]: StoredProps }>(weekKey(season, week))) ?? {};
}
async function saveGame(season: number, week: number, slug: string, g: StoredProps) {
  await redis.hset(weekKey(season, week), { [slug]: g });
  await redis.sadd(weeksKey(season), String(week));
}
export async function loadSystem(season: number): Promise<SystemEntry[]> {
  const h = (await redis.hgetall<{ [id: string]: SystemEntry }>(systemKey(season))) ?? {};
  return Object.values(h).sort((a, b) => a.since - b.since || a.id.localeCompare(b.id));
}

export interface PropsRunReport {
  week: number | null;
  captured: string[];
  kept: string[];
  missed: string[];
  graded: string[];
  system: string[];
  problems: string[];
}

/** Save this week's pregame props pages, grade finals, update the system. Safe to call any time. */
export async function runProps(now = new Date()): Promise<PropsRunReport> {
  const report: PropsRunReport = { week: null, captured: [], kept: [], missed: [], graded: [], system: [], problems: [] };
  let slugs: string[] = [];
  try {
    slugs = parsePropsLinks(await get(SAM_BOARD));
  } catch (e) {
    report.problems.push(`Sam's board: ${e instanceof Error ? e.message : String(e)}`);
  }
  const first = slugs.map(parseSlug).find(Boolean);
  if (first) {
    report.week = first.week;
    const have = await loadWeek(first.season, first.week);
    let espn = new Map<string, EspnGame>();
    try {
      espn = await espnWeek(first.season, first.week);
    } catch (e) {
      report.problems.push(`ESPN week ${first.week}: ${e instanceof Error ? e.message : String(e)}`);
    }
    let rwIdx: Awaited<ReturnType<typeof fetchProjections>> | null = null;
    try {
      rwIdx = await fetchProjections(first.season, first.week);
    } catch (e) {
      report.problems.push(`Rotowire projections: ${e instanceof Error ? e.message : String(e)}`);
    }
    let espnIdx: Awaited<ReturnType<typeof fetchEspnProjections>> | null = null;
    try {
      espnIdx = await fetchEspnProjections(first.season, first.week);
    } catch (e) {
      report.problems.push(`ESPN projections: ${e instanceof Error ? e.message : String(e)}`);
    }
    for (const slug of slugs) {
      const id = parseSlug(slug);
      if (!id || id.week !== first.week) continue;
      const ev = espn.get(`${id.away}@${id.home}`);
      const old = have[slug];
      const pre = ev ? ev.state === "pre" : !old?.kickoff || new Date(old.kickoff) > now;
      if (!pre) {
        (old ? report.kept : report.missed).push(slug);
        continue;
      }
      try {
        const g = parsePropsPage(slug, await get(SAM_PAGE(slug)));
        if (!g) throw new Error("page did not read");
        const firstLines = { ...Object.fromEntries(g.markets.map((m) => [m.id, m.consensus])), ...old?.first };
        const rw = rwIdx ? projectionsFor(g.markets, rwIdx) : old?.rw;
        const espnProj = espnIdx ? espnFor(g.markets, espnIdx) : old?.espn;
        let dk = old?.dk;
        if (ev) {
          try {
            // Keep the first open seen; take the latest current line.
            const fresh = await fetchDkLines(ev.id, ev.teamIds, g.markets);
            dk = { ...fresh, ...Object.fromEntries(Object.entries(old?.dk ?? {}).map(([k, v]) => [k, { open: v.open, current: fresh[k]?.current ?? v.current }])) };
          } catch (e) {
            report.problems.push(`DraftKings lines ${slug}: ${e instanceof Error ? e.message : String(e)}`);
          }
        }
        await saveGame(first.season, first.week, slug, {
          ...old,
          game: g,
          capturedAt: now.toISOString(),
          firstSeenAt: old?.firstSeenAt ?? now.toISOString(),
          first: firstLines,
          ...(rw ? { rw } : {}),
          ...(espnProj ? { espn: espnProj } : {}),
          ...(dk ? { dk } : {}),
          ...(ev ? { kickoff: ev.kickoff, espnId: ev.id } : {}),
        });
        report.captured.push(slug);
      } catch (e) {
        report.problems.push(`${slug}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  // Grade every saved week with ungraded games.
  const season = first?.season ?? now.getUTCFullYear();
  const weeks = ((await redis.smembers(weeksKey(season))) ?? []).map(Number).sort((a, b) => a - b);
  for (const wk of weeks) {
    const games = await loadWeek(season, wk);
    const open = Object.entries(games).filter(([, g]) => !g.result);
    if (!open.length) continue;
    let espn: Awaited<ReturnType<typeof espnWeek>>;
    try {
      espn = await espnWeek(season, wk);
    } catch (e) {
      report.problems.push(`ESPN week ${wk}: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    for (const [slug, g] of open) {
      const ev = espn.get(`${g.game.away}@${g.game.home}`);
      if (!ev?.completed) continue;
      try {
        const sum = JSON.parse(await get(`${ESPN}/summary?event=${ev.id}`)) as { boxscore?: { players?: EspnBoxTeam[] } };
        if (!sum.boxscore?.players?.length) throw new Error("no box score yet");
        await saveGame(season, wk, slug, { ...g, result: gradeGame(g.game, sum.boxscore.players, { rw: g.rw, espn: g.espn }), gradedAt: now.toISOString(), espnId: ev.id });
        report.graded.push(slug);
      } catch (e) {
        report.problems.push(`grade ${slug}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  // The system. A slice joins when its record on weeks BEFORE the current one
  // clears the bar; its money counts from the current week on. It leaves when
  // its full record falls back under Z_RETIRE. Never rewritten otherwise.
  try {
    const current = report.week ?? weeks.at(-1) ?? 0;
    const graded = await gradedList(season);
    const before = propTrends(graded.filter((x) => x.week < current));
    const all = propTrends(graded);
    const sys = new Map((await loadSystem(season)).map((e) => [e.id, e]));
    for (const sl of before.slices) {
      if (sl.verdict !== "profitable" || sys.has(sl.id) || !current) continue;
      const e: SystemEntry = { id: sl.id, label: sl.label, since: current, at: now.toISOString(), z: sl.z ?? 0, n: sl.n };
      if (await redis.hsetnx(systemKey(season), sl.id, e)) report.system.push(`joined: ${sl.label}`);
    }
    for (const e of sys.values()) {
      if (e.retired) continue;
      const sl = all.slices.find((x) => x.id === e.id);
      if (sl && sl.z !== null && sl.z < Z_RETIRE) {
        await redis.hset(systemKey(season), { [e.id]: { ...e, retired: { week: current, at: now.toISOString(), z: sl.z } } });
        report.system.push(`retired: ${e.label}`);
      }
    }
  } catch (e) {
    report.problems.push(`system: ${e instanceof Error ? e.message : String(e)}`);
  }
  return report;
}

async function gradedList(season: number): Promise<GradedPropsGame[]> {
  const nums = ((await redis.smembers(weeksKey(season))) ?? []).map(Number);
  const weeks = await Promise.all(nums.map(async (n) => [n, await loadWeek(season, n)] as const));
  return weeks
    .flatMap(([week, games]) =>
      Object.entries(games).flatMap(([slug, g]) => (g.result ? [{ week, slug, game: g.game, result: g.result, first: g.first, rw: g.rw, espn: g.espn, dk: g.dk }] : [])),
    )
    .sort((a, b) => b.week - a.week || a.slug.localeCompare(b.slug));
}

export interface SystemRecord extends SystemEntry {
  w: number;
  l: number;
  p: number;
  units: number;
}

export interface PropsView {
  season: number;
  week: number | null;
  current: { [slug: string]: StoredProps };
  graded: GradedPropsGame[];
  trends: PropTrends;
  system: SystemRecord[];
  /** Ids of active system slices, for marking this week's qualifying plays. */
  active: string[];
}

/** Everything the page shows, read from Redis only. */
export async function getPropsView(season: number): Promise<PropsView> {
  const nums = ((await redis.smembers(weeksKey(season))) ?? []).map(Number).sort((a, b) => b - a);
  const week = nums[0] ?? null;
  const current = week ? await loadWeek(season, week) : {};
  const graded = await gradedList(season);
  const sys = await loadSystem(season);
  const system = sys.map((e) => {
    const bets = sliceBets(graded, e.id).filter((b) => b.week >= e.since && (!e.retired || b.week < e.retired.week));
    const w = bets.filter((b) => b.bet.outcome === "W").length;
    const l = bets.filter((b) => b.bet.outcome === "L").length;
    return { ...e, w, l, p: bets.length - w - l, units: Math.round(bets.reduce((a, b) => a + b.bet.net, 0) * 100) / 100 };
  });
  return { season, week, current, graded, trends: propTrends(graded), system, active: sys.filter((e) => !e.retired).map((e) => e.id) };
}

export { MIN_BETS, SLICES };
