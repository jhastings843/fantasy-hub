import "server-only";
import { redis } from "@/lib/redis/client";
import { nbaSeasonOfDate, nbaWeek } from "@/lib/props/parse";
import { etDay, getNbaBoard, NBA_SOURCES, type NbaBoard } from "./nba-store";
import { parseNbaScoreboard } from "./nba";
import {
  allocateNbaDay,
  nbaBets,
  nbaRoom,
  nbaStake,
  tierOf,
  type NbaRoom,
  cutRecord,
  NBA_CUTS,
  nbaGate,
  nbaRule,
  registerNew,
  reviewDue,
  reviewNba,
  settledRows,
  type NbaCutRecord,
  type NbaGate,
  type NbaHypothesis,
  type NbaJournalEntry,
  type NbaRule,
  type NbaSnap,
  type NbaTracked,
  compareCut,
  type NbaComparison,
} from "./nba-track";

// NBA picks' memory (see nba-track.ts for the rules). One hash per season
// (field = ESPN event id) holding each game's first and latest pregame read
// and its final; the learning review's hypotheses, journal and state beside it.

const gamesKey = (season: number) => `picks:v2:nba:${season}:games`;
const hypKey = (season: number) => `picks:v2:nba:${season}:learning:hyp`;
const journalKey = (season: number) => `picks:v2:nba:${season}:learning:journal`;
const stateKey = (season: number) => `picks:v2:nba:${season}:learning:state`;

async function loadGames(season: number): Promise<NbaTracked[]> {
  const h = (await redis.hgetall<{ [id: string]: NbaTracked }>(gamesKey(season))) ?? {};
  return Object.values(h);
}
async function loadHyps(season: number): Promise<NbaHypothesis[]> {
  const h = (await redis.hgetall<{ [id: string]: NbaHypothesis }>(hypKey(season))) ?? {};
  return Object.values(h);
}
async function journal(season: number, entries: NbaJournalEntry[]) {
  if (entries.length) await redis.lpush(journalKey(season), ...entries);
}

const same = (a: NbaSnap, b: NbaSnap) => JSON.stringify({ ...a, at: "" }) === JSON.stringify({ ...b, at: "" });

export interface NbaPicksRunReport {
  season: number;
  saved: string[];
  settled: string[];
  review: string | null;
  problems: string[];
}

