import "server-only";
import { redis } from "@/lib/redis/client";
import { blend, CbbRatings, coverChance, overChance, trankLeague, trankProject, type CbbFinal, type CbbParams, type Projection, type TrankTeam } from "./model";
import { readCbbLine, type CbbLine, type CbbOdds } from "./lines";
import { matchTorvik, readTorvikTeams } from "./torvik";
import { signalRecords, signalsOf, type CbbSnap, type SignalRecord, type TrackedCbbGame } from "./track";
import PARAMS from "./params.json";
import SEED from "./seed.json";

// Our college basketball model, live (tracked; nothing staked). The pulse
// calls `runCbb` every fifteen minutes; it does real work at most every 30:
// fold in new finals, read DraftKings (via ESPN) for games tipping in the
// next 36 hours, save our number (the first save is the price a game is
// judged at, later saves replace `last`), and grade finished games against
// the close and the final. Pages read `getCbbBoard` and `getCbbRecord`.
//
// Ratings: ours after 2025-26 (seed.json, from scripts/fit-cbb.mts) carried
// into this season, plus every final this season (ESPN, Division I). T-Rank:
// Torvik's current ratings (his preseason ones until games are played),
// cached six hours, last good copy kept.
//
// Redis:
//   models:v1:cbb:{season}:day:{yyyymmdd}   finished day's finals (kept)
//   models:v1:cbb:{season}:track            hash event -> TrackedCbbGame
//   models:v1:cbb:{season}:torvik           last good T-Rank file, with when
//   models:v1:cbb:teams                     ESPN team list, a week
//   models:v1:cbb:run                       30-minute claim

const P = PARAMS as CbbParams;
const SITE = "https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball";
const ODDS = (id: string) => `https://sports.core.api.espn.com/v2/sports/basketball/leagues/mens-college-basketball/events/${id}/competitions/${id}/odds`;
const DAY_KEY = (s: number, d: string) => `models:v1:cbb:${s}:day:${d}`;
const TRACK = (s: number) => `models:v1:cbb:${s}:track`;
const TORVIK = (s: number) => `models:v1:cbb:${s}:torvik`;
const TEAMS = "models:v1:cbb:teams";
const ET = "America/New_York";
const r2 = (x: number) => Math.round(x * 100) / 100;

/** Season start year: November through April belongs to the season that started in the fall. */
export const cbbSeason = (now = new Date()) => (now.getUTCMonth() >= 6 ? now.getUTCFullYear() : now.getUTCFullYear() - 1);
/** Eastern calendar date, yyyymmdd. */
export const etYmd = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: ET }).format(d).replace(/-/g, "");
const addDays = (ymd: string, n: number) => {
  const t = Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(4, 6)) - 1, Number(ymd.slice(6, 8)) + n, 12);
  return new Date(t).toISOString().slice(0, 10).replace(/-/g, "");
};

async function getJson<T>(url: string, ms = 12_000): Promise<T> {
  const r = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error(`${new URL(url).host} answered ${r.status}`);
  return (await r.json()) as T;
}

/* ---------------------------------------------------------------- board -- */

export interface CbbTeamRef {
  id: string;
  name: string;
  short: string;
  abbr: string;
  logo?: string;
  rank?: number;
  record?: string;
}

export interface CbbBoardGame {
  id: string;
  tip: string;
  day: string;
  state: "pre" | "in" | "post";
  detail: string;
  home: CbbTeamRef;
  away: CbbTeamRef;
  score?: { home: number; away: number };
  neutral: boolean;
  conf: boolean;
  post: boolean;
  tv?: string;
  venue?: string;
  note?: string;
}

interface EspnBoard {
  events?: {
    id: string;
    date: string;
    season?: { type?: number };
    status?: { type?: { state?: string; completed?: boolean; shortDetail?: string } };
    competitions?: {
      neutralSite?: boolean;
      conferenceCompetition?: boolean;
      venue?: { fullName?: string };
      notes?: { headline?: string }[];
      broadcasts?: { names?: string[] }[];
      competitors?: {
        homeAway: string;
        score?: string;
        curatedRank?: { current?: number };
        records?: { summary?: string }[];
        team: { id: string; location?: string; shortDisplayName?: string; abbreviation?: string; logo?: string };
      }[];
    }[];
  }[];
}

