import "server-only";
// One player's props for the breakdown pop-up (app/props/player): every
// market our model prices for his current game, David's number on it, and on
// NFL his First TD read and any of David's markets we don't price. Read from
// the same saved copies the Props page and search use.

import { getOurNbaView } from "@/lib/models/nba/store";
import { getOurNflView } from "@/lib/models/nfl/store";
import { getOurFtdView } from "@/lib/models/nfl/ftd-store";
import { loadVenomChances } from "@/lib/models/nfl/venom";
import { attdEdges } from "@/lib/models/nfl/anytime";
import { getPropsView } from "@/lib/props/store";
import { davidSide, DAVID_LABEL } from "@/lib/props/david";
import { kalshiCost, kalshiFor } from "@/lib/firsttd/trends";
import { implied, nbaSeasonOfDate, type PropMarket } from "@/lib/props/parse";
import { playerKey } from "@/app/props/search";
import type { GradedPropsGame } from "@/lib/props/trends";
import { boxStats, nameKey, nbaBoxStats, settle, type EspnBoxTeam, type Outcome } from "@/lib/props/grade";

export interface PlayerMarket {
  stat: string;
  line: number;
  over: number | null;
  under: number | null;
  /** Our number (NBA mean, NFL median) and our chance of each side. */
  ours: number;
  chance: { over: number; under: number } | null;
  side: "over" | "under" | null;
  edge: number | null;
  /** True when it clears the bar to count as one of our edges. */
  clears: boolean;
  lean: "over" | "under" | null;
  david: number | null;
  actual: number | null;
  ourResult: Outcome | null;
  davidResult: Outcome | null;
  /** While the game is on: his total so far, from ESPN's box score. */
  live: number | null;
  /** ESPN's stat key, for the live read. */
  key: string;
  /** His earlier saved games in this market, oldest first (up to HISTORY_GAMES): that day's line and what he did. */
  history: PastGame[];
}

/** One earlier game in a market: DraftKings' line that day, what he did, and how our side on it graded. */
export interface PastGame {
  at: string | null;
  opp: string;
  home: boolean;
  line: number;
  /** Null: saved but he didn't play. */
  actual: number | null;
  /** Our edge's grade that day (null when we had no edge). */
  ours: Outcome | null;
}

export const HISTORY_GAMES = 10;

export interface PlayerView {
  league: "nfl" | "nba";
  name: string;
  team: string;
  opp: string;
  home: boolean;
  kickoff: string | null;
  final: boolean;
  markets: PlayerMarket[];
  /** NFL: David's markets we don't price (attempts, or a stat our model skipped). */
  davidOnly: { stat: string; line: number; projection: number; side: "over" | "under" | null; lower: number | null; upper: number | null; actual: number | null; outcome: Outcome | null }[];
  ftd: { p: number; pick: boolean; kalshi: number | null; scored: boolean | null } | null;
  /**
   * NFL Anytime TD for his game (Jack, 2026-11-05): our chance, Venom's when he
   * picked him (his top 5 for the game), the blend of the two, DK's price and
   * break-even, and the box-score TDs once graded (null: didn't play).
   */
  attd?: { ours: number; venom: number | null; blend: number | null; dk: number | null; breakEven: number | null; edge: boolean; tds: number | null | undefined } | null;
  /** ESPN's clock while the game is on ("Q3 4:12"). */
  clock: string | null;
}

const NBA_STAT: { [k: string]: string } = { pts: "Points", reb: "Rebounds", ast: "Assists", threes: "Threes" };
const NFL_STAT: { [k: string]: string } = { pass_yds: "Passing yards", rush_yds: "Rushing yards", rec_yds: "Receiving yards", rec: "Receptions" };
const NFL_FROM_DAVID: { [k: string]: string } = { passing_yards: "pass_yds", rushing_yards: "rush_yds", receiving_yards: "rec_yds", receptions: "rec" };

type Saved = { espnId?: string; game: { markets: PropMarket[]; home?: string; away?: string; slug?: string }; extra: { [id: string]: { over: number; under: number; median?: number } }; result?: { markets: { id: string; actual: number | null; play: { outcome: Outcome } | null; lean: { outcome: Outcome } | null; david?: { outcome: Outcome } | null }[] }; kickoff?: string; david?: { [id: string]: number }; home: string; away: string };