/** Save pregame reads, settle finals, run the weekly review when due. Safe to call any time. */
export async function runNbaPicks(now = new Date()): Promise<NbaPicksRunReport> {
  const season = nbaSeasonOfDate(now);
  const report: NbaPicksRunReport = { season, saved: [], settled: [], review: null, problems: [] };
  let board: NbaBoard | null = null;
  try {
    board = await getNbaBoard(now);
    report.problems.push(...board.problems);
  } catch (e) {
    report.problems.push(`NBA board: ${e instanceof Error ? e.message : String(e)}`);
  }
  const have = new Map((await loadGames(season)).map((g) => [g.id, g]));

  // 1. Pregame reads: the first copy is kept, the latest pregame copy replaces the last.
  for (const g of board?.days.flatMap((d) => d.games) ?? []) {
    if (g.state !== "pre" || new Date(g.tip) <= now || !g.read) continue;
    const snap: NbaSnap = {
      at: now.toISOString(),
      line: g.line?.home,
      homePrice: g.line?.homePrice,
      awayPrice: g.line?.awayPrice,
      total: g.total?.points,
      overPrice: g.total?.overPrice,
      underPrice: g.total?.underPrice,
      mlHome: g.ml?.home,
      mlAway: g.ml?.away,
      model: g.read.model,
      samLine: g.read.samLine,
      modelTotal: g.read.modelTotal,
    };
    const old = have.get(g.id);
    if (old && same(old.last, snap)) continue;
    const t: NbaTracked = { id: g.id, day: g.day, week: nbaWeek(new Date(g.tip), season), tip: g.tip, home: g.home.abbr, away: g.away.abbr, first: old?.first ?? snap, last: snap };
    await redis.hset(gamesKey(season), { [g.id]: t });
    have.set(g.id, t);
    report.saved.push(`${t.away}@${t.home}`);
  }

  // 1b. Stakes, only once NBA is live: each game day's untipped tier bets are
  // re-allocated inside the running window and the daily cap; a game keeps
  // the stake it had at its last pregame copy.
  try {
    const all = [...have.values()];
    const rows = settledRows(all);
    const hyps = await loadHyps(season);
    const rule = nbaRule(rows, "ats", hyps.filter((h) => h.status === "active").map((h) => h.id));
    const live = nbaGate(rule).live;
    const open = all.filter((g) => new Date(g.tip) > now);
    for (const day of [...new Set(open.map((g) => g.day))].sort()) {
      const todays = open.filter((g) => g.day === day);
      const cands = todays.flatMap((g) => {
        const b = nbaBets(g).find((x) => x.market === "ats");
        const tier = b ? tierOf(b, rule) : null;
        const rec = tier === 1 ? rule.tier1 : tier === 2 ? rule.tier2 : null;
        const stake = live && b && rec ? nbaStake(rec, b.price) : null;
        return stake ? [{ id: g.id, stake, edge: b!.edge }] : [];
      });
      const room = nbaRoom(all, day, todays.map((g) => g.id));
      const got = allocateNbaDay(cands, room.room);
      for (const g of todays) {
        const stake = got.get(g.id);
        if ((g.stake ?? undefined) === stake) continue;
        const t: NbaTracked = { ...g, stake };
        if (stake === undefined) delete t.stake;
        await redis.hset(gamesKey(season), { [g.id]: t });
        have.set(g.id, t);
      }
    }
  } catch (e) {
    report.problems.push(`NBA stakes: ${e instanceof Error ? e.message : String(e)}`);
  }

  // 2. Finals, from ESPN's scoreboard for each day with an unsettled game that has tipped.
  const days = [...new Set([...have.values()].filter((g) => !g.final && new Date(g.tip) < now).map((g) => g.day))];
  for (const day of days) {
    try {
      const res = await fetch(`${NBA_SOURCES.espn}?dates=${day}`, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
      if (!res.ok) throw new Error(`ESPN answered ${res.status}`);
      for (const e of parseNbaScoreboard(await res.json(), day)) {
        const g = have.get(e.id);
        if (!g || g.final || e.state !== "post" || !e.score) continue;
        const t = { ...g, final: e.score };
        await redis.hset(gamesKey(season), { [g.id]: t });
        have.set(g.id, t);
        report.settled.push(`${g.away}@${g.home}`);
      }
    } catch (e) {
      report.problems.push(`ESPN ${day}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // 3. The learning review: register new research cuts, then the weekly review.
  try {
    const at = now.toISOString();
    let hyps = await loadHyps(season);
    const fresh = registerNew(hyps, at);
    if (fresh.length) {
      for (const h of fresh) await redis.hsetnx(hypKey(season), h.id, h);
      await journal(season, [{ at, kind: "register", text: `Registered ${fresh.length} research cut${fresh.length === 1 ? "" : "s"}; each counts only games first seen from now on.` }]);
      hyps = await loadHyps(season);
    }
    const state = (await redis.get<{ lastReviewAt?: string }>(stateKey(season))) ?? {};
    if (reviewDue(state.lastReviewAt, now) && state.lastReviewAt) {
      const r = reviewNba(settledRows([...have.values()]), hyps, at);
      for (const h of r.hyps) await redis.hset(hypKey(season), { [h.id]: h });
      await journal(season, r.journal);
      await redis.set(stateKey(season), { lastReviewAt: at });
      report.review = r.journal.at(-1)?.text ?? null;
    } else if (!state.lastReviewAt) {
      // The first run starts the weekly clock; there is nothing to review yet.
      await redis.set(stateKey(season), { lastReviewAt: at });
    }
  } catch (e) {
    report.problems.push(`NBA review: ${e instanceof Error ? e.message : String(e)}`);
  }
  return report;
}

export interface NbaPicksView {
  season: number;
  games: NbaTracked[];
  cuts: NbaCutRecord[];
  ats: NbaRule;
  ou: NbaRule;
  gate: NbaGate;
  activated: string[];
  hyps: (NbaHypothesis & { label: string; parentLabel: string; cmp: NbaComparison })[];
  journal: NbaJournalEntry[];
  lastReviewAt: string | null;
  /** Today's room under the running window and the daily cap (Eastern date). */
  room: NbaRoom & { day: string };
}

/** Everything the NBA Results and Research views show, from Redis only. */
export async function getNbaPicksView(season = nbaSeasonOfDate(new Date())): Promise<NbaPicksView> {
  const [games, hyps, jr, state] = await Promise.all([
    loadGames(season),
    loadHyps(season),
    redis.lrange<NbaJournalEntry>(journalKey(season), 0, 49),
    redis.get<{ lastReviewAt?: string }>(stateKey(season)),
  ]);
  const rows = settledRows(games);
  const activated = hyps.filter((h) => h.status === "active").map((h) => h.id);
  const ats = nbaRule(rows, "ats", activated);
  const label = (id: string) => NBA_CUTS.find((c) => c.id === id)?.label ?? id;
  return {
    season,
    games: games.sort((a, b) => b.tip.localeCompare(a.tip)),
    cuts: NBA_CUTS.map((c) => cutRecord(c, rows)),
    ats,
    ou: nbaRule(rows, "ou", activated),
    gate: nbaGate(ats),
    activated,
    hyps: hyps
      .map((h) => ({ ...h, label: label(h.id), parentLabel: label(h.parent), cmp: compareCut(rows, h.id, h.status === "active" ? h.activatedAt! : h.registeredAt) }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    journal: jr ?? [],
    lastReviewAt: state?.lastReviewAt ?? null,
    room: { ...nbaRoom(games, etDay(new Date())), day: etDay(new Date()) },
  };
}