function readBoard(d: EspnBoard, day: string): CbbBoardGame[] {
  const out: CbbBoardGame[] = [];
  for (const e of d.events ?? []) {
    const c = e.competitions?.[0];
    const h = c?.competitors?.find((x) => x.homeAway === "home");
    const a = c?.competitors?.find((x) => x.homeAway === "away");
    if (!c || !h || !a) continue;
    const ref = (x: typeof h): CbbTeamRef => ({
      id: x.team.id,
      name: x.team.location ?? x.team.shortDisplayName ?? x.team.id,
      short: x.team.shortDisplayName ?? x.team.location ?? x.team.id,
      abbr: x.team.abbreviation ?? "",
      logo: x.team.logo,
      rank: x.curatedRank?.current && x.curatedRank.current <= 25 ? x.curatedRank.current : undefined,
      record: x.records?.[0]?.summary,
    });
    const st = e.status?.type?.state === "in" ? "in" : e.status?.type?.completed || e.status?.type?.state === "post" ? "post" : "pre";
    const hs = Number(h.score);
    const as = Number(a.score);
    out.push({
      id: e.id,
      tip: e.date,
      day,
      state: st,
      detail: e.status?.type?.shortDetail ?? "",
      home: ref(h),
      away: ref(a),
      score: st !== "pre" && Number.isFinite(hs) && Number.isFinite(as) ? { home: hs, away: as } : undefined,
      neutral: !!c.neutralSite,
      conf: !!c.conferenceCompetition,
      post: (e.season?.type ?? 2) === 3,
      tv: c.broadcasts?.flatMap((b) => b.names ?? []).join(", ") || undefined,
      venue: c.venue?.fullName,
      note: c.notes?.[0]?.headline,
    });
  }
  return out.sort((x, y) => x.tip.localeCompare(y.tip));
}

async function boardFor(day: string): Promise<CbbBoardGame[]> {
  return readBoard(await getJson<EspnBoard>(`${SITE}/scoreboard?dates=${day}&groups=50&limit=500`), day);
}

const toFinal = (g: CbbBoardGame, season: number): CbbFinal | null =>
  g.state === "post" && g.score && g.score.home + g.score.away > 0
    ? { id: g.id, season, tip: g.tip, home: g.home.id, away: g.away.id, homeScore: g.score.home, awayScore: g.score.away, neutral: g.neutral, conf: g.conf, post: g.post }
    : null;

/** First day of the season to read finals from: Nov 1. */
const seasonStart = (season: number) => `${season}1101`;

/**
 * This season's finals: finished days from Redis, the rest from ESPN (each
 * day kept once all its games are final). `complete` is false while any day
 * before today is still unread, so a cold start never saves a graded price
 * from ratings missing weeks of results; it fills `budget` days a call.
 */
async function seasonFinals(season: number, today: string, budget: number): Promise<{ finals: CbbFinal[]; complete: boolean }> {
  const days: string[] = [];
  for (let d = seasonStart(season); d < today && days.length < 200; d = addDays(d, 1)) days.push(d);
  if (!days.length) return { finals: [], complete: true };
  const kept = (await redis.mget<(CbbFinal[] | null)[]>(...days.map((d) => DAY_KEY(season, d)))) ?? [];
  const out: CbbFinal[] = [];
  const missing: string[] = [];
  days.forEach((d, i) => (kept[i] ? out.push(...kept[i]!) : missing.push(d)));
  let read = 0;
  for (let i = 0; i < Math.min(missing.length, budget); i += 8) {
    const got = await Promise.all(missing.slice(i, Math.min(i + 8, budget)).map((d) => boardFor(d).then((b) => ({ d, b })).catch(() => null)));
    for (const x of got) {
      if (!x) continue;
      read++;
      const finals = x.b.map((g) => toFinal(g, season)).filter((f): f is CbbFinal => !!f);
      out.push(...finals);
      if (x.b.every((g) => g.state === "post")) await redis.set(DAY_KEY(season, x.d), finals);
    }
  }
  // Yesterday may still have a game in progress at 1am; only days before yesterday must be read.
  const stale = missing.slice(read).filter((d) => d < addDays(today, -1));
  return { finals: out, complete: stale.length === 0 };
}