/** His earlier graded games in one market (by stat), oldest first, leaving out the game on show. */
export function historyOf(graded: Pick<GradedPropsGame, "slug" | "game" | "result" | "kickoff">[], pick: (m: PropMarket) => boolean, stat: string, team: string, skip?: string): PastGame[] {
  const out: PastGame[] = [];
  for (const g of graded) {
    if (skip && g.slug === skip) continue;
    const m = g.game.markets.find((x) => x.stat === stat && pick(x));
    if (!m) continue;
    const r = g.result.markets.find((x) => x.id === m.id);
    if (!r) continue;
    const home = team === g.game.home;
    out.push({ at: g.kickoff ?? null, opp: home ? g.game.away : g.game.home, home, line: m.line, actual: r.actual, ours: r.play?.outcome ?? null });
  }
  return out.sort((a, b) => (a.at ?? "").localeCompare(b.at ?? "")).slice(-HISTORY_GAMES);
}

function marketsOf(saved: Saved, pick: (m: PropMarket) => boolean, label: { [k: string]: string }, graded: GradedPropsGame[] = [], team = ""): PlayerMarket[] {
  return saved.game.markets.filter((m) => m.stat && label[m.stat] && pick(m)).map((m) => {
    const x = saved.extra[m.id];
    const g = saved.result?.markets.find((r) => r.id === m.id);
    const dk = m.books[0];
    const side = m.clears && m.side ? m.side : null;
    return {
      stat: label[m.stat!],
      line: m.line,
      over: dk?.over ?? null,
      under: dk?.under ?? null,
      ours: x?.median ?? m.model,
      chance: x ? { over: x.over, under: x.under } : null,
      side,
      edge: m.gap,
      clears: m.clears,
      lean: m.lean,
      david: saved.david?.[m.id] ?? null,
      actual: g?.actual ?? null,
      ourResult: (side ? g?.play?.outcome : g?.lean?.outcome) ?? null,
      davidResult: g?.david?.outcome ?? null,
      live: null,
      key: m.stat!,
      history: historyOf(graded, pick, m.stat!, team, saved.game.slug),
    };
  });
}

/** The player's game: the one with this id if given, else his latest saved one. */
function pickGame<T extends Saved>(board: T[], has: (s: T) => boolean, game?: string): T | undefined {
  const mine = board.filter(has);
  return (game ? mine.find((s) => (s as unknown as { espnId?: string }).espnId === game || (s.game as unknown as { slug?: string }).slug === game) : undefined) ?? mine.sort((a, b) => (b.kickoff ?? "").localeCompare(a.kickoff ?? ""))[0];
}

const ESPN = { nba: "https://site.api.espn.com/apis/site/v2/sports/basketball/nba", nfl: "https://site.api.espn.com/apis/site/v2/sports/football/nfl" };

/** While his game is on, fill each market's total so far from ESPN's box score. Best effort. */
async function liveFill(v: PlayerView, espnId: string | undefined, now: Date): Promise<PlayerView> {
  if (v.final || !espnId || !v.kickoff || new Date(v.kickoff) > now) return v;
  try {
    const r = await fetch(`${ESPN[v.league]}/summary?event=${espnId}`, { cache: "no-store", signal: AbortSignal.timeout(6_000) });
    if (!r.ok) return v;
    const d = (await r.json()) as { header?: { competitions?: { status?: { type?: { state?: string; shortDetail?: string } } }[] }; boxscore?: { players?: EspnBoxTeam[] } };
    const st = d.header?.competitions?.[0]?.status?.type;
    if (st?.state !== "in" || !d.boxscore?.players?.length) return { ...v, clock: st?.state === "in" ? (st.shortDetail ?? null) : null };
    const box = (v.league === "nba" ? nbaBoxStats(d.boxscore.players) : boxStats(d.boxscore.players)).get(nameKey(v.name)) as { [k: string]: number } | undefined;
    return { ...v, clock: st.shortDetail ?? null, markets: v.markets.map((m) => ({ ...m, live: box && Number.isFinite(box[m.key]) ? box[m.key] : 0 })) };
  } catch {
    return v;
  }
}

