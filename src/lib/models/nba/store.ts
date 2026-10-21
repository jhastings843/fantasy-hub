import "server-only";
import { redis } from "@/lib/redis/client";
import { etDate, nbaSeasonOfDate, nbaWeek } from "@/lib/props/parse";
import { gradeGame, type EspnBoxTeam } from "@/lib/props/grade";
import { FTD_GATE, PROPS_GATE, sectionView, type SectionView } from "@/lib/learning/engine";
import { loadJournal, loadSection, reviewIfDue } from "@/lib/learning/store";
import type { GradedPropsGame } from "@/lib/props/trends";
import type { StoredProps } from "@/lib/props/store";
import { readMilestones, readPropBets, type PropBetRow } from "../lines";
import { OUR_SECTION, fbCandidates, ourPropCandidates, type FbGradedBoard } from "../learn";
import { compactGame, type EspnNbaSummary, type NbaGame } from "./box";
import { ROTATION_GAMES, ingest, rotation, type PlayerEntry, type SeasonSummary, type TeamEntry } from "./history";
import { ourGame, ourMarkets, type OurMarketExtra } from "./market";
import { posOf, projectGame, projectMinutes, type NbaParams, type PlayerInput } from "./props";
import { emptyTables, fbBets, fbBoard, firstBasketOf, foldFb, type FbBoard, type FbParams, type FbTables } from "./firstbasket";
import { runKotc, type KotcGameInput } from "./kotc-store";
import PARAMS from "./params.json";
import FB_PARAMS from "./fb-params.json";

// Our NBA props model, live. Each run:
// 1. Ingests finished games it hasn't seen (ESPN summaries) into the season's
//    player and team tables, and keeps each game's tip data for First Basket.
// 2. For every game not yet started today or tomorrow (Eastern), projects
//    everyone in each team's recent rotation who isn't listed Out on ESPN's
//    roster, sets the projections against DraftKings' lines (ESPN odds feed)
//    and saves the board, latest pregame copy winning, first lines kept.
// 3. Grades saved games once final, from the same box score as Sam's.
// 4. Runs the learning review on our own section (nba-props-ours).
//
// Redis (all new keys; Sam's are never touched):
//   models:v1:nba:{season}:prior       last season's summary (SeasonSummary)
//   models:v1:nba:{season}:players     hash athlete id -> PlayerEntry
//   models:v1:nba:{season}:teams       { team: TeamEntry }
//   models:v1:nba:{season}:ingested    set of ESPN event ids folded in
//   models:v1:nba:{season}:games       hash event id -> NbaGame (tip and first shots, for First Basket)
//   props:v1:ours:nba:{season}:w{week} hash event id -> OurStoredProps
//   props:v1:ours:nba:{season}:weeks   set of weeks

const P = PARAMS as NbaParams;
/** Players projected under this many minutes can't lead a night; left off the King of the Court list. */
const KOTC_MIN_MINUTES = 8;
const r1 = (x: number) => Math.round(x * 10) / 10;
/** History a player needs before a market gets our number (this season, last season). */
export const MIN_GAMES_NOW = 2;
export const MIN_GAMES_PRIOR = 10;
const FBP = FB_PARAMS as FbParams;
const SITE = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba";
const PROPS = (ev: string, page: number) => `https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba/events/${ev}/competitions/${ev}/odds/100/propBets?limit=1000&page=${page}`;
const UA = { "user-agent": "Mozilla/5.0 (fantasy-hub NBA model)" };

export const K = {
  prior: (s: number) => `models:v1:nba:${s}:prior`,
  players: (s: number) => `models:v1:nba:${s}:players`,
  teams: (s: number) => `models:v1:nba:${s}:teams`,
  ingested: (s: number) => `models:v1:nba:${s}:ingested`,
  games: (s: number) => `models:v1:nba:${s}:games`,
  week: (s: number, w: number) => `props:v1:ours:nba:${s}:w${w}`,
  weeks: (s: number) => `props:v1:ours:nba:${s}:weeks`,
  /** First Basket tables, cumulative across seasons (FbTables). */
  fb: "models:v1:nba:fb",
};