/**
 * Ratings now: the seed carried into this season, then this season's finals
 * before today. The seed is the end of the season it was fit on; a season
 * later than the one after it needs scripts/fit-cbb.mts re-run (the gap's
 * results are not replayed), so `stale` says so.
 */
async function ratingsNow(season: number, today: string, budget = 40): Promise<{ r: CbbRatings; finals: number; complete: boolean; stale: boolean }> {
  const r = new CbbRatings(P.rating);
  r.season = SEED.season;
  r.avg = SEED.avg;
  for (const [t, v] of Object.entries(SEED.off)) r.off.set(t, v);
  for (const [t, v] of Object.entries(SEED.def)) r.def.set(t, v);
  r.newSeason(season);
  const { finals, complete } = await seasonFinals(season, today, budget);
  const seen = new Set<string>();
  const uniq = finals.filter((f) => (seen.has(f.id) ? false : (seen.add(f.id), true)));
  for (const f of uniq.sort((a, b) => a.tip.localeCompare(b.tip))) r.add(f);
  return { r, finals: uniq.length, complete, stale: season > SEED.season + 1 };
}

/* --------------------------------------------------------------- T-Rank -- */

interface TorvikKept {
  at: string;
  teams: TrankTeam[];
}

/** Torvik's current file: cached six hours, the last good copy kept for when his site is down. */
async function torvikTeams(season: number, now: Date): Promise<TorvikKept | null> {
  const kept = await redis.get<TorvikKept>(TORVIK(season)).catch(() => null);
  const age = kept ? now.getTime() - Date.parse(kept.at) : Infinity;
  if (kept && age >= 0 && age < 6 * 3_600_000) return kept;
  try {
    const rows = await getJson<unknown[][]>(`https://barttorvik.com/${season + 1}_team_results.json`, 15_000);
    const teams = readTorvikTeams(rows);
    if (teams.length < 300) throw new Error(`only ${teams.length} teams`);
    const fresh = { at: now.toISOString(), teams };
    await redis.set(TORVIK(season), fresh);
    return fresh;
  } catch {
    return kept ?? null;
  }
}

interface EspnTeams {
  sports?: { leagues?: { teams?: { team: { id: string; location?: string; shortDisplayName?: string; abbreviation?: string; logos?: { href?: string }[] } }[] }[] }[];
}
export interface EspnTeam {
  id: string;
  location: string;
  short: string;
  abbr: string;
  logo?: string;
}

/** ESPN's Division I team list (ids, names, logos), a week at a time. */
export async function espnTeams(): Promise<EspnTeam[]> {
  const kept = await redis.get<{ at: string; teams: EspnTeam[] }>(TEAMS).catch(() => null);
  if (kept && Date.now() - Date.parse(kept.at) < 7 * 86_400_000) return kept.teams;
  try {
    const d = await getJson<EspnTeams>(`${SITE}/teams?limit=500&groups=50`);
    const teams = (d.sports?.[0]?.leagues?.[0]?.teams ?? []).map(({ team: t }) => ({ id: t.id, location: t.location ?? t.id, short: t.shortDisplayName ?? t.location ?? t.id, abbr: t.abbreviation ?? "", logo: t.logos?.[0]?.href }));
    if (teams.length > 300) await redis.set(TEAMS, { at: new Date().toISOString(), teams });
    return teams.length ? teams : (kept?.teams ?? []);
  } catch {
    return kept?.teams ?? [];
  }
}