export async function loadPlayer(league: "nfl" | "nba", team: string, name: string, game?: string, now = new Date()): Promise<PlayerView | null> {
  const T = team.toUpperCase();
  if (league === "nba") {
    const v = await getOurNbaView(nbaSeasonOfDate(now), now).catch(() => null);
    const key = name.toLowerCase();
    const is = (m: PropMarket) => m.team === T && m.player.toLowerCase() === key;
    const saved = pickGame((v?.board ?? []) as unknown as Saved[], (s) => s.game.markets.some(is), game);
    if (!saved) return null;
    const ms = marketsOf(saved, is, NBA_STAT, v?.graded ?? [], T);
    return liveFill({ league, name: saved.game.markets.find(is)!.player, team: T, opp: T === saved.home ? saved.away : saved.home, home: T === saved.home, kickoff: saved.kickoff ?? null, final: !!saved.result, markets: ms, davidOnly: [], ftd: null, clock: null }, saved.espnId, now);
  }
  const season = now.getUTCMonth() < 7 ? now.getUTCFullYear() - 1 : now.getUTCFullYear();
  const [ov, pv, fv] = await Promise.all([getOurNflView(season).catch(() => null), getPropsView(season).catch(() => null), getOurFtdView(season).catch(() => null)]);
  const pk = playerKey(T, name);
  const is = (m: PropMarket) => playerKey(m.team, m.player) === pk;
  const saved = pickGame((ov?.board ?? []) as unknown as Saved[], (s) => s.game.markets.some(is), game);
  const markets = saved ? marketsOf(saved, is, NFL_STAT, ov?.graded ?? [], T) : [];
  const priced = new Set(markets.map((m) => m.stat));
  let home = saved?.home ?? "";
  let away = saved?.away ?? "";
  let kickoff = saved?.kickoff ?? null;
  let full = saved?.game.markets.find(is)?.player ?? name;
  // David's own board: his markets on this player that our model doesn't price.
  const davidOnly: PlayerView["davidOnly"] = [];
  for (const g of pv?.david.games ?? []) {
    const mine = g.props.filter((p) => playerKey(p.team, p.player) === pk);
    if (!mine.length) continue;
    const [, , a, h] = g.gameId.split("_");
    if (!saved) {
      home = h;
      away = a;
      kickoff = g.kickoff;
      full = mine[0].player.includes(".") ? full : mine[0].player;
    }
    const res = new Map((g.result ?? []).map((r) => [r.id, r]));
    for (const p of mine) {
      const ours = NFL_FROM_DAVID[p.market];
      const r = res.get(p.id);
      if (ours && priced.has(NFL_STAT[ours])) {
        // A market we price: his number goes beside ours when our copy didn't save it.
        const m = markets.find((x) => x.stat === NFL_STAT[ours]);
        if (m && m.david === null) {
          m.david = p.projection;
          // Graded at our line, the way our copies grade him.
          m.davidResult = m.actual !== null && p.projection !== m.line ? settle(p.projection > m.line ? "over" : "under", m.line, m.actual) : null;
        }
        continue;
      }
      davidOnly.push({ stat: DAVID_LABEL[p.market], line: p.line, projection: p.projection, side: davidSide(p), lower: p.lower, upper: p.upper, actual: r?.actual ?? null, outcome: r?.outcome ?? null });
    }
  }
  // First TD.
  let ftd: PlayerView["ftd"] = null;
  for (const s of fv?.board ?? []) {
    for (const t of s.game.teams) {
      const p = t.players.find((x) => playerKey(t.team, x.name) === pk);
      if (!p || p.p === null) continue;
      const k = kalshiFor(s.kalshi, p.name);
      ftd = { p: p.p, pick: !!s.game.pick && s.game.pick.team === t.team && s.game.pick.name === p.name, kalshi: k?.ask ? kalshiCost(k.ask) : null, scored: s.result ? s.result.key === p.key : null };
      if (!home) {
        home = s.game.home;
        away = s.game.away;
        kickoff = s.kickoff ?? null;
      }
    }
  }
  // Anytime TD: his row on this week's board, with Venom's chance beside ours.
  let attd: PlayerView["attd"] = null;
  for (const s of fv?.board ?? []) {
    const r = s.attd?.rows.find((x) => playerKey(x.team, x.name) === pk);
    if (!r) continue;
    const venom = fv?.week ? await loadVenomChances(season, fv.week).catch(() => new Map<string, number>()) : new Map<string, number>();
    const vp = venom.get(r.key) ?? null;
    attd = {
      ours: r.anytime,
      venom: vp,
      blend: vp === null ? null : (r.anytime + vp) / 2,
      dk: r.dk ?? null,
      breakEven: r.dk === undefined ? null : implied(r.dk),
      edge: attdEdges(r).some((e) => e.side === "anytime"),
      tds: s.attdResult ? (s.attdResult[r.key] ?? null) : undefined,
    };
    if (!home) {
      home = s.game.home;
      away = s.game.away;
      kickoff = s.kickoff ?? null;
    }
    break;
  }
  if (!markets.length && !davidOnly.length && !ftd && !attd) return null;
  return liveFill({ league, name: full, team: T, opp: T === home ? away : home, home: T === home, kickoff, final: !!saved?.result, markets, davidOnly, ftd, attd, clock: null }, saved?.espnId, now);
}
