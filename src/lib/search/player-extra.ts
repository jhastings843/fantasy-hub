import "server-only";
// The rest of a player's pop-up (Jack, 2026-11-04: "show last 5 game history
// for each prop, notable TDs or first basket/KOTC wins if applicable, and our
// most recent bet(s)"). Read only, from the same saved copies the Props page
// grades. loadPlayer (player.ts) stays as it is; this adds the blocks around
// it. Every loader fails on its own: a block that can't be read comes back
// "error" and only that block says so.

import { getOurNbaView } from "@/lib/models/nba/store";
import { getKotcNights } from "@/lib/models/nba/kotc-store";
import { getOurNflView } from "@/lib/models/nfl/store";
import { attdGraded, getOurFtdView } from "@/lib/models/nfl/ftd-store";
import { attdEdges } from "@/lib/models/nfl/anytime";
import { bestCost, ftdEdge } from "@/lib/models/nfl/ftd-price";
import { stakedPropsToday } from "@/lib/props/staked";
import { getPicksReport } from "@/lib/picks/report";
import { getAllPlayers } from "@/lib/sleeper/client";
import { nbaSeasonOfDate, payout, type PropMarket } from "@/lib/props/parse";
import type { Outcome } from "@/lib/props/grade";
import { parseSlug } from "@/lib/firsttd/parse";
import { nbaAbbr, nflAbbr } from "@/lib/search/teams";
import { playerKey } from "@/app/props/search";
import { footballGameHref, nbaGameHref } from "@/app/picks/hrefs";
import type { PlayerView } from "./player";

export type Block<T> = T | "error";

/** One NFL game on our TD boards: his touchdowns and whether he scored the game's first. */
export interface TdGame {
  slug: string;
  at: string | null;
  week: number;
  opp: string;
  home: boolean;
  /** Touchdowns from the box score; null when he didn't play, undefined when no Anytime board was saved. */
  tds?: number | null;
  /** Scored the game's first TD: true/false from our graded First TD board, undefined when that board wasn't saved. */
  first?: boolean;
  /** Our anytime chance that day, when saved. */
  anytime?: number;
}

/** One NBA game on our First Basket board. */
export interface FbGame {
  at: string;
  opp: string;
  home: boolean;
  scored: boolean;
  /** Our chance for him and DK's price, when listed. */
  p: number;
  price: number | null;
}

/** A King of the Court night he won (most points + rebounds + assists on the slate). */
export interface KotcWin {
  date: string;
  pra: number;
  /** Our chance he would be king that night, and his rank on our board (0: not on it). */
  p: number | null;
  rank: number | null;
  /** Shared the crown with someone else. */
  tied: boolean;
}

/** One of our bets or edges on him, graded or still open. */
export interface OurBet {
  at: string | null;
  market: string;
  pick: string;
  price: string;
  result: Outcome | "open" | "void";
  /** Units on 1 risked (staked bets: on the stake); null while open or when the price wasn't saved. */
  net: number | null;
  /** Units staked when a live learner slice made it a bet. */
  staked?: number;
}

export interface PlayerExtra {
  pos: string | null;
  /** His current game's pop-up, when the board lists it. */
  gameHref: string | null;
  tds?: Block<{ games: TdGame[] }>;
  fb?: Block<{ games: FbGame[] }>;
  kotc?: Block<{ wins: KotcWin[]; nights: number }>;
  bets: Block<OurBet[]>;
}

export const BETS_MAX = 5;
const TD_GAMES = 8;
const FB_GAMES = 8;

const safe = <T,>(p: Promise<T>): Promise<Block<T>> => p.catch(() => "error" as const);
const am = (p: number) => (p > 0 ? `+${p}` : `${p}`);
const r2 = (x: number) => Math.round(x * 100) / 100;
const word = (s: "over" | "under") => (s === "over" ? "Over" : "Under");
const nflSeasonOf = (d: Date) => (d.getUTCMonth() < 7 ? d.getUTCFullYear() - 1 : d.getUTCFullYear());