/** T-Rank teams keyed by ESPN id. */
async function trankById(season: number, now: Date, names: { [id: string]: string }) {
  const t = await torvikTeams(season, now);
  if (!t) return { by: new Map<string, TrankTeam>(), lg: null, at: null, unmatched: [] as string[] };
  const { map, unmatched } = matchTorvik(t.teams.map((x) => x.name), names);
  const by = new Map<string, TrankTeam>();
  for (const x of t.teams) {
    const id = map.get(x.name);
    if (id) by.set(id, x);
  }
  return { by, lg: trankLeague(t.teams), at: t.at, unmatched };
}

/* ------------------------------------------------------------ projection -- */

export interface CbbRead {
  proj: Projection;
  parts: CbbSnap["parts"];
  line: CbbLine | null;
  /** Points between our number and the market's, on our side (spread) and over/under (total). */
  spreadEdge: number | null;
  totalEdge: number | null;
  /** Our chance the home side covers the market spread, and the over hits. */
  homeCover: number | null;
  over: number | null;
  /** T-Rank's rank for each side. */
  rank: { home?: number; away?: number };
}

/**
 * A team we have never rated starts at the average rating of the non-Division
 * I teams we have (they are the ones that turn up new); a new Division I team
 * starts at zero, an average D1 side.
 */
function fillUnknown(r: CbbRatings, games: CbbBoardGame[], d1: Set<string>) {
  let o = 0;
  let d = 0;
  let n = 0;
  for (const [t, v] of r.off) {
    if (d1.has(t)) continue;
    o += v;
    d += r.def.get(t) ?? 0;
    n++;
  }
  if (!n) return;
  for (const g of games)
    for (const t of [g.home.id, g.away.id])
      if (!r.off.has(t) && !d1.has(t)) {
        r.off.set(t, o / n);
        r.def.set(t, d / n);
      }
}

function readGame(g: CbbBoardGame, r: CbbRatings, tr: Awaited<ReturnType<typeof trankById>>, line: CbbLine | null): CbbRead {
  const ours = r.project(g.home.id, g.away.id, g.neutral);
  const th = tr.by.get(g.home.id);
  const ta = tr.by.get(g.away.id);
  const trank = th && ta && tr.lg ? trankProject(th, ta, tr.lg, g.neutral, P.trank.hfa) : null;
  const proj = blend(ours, trank ? { margin: trank.margin, total: trank.total } : null, P);
  return {
    proj,
    parts: { ours: { margin: r2(ours.margin), total: r2(ours.total) }, trank: trank ? { margin: r2(trank.margin), total: r2(trank.total) } : null },
    line,
    spreadEdge: line?.spread != null ? r2(line.spread - proj.spread) : null,
    totalEdge: line?.total != null ? r2(proj.total - line.total) : null,
    homeCover: line?.spread != null ? coverChance(proj.margin, line.spread, P.sigma) : null,
    over: line?.total != null ? overChance(proj.total, line.total, P.sigmaTotal) : null,
    rank: { home: th?.rank, away: ta?.rank },
  };
}

async function lineFor(id: string, at: "now" | "close" = "now", ms = 6_000): Promise<CbbLine | null> {
  return readCbbLine(await getJson<CbbOdds>(ODDS(id), ms), at);
}

/** Map with at most n in flight. */
async function pool<T, R>(xs: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(xs.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, xs.length) }, async () => {
    while (i < xs.length) {
      const k = i++;
      out[k] = await fn(xs[k]);
    }
  }));
  return out;
}

const snapOf = (x: CbbRead, at: string): CbbSnap | null =>
  x.line && (x.line.spread !== null || x.line.total !== null)
    ? {
        at,
        spread: x.line.spread,
        homePrice: x.line.homePrice,
        awayPrice: x.line.awayPrice,
        total: x.line.total,
        overPrice: x.line.overPrice,
        underPrice: x.line.underPrice,
        mlHome: x.line.mlHome,
        mlAway: x.line.mlAway,
        open: x.line.open,
        ours: { spread: x.proj.spread, total: x.proj.total, homeWin: x.proj.homeWin },
        parts: x.parts,
      }
    : null;