export interface OurStoredProps extends StoredProps {
  /** Our chances and projected minutes per market. */
  extra: { [id: string]: OurMarketExtra };
  away: string;
  home: string;
  /** Our First Basket board against DK's prices, when DK posted the market. */
  fb?: FbBoard;
  /** Everyone's projected PRA, for King of the Court (boards saved from 2026-10-21 evening on). */
  kotc?: KotcGameInput;
}

async function json<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store", headers: UA, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}`);
  return (await res.json()) as T;
}

export interface SbGame {
  id: string;
  tip?: string;
  state: string;
  completed: boolean;
  teams: { id: string; abbr: string; home: boolean }[];
}

export async function scoreboard(now: Date, from: number, to: number): Promise<SbGame[]> {
  const out: SbGame[] = [];
  for (let i = from; i <= to; i++) {
    const d = etDate(new Date(now.getTime() + i * 86_400_000)).replace(/-/g, "");
    const data = await json<{
      events?: { id: string; date?: string; season?: { type?: number }; status?: { type?: { state?: string; completed?: boolean } }; competitions?: { competitors?: { homeAway?: string; team?: { id?: string; abbreviation?: string } }[] }[] }[];
    }>(`${SITE}/scoreboard?dates=${d}`);
    for (const e of data.events ?? []) {
      if (e.season?.type !== undefined && e.season.type !== 2) continue;
      out.push({
        id: e.id,
        tip: e.date,
        state: e.status?.type?.state ?? "",
        completed: !!e.status?.type?.completed,
        teams: (e.competitions?.[0]?.competitors ?? []).map((c) => ({ id: c.team?.id ?? "", abbr: c.team?.abbreviation ?? "", home: c.homeAway === "home" })),
      });
    }
  }
  return out;
}