/** Same person: team (normalised) plus first initial and surname, the way the props search keys players. */
const keyOf = (league: "nfl" | "nba", team: string, name: string) => playerKey(league === "nfl" ? nflAbbr(team) : nbaAbbr(team), name);

type SavedLike = { game: { markets: PropMarket[]; home?: string; away?: string; slug?: string }; kickoff?: string; capturedAt?: string; espnId?: string; home?: string; away?: string; result?: { markets: { id: string; play: { outcome: Outcome } | null }[] } };

/** His prop edges on saved boards: graded ones settle at the playing book's price, ungraded ones are open. */
function propBets(boards: SavedLike[], is: (m: PropMarket) => boolean, now: Date): OurBet[] {
  const out: OurBet[] = [];
  for (const b of boards)
    for (const m of b.game.markets) {
      if (!is(m) || !m.clears || !m.side) continue;
      const price = m.books[0]?.[m.side] ?? null;
      const r = b.result?.markets.find((x) => x.id === m.id);
      const o = r?.play?.outcome ?? null;
      if (!b.result && b.kickoff && new Date(b.kickoff) < new Date(now.getTime() - 12 * 3_600_000)) continue; // stale, never graded
      out.push({
        at: b.kickoff ?? b.capturedAt ?? null,
        market: `${m.statLabel} prop`,
        pick: `${word(m.side)} ${m.line}`,
        price: price !== null ? `${am(price)} DK` : "price not saved",
        result: b.result ? (o ?? "void") : "open",
        net: o === "W" ? (price !== null ? r2(payout(price)) : null) : o === "L" ? -1 : o === "P" ? 0 : null,
      });
    }
  return out;
}

const newestFirst = (a: OurBet, b: OurBet) => (b.at ?? "").localeCompare(a.at ?? "");

/** Today's staked bets that name him (live learner slices only). Best effort, capped at 8 seconds. */
async function stakedFor(league: "nfl" | "nba", team: string, name: string, now: Date): Promise<OurBet[]> {
  const k = keyOf(league, team, name);
  const read = await Promise.race([stakedPropsToday(now), new Promise<null>((res) => setTimeout(() => res(null), 8_000))]);
  if (!read) return [];
  return read.bets
    .filter((b) => b.sport === league.toUpperCase() && b.player && keyOf(league, team, b.player) === k)
    .map((b) => ({ at: b.kickoff, market: b.sectionName, pick: b.pick, price: b.priceText, result: "open" as const, net: null, staked: b.stake }));
}

/** Folds the staked copy over the matching open edge (same market and pick), so one bet shows once. */
function mergeBets(lists: Block<OurBet[]>[]): Block<OurBet[]> {
  const ok = lists.filter((l): l is OurBet[] => l !== "error");
  if (!ok.length) return "error";
  const all = ok.flat();
  const staked = all.filter((b) => b.staked !== undefined);
  const rest = all.filter((b) => b.staked === undefined && !staked.some((s) => s.at === b.at && s.pick.toLowerCase().includes(b.pick.toLowerCase())));
  return [...staked, ...rest].sort(newestFirst).slice(0, BETS_MAX);
}

/* -------------------------------------------------------------- NBA -- */