/* ------------------------------------------------------------------- run -- */

const CLAIM = "models:v1:cbb:run";
/** The pulse gives a job 25 seconds and does not cancel it, so the job keeps its own clock and stops early. */
const BUDGET_MS = 18_000;
/** Eastern month (0-11), for the off-season gate. */
const etMonth = (d: Date) => Number(new Intl.DateTimeFormat("en-US", { timeZone: ET, month: "numeric" }).format(d)) - 1;

/**
 * The pulse job. Cheap "not due" most calls. Order of work, each step
 * written to Redis as it finishes so a slow run still keeps what it did:
 *   1. grade finals (score first; the close separately, retried until found)
 *   2. save our number for games tipping in the next 36 hours, games never
 *      saved first, then the oldest saves; a price that comes back after tip
 *      is thrown away, and nothing is saved while the season's results are
 *      still being read in (cold start)
 */
export async function runCbb(now = new Date(), force = false): Promise<string> {
  const t0 = Date.now();
  const left = () => BUDGET_MS - (Date.now() - t0);
  const season = cbbSeason(now);
  const month = etMonth(now);
  if (!force && month >= 4 && month <= 9) return "off season";
  if (!force && (await redis.set(CLAIM, now.toISOString(), { nx: true, ex: 25 * 60 })) !== "OK") return "not due";
  try {
    return await runOnce(now, season, left);
  } catch (e) {
    // A failed run gives the claim back so the next pulse tries again.
    await redis.del(CLAIM).catch(() => null);
    throw e;
  }
}

async function runOnce(now: Date, season: number, left: () => number): Promise<string> {
  const today = etYmd(now);
  const [boards, teams] = await Promise.all([Promise.all([addDays(today, -1), today, addDays(today, 1)].map((d) => boardFor(d).catch(() => [] as CbbBoardGame[]))), espnTeams()]);
  const all = boards.flat();
  const names = Object.fromEntries(teams.map((t) => [t.id, t.location]));
  const [{ r, finals, complete, stale }, tr, trackedRaw] = await Promise.all([ratingsNow(season, today, 24), trankById(season, now, names), redis.hgetall<{ [id: string]: TrackedCbbGame }>(TRACK(season))]);
  const tracked = trackedRaw ?? {};
  fillUnknown(r, all, new Set(teams.map((t) => t.id)));
  const byId = new Map(all.map((g) => [g.id, g]));
  const notes: string[] = [];

  // 1. Grade. Scores from the three boards just read (a game older than that is checked by its own date, a few a run).
  let gradedN = 0;
  let closed = 0;
  const DAY = 86_400_000;
  const open = Object.values(tracked)
    .filter((t) => Date.parse(t.tip) < now.getTime() && Date.parse(t.tip) > now.getTime() - 7 * DAY && (!t.final || !t.close))
    .sort((a, b) => a.tip.localeCompare(b.tip));
  let lookups = 0;
  const graded: { [id: string]: TrackedCbbGame } = {};
  await pool(open, 6, async (t) => {
    if (left() < 8_000) return;
    let next = t;
    if (!t.final) {
      let g = byId.get(t.event);
      if (!g && lookups < 3) {
        lookups++;
        g = (await boardFor(etYmd(new Date(t.tip))).catch(() => [] as CbbBoardGame[])).find((x) => x.id === t.event);
      }
      if (g?.state === "post" && g.score) {
        next = { ...next, final: g.score };
        gradedN++;
      }
    }
    if (next.final && !next.close) {
      const l = await lineFor(t.event, "close").catch(() => null);
      if (l && (l.spread !== null || l.total !== null)) {
        next = { ...next, close: { spread: l.spread, total: l.total } };
        closed++;
      }
    }
    if (next !== t) graded[t.event] = next;
  });
  if (Object.keys(graded).length) await redis.hset(TRACK(season), graded);

  // 2. Save.
  let saved = 0;
  let late = 0;
  if (!complete) notes.push("reading the season's results in, no saves yet");
  else if (stale) notes.push(`seed is from ${SEED.season}-${String(SEED.season + 1).slice(2)}: re-run scripts/fit-cbb.mts, no saves`);
  else {
    const soon = all
      .filter((g) => g.state === "pre" && Date.parse(g.tip) > Date.now() + 60_000 && Date.parse(g.tip) - now.getTime() < 36 * 3_600_000)
      .sort((a, b) => {
        const sa = tracked[a.id]?.last.at ?? "";
        const sb = tracked[b.id]?.last.at ?? "";
        return (sa ? 1 : 0) - (sb ? 1 : 0) || sa.localeCompare(sb) || a.tip.localeCompare(b.tip);
      });
    let tried = 0;
    for (let i = 0; i < soon.length && left() > 4_000; i += 16) {
      const batch = soon.slice(i, i + 16);
      tried += batch.length;
      const lines = await pool(batch, 8, (g) => lineFor(g.id).then((l) => ({ l, at: new Date() })).catch(() => ({ l: null, at: new Date() })));
      const write: { [id: string]: TrackedCbbGame } = {};
      batch.forEach((g, j) => {
        const { l, at } = lines[j];
        // A price read at or after tip is not a pregame price.
        if (at.getTime() >= Date.parse(g.tip)) {
          late++;
          return;
        }
        const snap = snapOf(readGame(g, r, tr, l), at.toISOString());
        if (!snap) return;
        const old = tracked[g.id];
        write[g.id] = { ...old, event: g.id, home: g.home.id, away: g.away.id, homeName: g.home.short, awayName: g.away.short, tip: g.tip, neutral: g.neutral, first: old?.first ?? snap, last: snap };
        tracked[g.id] = write[g.id];
        saved++;
      });
      if (Object.keys(write).length) await redis.hset(TRACK(season), write);
    }
    if (tried - saved - late > 0) notes.push(`${tried - saved - late} with no line yet`);
    if (tried < soon.length) notes.push(`${soon.length - tried} left for the next run`);
  }
  return `cbb: ${finals} finals rated, T-Rank ${tr.by.size} teams${tr.at ? ` (${tr.at.slice(0, 16)})` : " (unavailable)"}, ${saved} saved${late ? `, ${late} too late` : ""}, ${gradedN} graded, ${closed} closes${notes.length ? ` (${notes.join("; ")})` : ""}`;
}