/** Fold finished games we haven't seen into the season's tables. */
export async function ingestFinals(season: number, finals: string[], report: { problems: string[] }): Promise<string[]> {
  const seen = new Set(((await redis.smembers(K.ingested(season))) ?? []).map(String));
  const todo = finals.filter((id) => !seen.has(id));
  if (!todo.length) return [];
  const teams = (await redis.get<{ [t: string]: TeamEntry }>(K.teams(season))) ?? {};
  const fb = (await redis.get<FbTables>(K.fb)) ?? emptyTables();
  const done: string[] = [];
  for (const id of todo) {
    try {
      const g = compactGame(id, await json<EspnNbaSummary>(`${SITE}/summary?event=${id}`));
      if (!g) continue;
      await foldGame(season, g, teams, fb);
      done.push(id);
    } catch (e) {
      report.problems.push(`ingest ${id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  await redis.set(K.teams(season), teams);
  await redis.set(K.fb, fb);
  return done;
}

/** One game into the player table, the team table (caller saves it) and the game hash. */
export async function foldGame(season: number, g: NbaGame, teams: { [t: string]: TeamEntry }, fb?: FbTables) {
  if (fb) foldFb(fb, g);
  const ids = g.players.map((l) => l.id);
  const got = ids.length ? await redis.hmget<{ [id: string]: PlayerEntry }>(K.players(season), ...ids) : null;
  const players: { [id: string]: PlayerEntry } = {};
  for (const id of ids) if (got?.[id]) players[id] = got[id];
  ingest(players, teams, g);
  await redis.hset(K.players(season), players);
  // First Basket only needs the tip, the starters and the shots.
  await redis.hset(K.games(season), { [g.id]: { ...g, players: g.players.map((l) => ({ ...l, name: "" })) } });
  await redis.sadd(K.ingested(season), g.id);
}

export interface OurNbaReport {
  ingested: string[];
  saved: string[];
  graded: string[];
  learning: string[];
  problems: string[];
  kotc?: string[];
}

export async function loadWeek(season: number, week: number): Promise<{ [id: string]: OurStoredProps }> {
  return (await redis.hgetall<{ [id: string]: OurStoredProps }>(K.week(season, week))) ?? {};
}

export interface RunOptions {
  /** Only these ESPN event ids (a news reprice); grading, King of the Court and the review are skipped. */
  only?: Set<string>;
  /** Athlete ids to treat as Out, and as available, whatever the team roster page says (the injury feed can be ahead of it). */
  extraOut?: Set<string>;
  extraIn?: Set<string>;
}

/** Build tonight's boards, grade finals, review. Safe to call any time. */
export async function runOurNbaProps(now = new Date(), opts: RunOptions = {}): Promise<OurNbaReport> {
  const report: OurNbaReport = { ingested: [], saved: [], graded: [], learning: [], problems: [] };
  const season = nbaSeasonOfDate(now);
  let games: SbGame[] = [];
  try {
    games = await scoreboard(now, -1, 1);
  } catch (e) {
    report.problems.push(`ESPN NBA scoreboard: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!opts.only) report.ingested = await ingestFinals(season, games.filter((g) => g.completed).map((g) => g.id), report);

  const prior = await redis.get<SeasonSummary>(K.prior(season));
  const teams = (await redis.get<{ [t: string]: TeamEntry }>(K.teams(season))) ?? {};
  const fbTables = (await redis.get<FbTables>(K.fb)) ?? emptyTables();
  if (!prior) report.problems.push(`no prior season summary at ${K.prior(season)}: run scripts/seed-nba-models.mts`);

  for (const g of games.filter((x) => x.state === "pre" && x.tip && new Date(x.tip) > now && (!opts.only || opts.only.has(x.id)))) {
    const home = g.teams.find((t) => t.home);
    const away = g.teams.find((t) => !t.home);
    if (!home || !away || !prior) continue;
    try {
      const rows: PropBetRow[] = [];
      for (let page = 1; page <= 4; page++) {
        const d = await json<{ items?: PropBetRow[]; pageCount?: number }>(PROPS(g.id, page));
        rows.push(...(d.items ?? []));
        if (!d.pageCount || page >= d.pageCount) break;
      }
      const lines = readPropBets(rows, "nba");
      if (![...lines.values()].some((l) => l.type === "Total Points")) continue; // DK hasn't posted props yet
      // Rosters: names, positions, and who is listed Out.
      const names = new Map<string, { name: string; team: string }>();
      const out = new Set<string>();
      const pos = new Map<string, string>();
      for (const t of [away, home]) {
        const r = await json<{ athletes?: { id?: string; fullName?: string; position?: { abbreviation?: string }; injuries?: { status?: string }[] }[] }>(`${SITE}/teams/${t.id}/roster`);
        for (const a of r.athletes ?? []) {
          if (!a.id) continue;
          names.set(a.id, { name: a.fullName ?? "", team: t.abbr });
          pos.set(a.id, a.position?.abbreviation ?? "");
          if ((a.injuries?.some((i) => i.status === "Out") || opts.extraOut?.has(a.id)) && !opts.extraIn?.has(a.id)) out.add(a.id);
        }
      }
      // Available: who is likely to play, as the backtest had it (the players
      // who appeared). A team with ROTATION_GAMES games this season uses
      // everyone who played in them; before that, the roster's likeliest
      // players by projected minutes, as many as appear in an average game
      // (last season's count). Anyone DK posts a line for is added; anyone Out is dropped.
      const rosterIds = [...names.keys()].filter((id) => !out.has(id));
      const entries = rosterIds.length ? ((await redis.hmget<{ [id: string]: PlayerEntry }>(K.players(season), ...rosterIds)) ?? {}) : {};
      const input = (id: string): PlayerInput => {
        const e = entries[id];
        return { id, team: names.get(id)!.team, pos: e?.pos ?? posOf(pos.get(id) ?? ""), games: e?.games ?? [], ...(prior.priors[id] ? { prior: prior.priors[id] } : {}) };
      };
      const dkIds = new Set([...lines.values()].map((l) => l.athlete));
      const inputs: PlayerInput[] = [];
      for (const t of [away, home]) {
        const mine = rosterIds.filter((id) => names.get(id)!.team === t.abbr);
        const rot = new Set(rotation(teams[t.abbr]));
        const chosen =
          (teams[t.abbr]?.recent.length ?? 0) >= ROTATION_GAMES
            ? mine.filter((id) => rot.has(id))
            : mine
                .map((id) => ({ id, m: projectMinutes(input(id), prior.base, P) }))
                .sort((a, b) => b.m - a.m)
                .slice(0, Math.round(prior.base.rotationSize ?? 10))
                .map((x) => x.id);
        for (const id of new Set([...chosen, ...mine.filter((id) => dkIds.has(id))])) inputs.push(input(id));
      }
      const tIn = Object.fromEntries(
        [away.abbr, home.abbr].map((t) => [t, { team: t, poss: teams[t]?.poss ?? [], ...(prior.pace[t] !== undefined ? { priorPace: prior.pace[t] } : {}) }]),
      );
      // Rotation players listed Out: the fit hands their minutes to whoever is left ("share"), as the backtest did.
      const absent: PlayerInput[] = [];
      for (const t of [away, home]) {
        const rot = rotation(teams[t.abbr]);
        const outIds = [...out].filter((id) => names.get(id)?.team === t.abbr && rot.includes(id));
        const got = outIds.length ? ((await redis.hmget<{ [id: string]: PlayerEntry }>(K.players(season), ...outIds)) ?? {}) : {};
        for (const id of outIds) {
          const e = got[id];
          absent.push({ id, team: t.abbr, pos: e?.pos ?? posOf(pos.get(id) ?? ""), games: e?.games ?? [], ...(prior.priors[id] ? { prior: prior.priors[id] } : {}) });
        }
      }
      const spread = await homeSpread(g.id);
      // Everyone counts toward the team's minutes, but a market only gets our
      // number when the player has real history: 2+ games this season or 10+
      // last season. A rookie or a player back from a lost season would
      // otherwise get a bench player's guess and a fake edge.
      const informed = new Set(inputs.filter((x) => x.games.length >= MIN_GAMES_NOW || (x.prior?.games ?? 0) >= MIN_GAMES_PRIOR).map((x) => x.id));
      const proj = new Map(projectGame(inputs, tIn, spread, prior.base, P, absent).filter((x) => informed.has(x.id)).map((x) => [x.id, x]));
      const starterOf = new Map(inputs.map((x) => [x.id, x.starter ?? x.games.at(-1)?.starter ?? false]));
      const kotc: KotcGameInput = {
        spread,
        players: [...proj.values()]
          .filter((x) => x.min >= KOTC_MIN_MINUTES)
          .map((x) => ({ id: x.id, name: names.get(x.id)!.name, team: x.team, min: r1(x.min), pra: r1(x.mean.pts + x.mean.reb + x.mean.ast), starter: starterOf.get(x.id) ?? false })),
      };
      const { markets, extra } = ourMarkets(lines, proj, names, P, new Map(inputs.map((x) => [x.id, x.games.length])), readMilestones(rows));
      // First Basket: DK's field is its probable starters; else each team's last starting five, less anyone Out.
      const fbDk = [...lines.values()].filter((l) => l.type === "First Basket" && l.current.over !== null).map((l) => ({ id: l.athlete, price: l.current.over! }));
      const lastStarters: { [team: string]: { id: string; pos: string }[] } = {};
      for (const t of [away, home]) {
        const mine = rosterIds.filter((id) => names.get(id)!.team === t.abbr);
        const lastDate = mine.flatMap((id) => (entries[id]?.games ?? []).filter((x) => x.team === t.abbr).map((x) => x.date)).sort().at(-1);
        lastStarters[t.abbr] = mine.filter((id) => entries[id]?.games.some((x) => x.date === lastDate && x.team === t.abbr && x.starter)).map((id) => ({ id, pos: pos.get(id) ?? "" }));
      }
      const fbNames = new Map([...names].map(([id, v]) => [id, { ...v, pos: pos.get(id) ?? "" }]));
      const fb = fbDk.length ? fbBoard(home.abbr, away.abbr, fbDk, lastStarters, fbNames, fbTables, FBP) : null;
      if (!markets.length && !fb) continue;
      const week = nbaWeek(new Date(g.tip!), season);
      const old = (await loadWeek(season, week))[g.id];
      const stored: OurStoredProps = {
        ...old,
        game: ourGame({ season, week, event: g.id, away: away.abbr, home: home.abbr }, markets),
        capturedAt: now.toISOString(),
        firstSeenAt: old?.firstSeenAt ?? now.toISOString(),
        first: { ...Object.fromEntries(markets.map((m) => [m.id, m.line])), ...old?.first },
        kickoff: g.tip,
        espnId: g.id,
        extra,
        away: away.abbr,
        home: home.abbr,
        ...(fb ? { fb } : {}),
        kotc,
      };
      await redis.hset(K.week(season, week), { [g.id]: stored });
      await redis.sadd(K.weeks(season), String(week));
      report.saved.push(`${away.abbr}@${home.abbr} ${markets.length} props, ${markets.filter((m) => m.clears).length} edges${fb ? `, first basket ${fb.players.filter((x) => x.edge).length} edges` : ""}`);
    } catch (e) {
      report.problems.push(`${away?.abbr}@${home?.abbr}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (opts.only) return report;

  // Grade saved games once final.
  const weeks = ((await redis.smembers(K.weeks(season))) ?? []).map(Number).sort((a, b) => a - b);
  for (const wk of weeks) {
    for (const [id, g] of Object.entries(await loadWeek(season, wk))) {
      if (g.result || !g.kickoff || new Date(g.kickoff) > now) continue;
      try {
        const sum = await json<EspnNbaSummary & { boxscore?: { players?: EspnBoxTeam[] } }>(`${SITE}/summary?event=${id}`);
        if (!sum.header?.competitions?.[0]?.status?.type?.completed) continue;
        if (!sum.boxscore?.players?.length) throw new Error("no box score yet");
        const box = compactGame(id, sum);
        const fb = g.fb ? { ...g.fb, result: box ? firstBasketOf(box) : null } : undefined;
        await redis.hset(K.week(season, wk), { [id]: { ...g, ...(fb ? { fb } : {}), result: gradeGame(g.game, sum.boxscore.players, {}, "nba"), gradedAt: now.toISOString() } });
        report.graded.push(id);
      } catch (e) {
        report.problems.push(`grade ${id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  try {
    const recent = weeks.slice(-2);
    const boards = (await Promise.all(recent.map((w) => loadWeek(season, w)))).flatMap((h) => Object.values(h));
    report.kotc = await runKotc(season, now, games, boards);
  } catch (e) {
    report.problems.push(`King of the Court: ${e instanceof Error ? e.message : String(e)}`);
  }

  try {
    const cands = ourPropCandidates(await gradedList(season), ["pts", "reb", "ast", "threes"]);
    for (const j of await reviewIfDue(OUR_SECTION.nbaProps, season, nbaWeek(now, season), PROPS_GATE, cands, now)) if (j.kind !== "registered") report.learning.push(j.text);
    for (const j of await reviewIfDue(OUR_SECTION.nbaFirstBasket, season, nbaWeek(now, season), FTD_GATE, fbCandidates(await fbGraded(season)), now)) if (j.kind !== "registered") report.learning.push(`First Basket: ${j.text}`);
  } catch (e) {
    report.problems.push(`learning: ${e instanceof Error ? e.message : String(e)}`);
  }
  return report;
}

/** DraftKings' home spread from ESPN's game summary (pickcenter), null when not posted. */
async function homeSpread(event: string): Promise<number | null> {
  try {
    const s = await json<EspnNbaSummary>(`${SITE}/summary?event=${event}`);
    const pc = s.pickcenter?.find((p) => p.provider?.name === "DraftKings") ?? s.pickcenter?.[0];
    if (typeof pc?.spread !== "number") return null;
    return pc.homeTeamOdds?.favorite === false ? Math.abs(pc.spread) : -Math.abs(pc.spread);
  } catch {
    return null;
  }
}

export async function gradedList(season: number): Promise<GradedPropsGame[]> {
  const nums = ((await redis.smembers(K.weeks(season))) ?? []).map(Number);
  const weeks = await Promise.all(nums.map(async (n) => [n, await loadWeek(season, n)] as const));
  return weeks
    .flatMap(([week, games]) => Object.entries(games).flatMap(([slug, g]) => (g.result ? [{ week, slug, game: g.game, result: g.result, first: g.first, kickoff: g.kickoff, capturedAt: g.capturedAt }] : [])))
    .sort((a, b) => (b.kickoff ?? "").localeCompare(a.kickoff ?? "") || a.slug.localeCompare(b.slug));
}

/** Every graded First Basket board, newest first. */
export async function fbGraded(season: number): Promise<(FbGradedBoard & { board: FbBoard })[]> {
  const nums = ((await redis.smembers(K.weeks(season))) ?? []).map(Number);
  const weeks = await Promise.all(nums.map(async (n) => [n, await loadWeek(season, n)] as const));
  return weeks
    .flatMap(([week, games]) =>
      Object.entries(games).flatMap(([event, g]) => {
        if (!g.fb || g.fb.result === undefined) return [];
        const bets = fbBets(g.fb).map((b) => ({ id: b.id, team: g.fb!.players.find((x) => x.id === b.id)?.team ?? "", price: b.price, net: b.net }));
        return [{ event, week, at: g.kickoff ?? g.capturedAt, tip: g.fb.tip, home: g.fb.home, top: g.fb.players[0]?.id ?? "", bets, board: g.fb }];
      }),
    )
    .sort((a, b) => b.at.localeCompare(a.at));
}

export interface OurNbaView {
  season: number;
  /** Saved games from yesterday on (Eastern), soonest first. */
  board: OurStoredProps[];
  graded: GradedPropsGame[];
  learning: SectionView;
  fb: { graded: (FbGradedBoard & { board: FbBoard })[]; learning: SectionView };
}

export async function getOurNbaView(season: number, now = new Date()): Promise<OurNbaView> {
  const nums = ((await redis.smembers(K.weeks(season))) ?? []).map(Number).sort((a, b) => b - a);
  const recent = await Promise.all(nums.slice(0, 2).map((n) => loadWeek(season, n)));
  const yesterday = etDate(new Date(now.getTime() - 86_400_000));
  const board = recent
    .flatMap((h) => Object.values(h))
    .filter((g) => !g.kickoff || etDate(new Date(g.kickoff)) >= yesterday)
    .sort((a, b) => (a.kickoff ?? "").localeCompare(b.kickoff ?? ""));
  const graded = await gradedList(season);
  const [state, journal, fbState, fbJournal, fbList] = await Promise.all([
    loadSection(OUR_SECTION.nbaProps, season),
    loadJournal(OUR_SECTION.nbaProps, season),
    loadSection(OUR_SECTION.nbaFirstBasket, season),
    loadJournal(OUR_SECTION.nbaFirstBasket, season),
    fbGraded(season),
  ]);
  return {
    season,
    board,
    graded,
    learning: sectionView(PROPS_GATE, state, ourPropCandidates(graded, ["pts", "reb", "ast", "threes"]), journal),
    fb: { graded: fbList, learning: sectionView(FTD_GATE, fbState, fbCandidates(fbList), fbJournal) },
  };
}