async function nbaExtra(v: PlayerView, now: Date): Promise<PlayerExtra> {
  const season = nbaSeasonOfDate(now);
  const T = nbaAbbr(v.team);
  const me = keyOf("nba", T, v.name);
  const view = await safe(getOurNbaView(season, now));

  // Game pop-up: the saved board for his current game (same teams and tip).
  let gameHref: string | null = null;
  if (view !== "error") {
    const g = view.board.find((b) => b.espnId && (b.kickoff ?? null) === v.kickoff && [nbaAbbr(b.home), nbaAbbr(b.away)].includes(T));
    if (g?.espnId) gameHref = nbaGameHref(g.espnId);
  }

  const fb: PlayerExtra["fb"] =
    view === "error"
      ? "error"
      : {
          games: view.fb.graded
            .flatMap((x) => {
              const p = x.board.players.find((y) => keyOf("nba", y.team, y.name) === me);
              if (!p) return [];
              const home = nbaAbbr(x.board.home) === T;
              return [{ at: x.at, opp: home ? x.board.away : x.board.home, home, scored: x.board.result?.player === p.id, p: p.p, price: p.price }];
            })
            .slice(0, FB_GAMES),
        };

  const kotc = await safe(
    getKotcNights(season).then((nights) => {
      const graded = nights.filter((n) => n.result);
      const wins: KotcWin[] = graded.flatMap((n) => {
        const r = n.result!;
        if (!r.kings.some((k) => keyOf("nba", k.team, k.name) === me)) return [];
        const i = n.board.rows.findIndex((x) => keyOf("nba", x.team, x.name) === me);
        return [{ date: n.date, pra: r.pra, p: i >= 0 ? n.board.rows[i].p : null, rank: i >= 0 ? i + 1 : 0, tied: r.kings.length > 1 }];
      });
      return { wins, nights: graded.length };
    }),
  );

  const isProp = (m: PropMarket) => m.team === v.team.toUpperCase() && m.player.toLowerCase() === v.name.toLowerCase();
  const props: Block<OurBet[]> = view === "error" ? "error" : [...propBets(view.graded as unknown as SavedLike[], isProp, now), ...propBets((view.board as unknown as SavedLike[]).filter((b) => !b.result), isProp, now)];
  const fbBets: Block<OurBet[]> =
    view === "error"
      ? "error"
      : [
          ...view.fb.graded.flatMap((x) => {
            const p = x.board.players.find((y) => keyOf("nba", y.team, y.name) === me);
            const bet = p && x.bets.find((b) => b.id === p.id);
            return bet ? [{ at: x.at, market: "First basket", pick: "First basket", price: `${am(bet.price)} DK`, result: bet.net > 0 ? ("W" as const) : ("L" as const), net: r2(bet.net) }] : [];
          }),
          ...view.board.flatMap((b) => {
            if (!b.fb || b.fb.result !== undefined) return [];
            const p = b.fb.players.find((y) => y.edge && y.price !== null && keyOf("nba", y.team, y.name) === me);
            return p ? [{ at: b.kickoff ?? null, market: "First basket", pick: "First basket", price: `${am(p.price!)} DK`, result: "open" as const, net: null }] : [];
          }),
        ];
  const staked = await safe(stakedFor("nba", T, v.name, now));
  return { pos: null, gameHref, fb, kotc, bets: mergeBets([props, fbBets, staked]) };
}

/* -------------------------------------------------------------- NFL -- */