/* ----------------------------------------------------------------- views -- */

export interface CbbBoardRow {
  g: CbbBoardGame;
  read: CbbRead;
  saved?: TrackedCbbGame;
}

export interface CbbBoard {
  season: number;
  today: string;
  days: { day: string; rows: CbbBoardRow[] }[];
  trankAt: string | null;
  finalsRated: number;
  problems: string[];
}

/**
 * Today's and tomorrow's games with our read. Lines come from the last pulse
 * save when it has one (no per-game odds calls on a page load), else from a
 * live read for up to 40 games.
 */
export async function getCbbBoard(now = new Date()): Promise<CbbBoard> {
  const season = cbbSeason(now);
  const today = etYmd(now);
  const problems: string[] = [];
  const days = [today, addDays(today, 1)];
  const [boards, teams, trackedRaw] = await Promise.all([
    Promise.all(days.map((d) => boardFor(d).catch((e) => (problems.push(`ESPN ${d}: ${e instanceof Error ? e.message : e}`), [] as CbbBoardGame[])))),
    espnTeams(),
    redis.hgetall<{ [id: string]: TrackedCbbGame }>(TRACK(season)).catch(() => null),
  ]);
  const tracked = trackedRaw ?? {};
  const names = Object.fromEntries(teams.map((t) => [t.id, t.location]));
  const [{ r, finals, complete, stale }, tr] = await Promise.all([ratingsNow(season, today, 8), trankById(season, now, names)]);
  if (!complete) problems.push("Still reading this season's results in: our ratings are behind for now.");
  if (stale) problems.push(`Our ratings start from ${SEED.season}-${String(SEED.season + 1).slice(2)}: re-run scripts/fit-cbb.mts.`);
  if (!tr.at) problems.push("T-Rank unavailable: our ratings alone.");
  fillUnknown(r, boards.flat(), new Set(teams.map((t) => t.id)));
  // Lines: the pulse's save when it is under 45 minutes old (or the game has tipped), else a live read,
  // at most 40 of them, eight at a time, all inside four seconds.
  const fresh = (t: TrackedCbbGame | undefined) => !!t && now.getTime() - Date.parse(t.last.at) < 45 * 60_000;
  const want = boards.flat().filter((g) => g.state === "pre" && !fresh(tracked[g.id])).slice(0, 40);
  const deadline = Date.now() + 4_000;
  const liveLines = new Map<string, CbbLine | null>();
  await pool(want, 8, async (g) => {
    const ms = deadline - Date.now();
    if (ms < 500) return;
    liveLines.set(g.id, await lineFor(g.id, "now", ms).catch(() => null));
  });
  const out: CbbBoard["days"] = [];
  for (let i = 0; i < days.length; i++) {
    const rows: CbbBoardRow[] = boards[i].map((g) => {
      const saved = tracked[g.id];
      const line = (g.state === "pre" ? liveLines.get(g.id) : undefined) ?? (saved ? lineOfSnap(saved.last) : null);
      return { g, read: readGame(g, r, tr, line), saved };
    });
    out.push({ day: days[i], rows });
  }
  return { season, today, days: out, trankAt: tr.at, finalsRated: finals, problems };
}