async function nflExtra(v: PlayerView, now: Date): Promise<PlayerExtra> {
  const season = nflSeasonOf(now);
  const T = nflAbbr(v.team);
  const me = keyOf("nfl", T, v.name);
  const [ov, fv, attd, rep, players] = await Promise.all([safe(getOurNflView(season)), safe(getOurFtdView(season)), safe(attdGraded(season)), safe(getPicksReport("nfl")), safe(getAllPlayers())]);

  // Position from Sleeper's player list: same team and name key, else a unique name match.
  let pos: string | null = null;
  if (players !== "error") {
    const all = Object.values(players).filter((p) => p.full_name);
    const same = all.filter((p) => p.team && keyOf("nfl", p.team, p.full_name!) === me);
    const byName = same.length ? same : all.filter((p) => p.full_name!.toLowerCase() === v.name.toLowerCase());
    if (byName.length === 1) pos = byName[0].position ?? null;
  }

  let gameHref: string | null = null;
  if (rep !== "error") {
    const g = rep.value?.board.find((x) => [nflAbbr(x.home), nflAbbr(x.away)].includes(T) && [nflAbbr(x.home), nflAbbr(x.away)].includes(nflAbbr(v.opp)));
    if (g) gameHref = footballGameHref("nfl", g.away, g.home);
  }

  // Touchdowns: our Anytime boards (box-score TDs) and First TD boards, joined by game.
  let tds: PlayerExtra["tds"];
  if (attd === "error" && fv === "error") tds = "error";
  else {
    const games = new Map<string, TdGame>();
    const base = (slug: string, week: number, at: string | null): TdGame => {
      const s = parseSlug(slug);
      const home = s ? nflAbbr(s.home) === T : false;
      return games.get(slug) ?? { slug, week, at, opp: s ? (home ? s.away : s.home) : "", home };
    };
    if (attd !== "error")
      for (const g of attd) {
        const r = g.rows.find((x) => keyOf("nfl", x.team, x.name) === me);
        if (!r) continue;
        const t = g.result[r.key];
        games.set(g.slug, { ...base(g.slug, g.week, g.at), tds: t === undefined ? null : t, anytime: r.anytime });
      }
    if (fv !== "error")
      for (const g of fv.graded) {
        const p = g.game.teams.flatMap((t) => t.players).find((x) => keyOf("nfl", x.team, x.name) === me);
        if (!p) continue;
        games.set(g.slug, { ...base(g.slug, g.week, g.kickoff ?? g.capturedAt ?? null), first: g.result.key === p.key });
      }
    tds = { games: [...games.values()].sort((a, b) => b.week - a.week || (b.at ?? "").localeCompare(a.at ?? "")).slice(0, TD_GAMES) };
  }

  const isProp = (m: PropMarket) => playerKey(m.team, m.player) === playerKey(v.team, v.name);
  const props: Block<OurBet[]> = ov === "error" ? "error" : [...propBets(ov.graded as unknown as SavedLike[], isProp, now), ...propBets((ov.board as unknown as SavedLike[]).filter((b) => !b.result), isProp, now)];

  // First TD edges (ftd-price.ts ftdEdge at the best of Kalshi, DK, FanDuel), graded and open.
  const ftdBets: Block<OurBet[]> =
    fv === "error"
      ? "error"
      : [...fv.graded.map((g) => ({ g, done: true })), ...fv.board.filter((g) => !g.result).map((g) => ({ g, done: false }))].flatMap(({ g, done }) => {
          const p = g.game.teams.flatMap((t) => t.players).find((x) => keyOf("nfl", x.team, x.name) === me);
          if (!p || p.p === null) return [];
          const b = bestCost(g, p.name);
          if (!b || b.cost >= 1 || !ftdEdge(p.p, b.cost)) return [];
          const won = done && "result" in g && g.result ? g.result.key === p.key : false;
          return [{ at: g.kickoff ?? g.capturedAt ?? null, market: "First TD", pick: "First TD", price: b.where, result: done ? (won ? ("W" as const) : ("L" as const)) : ("open" as const), net: done ? (won ? r2((1 - b.cost) / b.cost) : -1) : null }];
        });

  // Anytime TD edges at DK (anytime.ts attdEdges), graded only: the open board's prices move until kickoff.
  const attdBets: Block<OurBet[]> =
    attd === "error"
      ? "error"
      : attd.flatMap((g) => {
          const r = g.rows.find((x) => keyOf("nfl", x.team, x.name) === me);
          if (!r) return [];
          const t = g.result[r.key];
          return attdEdges(r).map((e) => {
            const won = t !== null && t !== undefined && (e.side === "anytime" ? t > 0 : t > 1);
            return { at: g.at, market: e.side === "anytime" ? "Anytime TD" : "2+ TDs", pick: e.side === "anytime" ? "Anytime TD" : "2+ TDs", price: `${am(e.price)} DK`, result: t === null || t === undefined ? ("void" as const) : won ? ("W" as const) : ("L" as const), net: t === null || t === undefined ? 0 : won ? r2(payout(e.price)) : -1 };
          });
        });

  const staked = await safe(stakedFor("nfl", T, v.name, now));
  return { pos, gameHref, tds, bets: mergeBets([props, ftdBets, attdBets, staked]) };
}

/** Everything around his props: position, game link, TDs or first baskets and kings, our bets on him. Never throws. */
export async function loadPlayerExtra(v: PlayerView, now = new Date()): Promise<PlayerExtra> {
  try {
    return await (v.league === "nba" ? nbaExtra(v, now) : nflExtra(v, now));
  } catch {
    return { pos: null, gameHref: null, bets: "error" };
  }
}