const lineOfSnap = (s: CbbSnap): CbbLine => ({ provider: "saved", spread: s.spread, homePrice: s.homePrice, awayPrice: s.awayPrice, total: s.total, overPrice: s.overPrice, underPrice: s.underPrice, mlHome: s.mlHome, mlAway: s.mlAway, open: s.open });

export interface CbbRecord {
  season: number;
  games: TrackedCbbGame[];
  records: SignalRecord[];
  strong: { strong: number; strongTotal: number };
}

export async function getCbbRecord(now = new Date()): Promise<CbbRecord> {
  const season = cbbSeason(now);
  const games = Object.values((await redis.hgetall<{ [id: string]: TrackedCbbGame }>(TRACK(season))) ?? {}).sort((a, b) => b.tip.localeCompare(a.tip));
  const strong = { strong: P.strong, strongTotal: P.strongTotal };
  return { season, games, records: signalRecords(games, strong), strong };
}

export { signalsOf };
export const CBB_PARAMS = P;

/* --------------------------------------------------------------- bracket -- */

/** Neutral-floor strength in points over average, blended, for every Division I team we can rate. */
export async function teamStrengths(now = new Date()): Promise<{ season: number; teams: (EspnTeam & { rating: number; tempo?: number; conf: string; trankRank?: number })[]; trankAt: string | null }> {
  const season = cbbSeason(now);
  const today = etYmd(now);
  const teams = await espnTeams();
  const names = Object.fromEntries(teams.map((t) => [t.id, t.location]));
  const [{ r }, tr] = await Promise.all([ratingsNow(season, today, 8), trankById(season, now, names)]);
  const out = teams.map((t) => {
    const ours = (r.off.get(t.id) ?? 0) + (r.def.get(t.id) ?? 0);
    const x = tr.by.get(t.id);
    // T-Rank's margin against an average team (league efficiency and tempo) on a neutral floor.
    const avg: TrankTeam | null = tr.lg ? { name: "", conf: "", record: "", rank: 0, barthag: 0.5, adjOE: tr.lg.eff, adjDE: tr.lg.eff, adjT: tr.lg.tempo } : null;
    const trank = x && avg && tr.lg ? trankProject(x, avg, tr.lg, true, 0).margin : null;
    const wm = P.blend.margin;
    const rating = trank === null ? ours : (wm.ours * ours + wm.trank * trank) / (wm.ours + wm.trank);
    return { ...t, rating: r2(rating), tempo: x?.adjT, conf: x?.conf ?? "", trankRank: x?.rank };
  });
  return { season, teams: out, trankAt: tr.at };
}
