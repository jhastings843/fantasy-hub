// Today's staked bets outside football's picks: every prop a live learner
// slice bets, and NBA picks' tier bets once its go-live gate is on. Pure; the
// Redis reads are in lib/props/staked.ts.
//
// Each collector reuses the rule its own page and learner use (pickOurSlice,
// pickDavidSlice, systemHits, attdStaked, rungStaked, ticketStaked,
// kotcStakedTop, the First TD and First Basket slice lists), so a bet here is
// exactly a play the learner counts from the moment its slice went live.
//
// A play is staked when a slice that is live (not paused, not rolled back)
// keeps it and its game starts at or after the slice went live. Several live
// slices keeping the same play make one bet, 1u (lotto tickets 0.1u), with
// every slice named.
//
//   ourPropsStaked({ section: "nba-props-ours", sport: "NBA", boards, entries, now })
//     -> [{ pick: "Jalen Brunson Under 27.5 pts", price: -110, book: "DraftKings", stake: 1, slice: "Edges on the under", ... }]

import type { ViewStatus } from "@/lib/learning/engine";
import { playPrice, type PropMarket, type Side } from "./parse";
import { isPlay } from "./grade";
import { rwSide, type GradedPropsGame } from "./trends";
import { davidSide, davidSliceSide, samOn, type DavidGame, type DavidProp, type SamIndex } from "./david";
import type { StoredProps } from "./store";
import { systemHits, systemSide } from "./system";
import { FB_SLICES, OUR_FTD_SLICES, VENOM_KEEP, davidFar, pickDavidSlice, pickOurSlice, venomLean, type FbGradedBoard, type VenomProps } from "@/lib/models/learn";
import { ATTD_MEMBERS, LOTTO_MEMBERS, attdStaked, inSlice, kotcStakedTop, rungStaked, ticketStaked } from "@/lib/models/sections";
import type { AttdRow } from "@/lib/models/nfl/anytime";
import { bestCost, bookPrice, type Books } from "@/lib/models/nfl/ftd-price";
import { pricedPlayers, type FtdGame } from "@/lib/firsttd/parse";
import { MARKET_SLICES, kalshiCost, kalshiFor } from "@/lib/firsttd/trends";
import type { KalshiGame } from "@/lib/firsttd/kalshi";
import type { FbBoard } from "@/lib/models/nba/firstbasket";
import { STAKE as LOTTO_STAKE, type Rung, type Ticket } from "@/lib/models/nba/lotto";
import { bestTag } from "@/lib/models/nba/kotc-tag";
import type { KotcNight } from "@/lib/models/nba/kotc-store";
import type { OurStoredProps } from "@/lib/models/nba/store";
import { nbaBets, type NbaTracked } from "@/lib/picks/nba-track";

export type Sport = "NFL" | "NBA";

export interface StakedBet {
  /** Stable across reruns and price moves: section, game, player, market, side. Dedupes pushes and emails. */
  id: string;
  section: string;
  /** "NBA props", "NFL First TD", "NBA picks". */
  sectionName: string;
  sport: Sport;
  /** "DAL at GB". */
  game: string;
  player?: string;
  /** What to bet, in words: "Jalen Brunson Under 27.5 pts", "Ja'Marr Chase first TD", "Celtics -4.5". */
  pick: string;
  /** Market short name: "pts", "First TD", "Anytime TD", "Spread". */
  market: string;
  line?: number;
  side?: string;
  /** American price, when the book quotes one. */
  price?: number;
  /** The price as shown: "+450 DraftKings", "12¢ Kalshi". */
  priceText: string;
  book?: string;
  /** Kickoff or tip, ISO. */
  kickoff: string;
  /** The live slice(s) or tier that make it a bet. */
  slice: string;
  stake: number;
  /** Page path that shows it. */
  href: string;
  /**
   * Where the fresh pre-lock quote for it is read (lib/props/fresh.ts), on
   * sections whose edge can be re-judged at a new price: our NFL and NBA
   * props and our Anytime TD. `stat` is the board's stat, or "anytime".
   */
  quote?: { event: string; home: string; away: string; stat: string };
  /** The collector's own id (line-free: section, game, market, side), kept when limitProps renames it. */
  src?: string;
  /** The fresh pre-lock check (props only; NBA picks have none). */
  check?: FreshCheck;
}

/**
 * checked: re-judged at a fresh quote about an hour before lock and still a bet.
 * pending: waiting for that read. gone: the edge isn't there at the fresh
 * price. failed: no fresh quote (read failed, quota stop, not in the read).
 * none: a section this check can't re-judge; pushed at the saved price.
 */
export interface FreshCheck {
  state: "checked" | "pending" | "gone" | "failed" | "none";
  /** When the fresh quote was read, ISO. */
  at?: string;
  /** Why a bet is not pushed: "edge gone at -150". */
  note?: string;
}

export type LiveEntry = { id: string; label: string; status: ViewStatus; activatedAt?: string };

const am = (p: number) => (p > 0 ? `+${p}` : `${p}`);
const SHORT: { [k: string]: string } = { pts: "pts", reb: "reb", ast: "ast", threes: "threes", pass_yds: "pass yds", rush_yds: "rush yds", rec_yds: "rec yds", rec: "rec" };
const sideWord = (x: Side) => (x === "over" ? "Over" : "Under");
const BOOK: { [k: string]: string } = { dk: "DraftKings", draftkings: "DraftKings", fd: "FanDuel", fanduel: "FanDuel", kalshi: "Kalshi" };
const bookName = (b: string) => BOOK[b.toLowerCase()] ?? b;

/** Not started (on or after `now`) and on `today` (Eastern date): what can still be bet today. */
export function openToday(kickoff: string | undefined, now: Date, today: string): kickoff is string {
  if (!kickoff || !(Date.parse(kickoff) > now.getTime())) return false;
  return new Date(kickoff).toLocaleDateString("en-CA", { timeZone: "America/New_York" }) === today;
}

/**
 * The live slices that keep a play starting at `at`, by label. A learner-made
 * combination ("gen:a&b") keeps it when both of its slices would.
 */
export function liveKeeping(entries: LiveEntry[], at: string, keeps: (id: string) => boolean): string[] {
  const t = Date.parse(at);
  return entries
    .filter((e) => e.status === "active" && e.activatedAt && t >= Date.parse(e.activatedAt))
    .filter((e) => (e.id.startsWith("gen:") ? e.id.slice(4).split("&").every((x) => keeps(x)) : keeps(e.id)))
    .map((e) => e.label);
}

const anyLive = (entries: LiveEntry[]) => entries.some((e) => e.status === "active");

// ---------------------------------------------------------------- our props

type OurBoard = StoredProps & { away?: string; home?: string; extra?: { [id: string]: object } };

/**
 * Our NBA or NFL props model (sections nba-props-ours, nfl-props-ours): edge,
 * lean, David and Venom slices. `cardGames` keeps NBA to the props the card
 * shows (lib/models/nba/store.ts carded), as the learner's record does.
 */
export function ourPropsStaked(input: { section: string; sectionName: string; sport: Sport; boards: OurBoard[]; entries: LiveEntry[]; now: Date; today: string; venom?: VenomProps; cardGames?: number; href: string }): StakedBet[] {
  const { boards, entries, now, today } = input;
  if (!anyLive(entries)) return [];
  const out: StakedBet[] = [];
  for (const b of boards) {
    if (b.result || b.late || !openToday(b.kickoff, now, today)) continue;
    for (const m of b.game.markets) {
      if (!m.stat) continue;
      if (input.cardGames && ((b.extra?.[m.id] as { games?: number } | undefined)?.games ?? 0) < input.cardGames) continue;
      const proj = b.david?.[m.id];
      const dSide: Side | null = rwSide(m, proj);
      const sides = { play: isPlay(m) && m.side ? { side: m.side } : null, lean: m.lean ? { side: m.lean } : null, david: dSide ? { side: dSide } : null };
      const lean = input.venom ? venomLean(input.venom, b.game.week, m.stat, m.player) : null;
      const sideFor = (id: string): Side | null => {
        if (id.startsWith("venom:")) {
          if (!sides.play || !VENOM_KEEP[id]) return null;
          return VENOM_KEEP[id]({ recYds: m.stat === "rec_yds", agree: lean ? lean.side === sides.play.side : null, strong: !!lean?.strong }) ? sides.play.side : null;
        }
        if (id.startsWith("david:")) return pickDavidSlice(id, sides, davidFar(proj, m.line))?.side ?? null;
        return pickOurSlice(id, m, sides)?.side ?? null;
      };
      for (const side of ["over", "under"] as const) {
        const slices = liveKeeping(entries, b.kickoff!, (id) => sideFor(id) === side);
        if (!slices.length) continue;
        const at = playPrice(m, side);
        const bet = propBet(input, b, m, side, at, slices);
        out.push(b.espnId ? { ...bet, quote: { event: b.espnId, home: b.home ?? b.game.home, away: b.away ?? b.game.away, stat: m.stat } } : bet);
      }
    }
  }
  return out;
}

function propBet(input: { section: string; sectionName: string; sport: Sport; href: string }, b: StoredProps & { away?: string; home?: string }, m: PropMarket, side: Side, at: { line: number; price: number; book: string } | null, slices: string[]): StakedBet {
  const line = at?.line ?? m.line;
  const stat = m.stat ? SHORT[m.stat] : m.statLabel.toLowerCase();
  return {
    id: `${input.section}|${b.game.slug}|${m.id}|${side}`,
    section: input.section,
    sectionName: input.sectionName,
    sport: input.sport,
    game: `${b.away ?? b.game.away} at ${b.home ?? b.game.home}`,
    player: m.player,
    pick: `${m.player} ${sideWord(side)} ${line} ${stat}`,
    market: stat,
    line,
    side: sideWord(side),
    ...(at ? { price: at.price, book: bookName(at.book) } : {}),
    priceText: at ? `${am(at.price)} ${bookName(at.book)}` : "no price saved",
    kickoff: b.kickoff!,
    slice: slices.join("; "),
    stake: 1,
    href: input.href,
  };
}

// ------------------------------------------------------- Sam and David system

/**
 * The Sam (and David) props system (sections nfl-props, nba-props): the same
 * test the Props page uses to mark "in the system" (systemHits, davidHits).
 */
export function systemStaked(input: {
  section: string;
  sectionName: string;
  sport: Sport;
  current: StoredProps[];
  david?: DavidGame[];
  sam?: SamIndex;
  active: string[];
  graded: GradedPropsGame[];
  labels: { [id: string]: string };
  now: Date;
  today: string;
  href: string;
}): StakedBet[] {
  const { now, today, active } = input;
  if (!active.length) return [];
  const label = (id: string) => input.labels[id] ?? id;
  const out: StakedBet[] = [];
  for (const saved of input.current) {
    if (saved.result || saved.late || !openToday(saved.kickoff, now, today)) continue;
    for (const m of saved.game.markets) {
      if (!m.stat) continue;
      const hits = systemHits(m, saved, active, input.graded);
      for (const side of ["over", "under"] as const) {
        const ids = hits.filter((id) => systemSide(id, m, saved) === side);
        if (ids.length) out.push(propBet(input, saved, m, side, playPrice(m, side), ids.map(label)));
      }
    }
  }
  for (const g of input.david ?? []) {
    if (g.result || !openToday(g.kickoff, now, today)) continue;
    for (const p of g.props) {
      const samProj = input.sam ? samOn(input.sam, p) : undefined;
      for (const side of ["over", "under"] as const) {
        const ids = active.filter((id) => davidSliceSide(id, p, samProj) === side);
        if (ids.length) out.push(davidBet(input, g, p, side, ids.map(label)));
      }
    }
  }
  return out;
}

const DAVID_SHORT: { [k: string]: string } = { passing_yards: "pass yds", pass_attempts: "pass att", rushing_yards: "rush yds", rush_attempts: "rush att", receiving_yards: "rec yds", receptions: "rec" };

function davidBet(input: { section: string; sectionName: string; sport: Sport; href: string }, g: DavidGame, p: DavidProp, side: Side, slices: string[]): StakedBet {
  const [, , away, home] = g.gameId.split("_");
  const price = side === "over" ? p.over : p.under;
  const stat = DAVID_SHORT[p.market] ?? p.market;
  return {
    id: `${input.section}|${g.gameId}|david|${p.id}|${side}`,
    section: input.section,
    sectionName: input.sectionName,
    sport: input.sport,
    game: `${away} at ${home}`,
    player: p.player,
    pick: `${p.player} ${sideWord(side)} ${p.line} ${stat}`,
    market: stat,
    line: p.line,
    side: sideWord(side),
    ...(price !== null ? { price, book: "DraftKings" } : {}),
    priceText: price !== null ? `${am(price)} DraftKings` : "no price saved",
    kickoff: g.kickoff,
    slice: `${slices.join("; ")}${davidSide(p) === side ? "" : " (against David's own side)"}`,
    stake: 1,
    href: input.href,
  };
}

// ------------------------------------------------------------------ First TD

type FtdBoard = Books & { game: FtdGame; kickoff?: string; result?: unknown };

function ftdBet(section: string, sectionName: string, g: FtdBoard, p: { name: string; team: string; key: string }, priceText: string, price: number | undefined, book: string, slices: string[], href: string): StakedBet {
  return {
    id: `${section}|${g.game.slug}|${p.key}`,
    section,
    sectionName,
    sport: "NFL",
    game: `${g.game.away} at ${g.game.home}`,
    player: p.name,
    pick: `${p.name} (${p.team}) first TD`,
    market: "First TD",
    side: "Yes",
    ...(price !== undefined ? { price } : {}),
    priceText,
    book,
    kickoff: g.kickoff!,
    slice: slices.join("; "),
    stake: 1,
    href,
  };
}

/** Our First TD model at the best price of Kalshi, DraftKings and FanDuel (section nfl-firsttd-ours), as its learner grades. */
export function ourFtdStaked(input: { boards: FtdBoard[]; entries: LiveEntry[]; now: Date; today: string; section: string }): StakedBet[] {
  if (!anyLive(input.entries)) return [];
  return input.boards.flatMap((g) => {
    if (g.result || !openToday(g.kickoff, input.now, input.today)) return [];
    return pricedPlayers(g.game).flatMap((p) => {
      const b = bestCost(g, p.name);
      if (!b || b.cost >= 1) return [];
      const slices = liveKeeping(input.entries, g.kickoff!, (id) => !!OUR_FTD_SLICES.find(([x]) => x === id)?.[2](p, b.cost, g.game));
      const price = b.book === "dk" ? bookPrice(g.dk, p.name) : b.book === "fd" ? bookPrice(g.fd, p.name) : null;
      return slices.length ? [ftdBet(input.section, "NFL First TD", g, p, b.where, price ?? undefined, bookName(b.book), slices, "/props?m=ftd")] : [];
    });
  });
}

/** Sam's First TD at Kalshi's ask (section nfl-firsttd), as its learner grades. */
export function samFtdStaked(input: { boards: { game: FtdGame; kickoff?: string; kalshi?: KalshiGame; result?: unknown }[]; entries: LiveEntry[]; now: Date; today: string; section: string }): StakedBet[] {
  if (!anyLive(input.entries)) return [];
  return input.boards.flatMap((g) => {
    if (g.result || !g.kalshi || !openToday(g.kickoff, input.now, input.today)) return [];
    return pricedPlayers(g.game).flatMap((p) => {
      const k = kalshiFor(g.kalshi, p.name);
      if (!k?.ask) return [];
      const cost = kalshiCost(k.ask);
      if (cost >= 1) return [];
      const slices = liveKeeping(input.entries, g.kickoff!, (id) => !!MARKET_SLICES.find(([x]) => x === id)?.[2](p, cost, g.game));
      return slices.length ? [ftdBet(input.section, "NFL First TD (Sam)", g, p, `${Math.round(cost * 100)}¢ Kalshi`, undefined, "Kalshi", slices, "/props?m=ftd")] : [];
    });
  });
}

// --------------------------------------------------------------- Anytime TD

/** Our Anytime TD at DraftKings (section nfl-attd-ours): attdStaked, the page's own test. */
export function attdStakedBets(input: { boards: { game: FtdGame; kickoff?: string; espnId?: string; attd?: { rows: AttdRow[] }; attdResult?: unknown }[]; entries: LiveEntry[]; now: Date; today: string; section: string; venom?: Set<string> }): StakedBet[] {
  if (!anyLive(input.entries)) return [];
  return input.boards.flatMap((g) => {
    if (!g.attd || g.attdResult || !openToday(g.kickoff, input.now, input.today)) return [];
    return g.attd.rows.flatMap((r): StakedBet[] => {
      // Venom's picks this week (by nameKey), undefined when his board isn't in: the Venom slices then keep nobody.
      const venom = input.venom ? input.venom.has(r.key) : undefined;
      if (r.dk === undefined || !attdStaked(input.entries, g.kickoff, r.anytime, r.dk, venom)) return [];
      const play = { ours: r.anytime, price: r.dk, ...(venom !== undefined ? { venom } : {}) };
      const slices = liveKeeping(input.entries, g.kickoff!, (id) => inSlice(ATTD_MEMBERS, id, play));
      return [
        {
          id: `${input.section}|${g.game.slug}|${r.key}`,
          section: input.section,
          sectionName: "NFL Anytime TD",
          sport: "NFL",
          game: `${g.game.away} at ${g.game.home}`,
          player: r.name,
          pick: `${r.name} (${r.team}) anytime TD`,
          market: "Anytime TD",
          side: "Yes",
          price: r.dk,
          priceText: `${am(r.dk)} DraftKings`,
          book: "DraftKings",
          kickoff: g.kickoff!,
          slice: slices.join("; ") || "Live Anytime TD slice",
          stake: 1,
          href: "/props?m=attd",
          ...(g.espnId ? { quote: { event: g.espnId, home: g.game.home, away: g.game.away, stat: "anytime" } } : {}),
        },
      ];
    });
  });
}

// ------------------------------------------------------------ First Basket

/** Our First Basket edges at DraftKings (section nba-firstbasket-ours), by FB_SLICES. */
export function fbStaked(input: { boards: (OurStoredProps | (StoredProps & { fb?: FbBoard; away: string; home: string }))[]; entries: LiveEntry[]; now: Date; today: string; section: string }): StakedBet[] {
  if (!anyLive(input.entries)) return [];
  return input.boards.flatMap((g) => {
    const fb = g.fb;
    if (!fb || fb.result !== undefined || !openToday(g.kickoff, input.now, input.today)) return [];
    const event = g.espnId ?? g.game.slug;
    const board: FbGradedBoard = { event, week: 0, at: g.kickoff!, tip: fb.tip, home: fb.home, top: fb.players[0]?.id ?? "", bets: [] };
    return fb.players.flatMap((x): StakedBet[] => {
      if (!x.edge || x.price === null) return [];
      const bet = { id: x.id, team: x.team, price: x.price, net: 0 };
      const slices = liveKeeping(input.entries, g.kickoff!, (id) => !!FB_SLICES.find(([s]) => s === id)?.[2](board, bet));
      if (!slices.length) return [];
      return [
        {
          id: `${input.section}|${event}|${x.id}`,
          section: input.section,
          sectionName: "NBA First Basket",
          sport: "NBA",
          game: `${g.away} at ${g.home}`,
          player: x.name,
          pick: `${x.name} (${x.team}) first basket`,
          market: "First Basket",
          side: "Yes",
          price: x.price,
          priceText: `${am(x.price)} DraftKings`,
          book: "DraftKings",
          kickoff: g.kickoff!,
          slice: slices.join("; "),
          stake: 1,
          href: "/props?m=fb",
        },
      ];
    });
  });
}

// ------------------------------------------------------------------- Lottos

/** Lotto rungs a live slice keeps (rungStaked) and the nightly ticket when its slice is live (ticketStaked). */
export function lottoStaked(input: { rungs: Rung[]; ticket: Ticket | null; entries: LiveEntry[]; now: Date; today: string; section: string }): StakedBet[] {
  if (!anyLive(input.entries)) return [];
  const out: StakedBet[] = [];
  for (const r of input.rungs) {
    if (r.hit !== null || !openToday(r.at, input.now, input.today) || !rungStaked(input.entries, r)) continue;
    const label = `${r.line}+ ${SHORT[r.stat] ?? r.stat}`;
    out.push({
      id: `${input.section}|${r.game}|${r.id}|${r.line}`,
      section: input.section,
      sectionName: "NBA lottos",
      sport: "NBA",
      game: r.matchup.replace("@", " at "),
      player: r.player,
      pick: `${r.player} ${label}`,
      market: label,
      line: r.line,
      side: "Over",
      price: r.over,
      priceText: `${am(r.over)} DraftKings`,
      book: "DraftKings",
      kickoff: r.at,
      slice: liveKeeping(input.entries, r.at, (id) => inSlice(LOTTO_MEMBERS, id, r)).join("; ") || "Live lotto slice",
      stake: 1,
      href: "/props?m=lotto",
    });
  }
  const t = input.ticket;
  const first = t?.legs.map((l) => l.at).sort()[0];
  if (t && t.outcome === null && first && openToday(first, input.now, input.today) && ticketStaked(input.entries, first)) {
    out.push({
      id: `${input.section}|ticket|${t.date}`,
      section: input.section,
      sectionName: "NBA lottos",
      sport: "NBA",
      game: `${t.legs.length}-leg ticket`,
      pick: t.legs.map((l) => `${l.player} ${l.line}+ ${SHORT[l.stat] ?? l.stat}`).join(", "),
      market: "Ticket",
      price: t.price,
      priceText: `${am(t.price)} DraftKings`,
      book: "DraftKings",
      kickoff: first,
      slice: input.entries.find((e) => e.id === "lotto:ticket")?.label ?? "The nightly ticket",
      stake: LOTTO_STAKE,
      href: "/props?m=lotto",
    });
  }
  return out;
}

// --------------------------------------------------------- King of the Court

/** Tonight's tagged props for our top N, when a King of the Court slice is live (kotcStakedTop, bestTag). */
export function kotcStaked(input: { night: KotcNight | null; boards: OurStoredProps[]; entries: LiveEntry[]; now: Date; today: string; section: string }): StakedBet[] {
  const n = input.night;
  if (!n || n.result || !openToday(n.firstTip, input.now, input.today)) return [];
  const top = kotcStakedTop(input.entries, n.firstTip);
  if (!top) return [];
  const boards = input.boards.filter((b) => n.games.some((g) => g.id === b.espnId));
  const slice = input.entries.filter((e) => e.status === "active").map((e) => e.label).join("; ");
  return n.board.rows.slice(0, top).flatMap((row): StakedBet[] => {
    const t = bestTag(boards, row.name);
    if (!t || !t.board.kickoff || Date.parse(t.board.kickoff) <= input.now.getTime()) return [];
    const stat = t.m.stat ? SHORT[t.m.stat] : t.m.statLabel.toLowerCase();
    return [
      {
        id: `${input.section}|${n.date}|${t.m.id}|${t.side}`,
        section: input.section,
        sectionName: "King of the Court",
        sport: "NBA",
        game: `${t.board.away} at ${t.board.home}`,
        player: row.name,
        pick: `${row.name} ${sideWord(t.side)} ${t.m.line} ${stat}`,
        market: stat,
        line: t.m.line,
        side: sideWord(t.side),
        price: t.price,
        priceText: `${am(t.price)} DraftKings`,
        book: "DraftKings",
        kickoff: t.board.kickoff,
        slice,
        stake: 1,
        href: "/props?m=kotc",
      },
    ];
  });
}

// ---------------------------------------------------------------- NBA picks

/** NBA picks' staked tier bets: games the stake run sized (only when the gate is live) and not tipped. */
export function nbaPicksStaked(input: { games: NbaTracked[]; live: boolean; now: Date; today: string; names?: { [abbr: string]: string } }): StakedBet[] {
  if (!input.live) return [];
  const name = (k: string) => input.names?.[k] ?? k;
  return input.games.flatMap((g): StakedBet[] => {
    if (!g.stake || g.final || !openToday(g.tip, input.now, input.today)) return [];
    const b = nbaBets(g).find((x) => x.market === "ats");
    if (!b) return [];
    const team = b.side === "home" ? g.home : g.away;
    const line = b.line > 0 ? `+${b.line}` : b.line === 0 ? "PK" : `${b.line}`;
    return [
      {
        id: `nba-picks|${g.id}|ats|${b.side}`,
        section: "nba-picks",
        sectionName: "NBA picks",
        sport: "NBA",
        game: `${g.away} at ${g.home}`,
        pick: `${name(team)} ${line}`,
        market: "Spread",
        line: b.line,
        side: b.side,
        ...(b.price !== undefined ? { price: b.price } : {}),
        priceText: b.price !== undefined ? `${am(b.price)} DraftKings` : "-110 assumed",
        book: "DraftKings",
        kickoff: g.tip,
        slice: "NBA spread rule",
        stake: g.stake,
        href: `/picks?l=nba`,
      },
    ];
  });
}

// ------------------------------------------------------------------- shared

/** Soonest first, one bet per id. */
export function tidy(bets: StakedBet[]): StakedBet[] {
  const seen = new Set<string>();
  return bets
    .filter((b) => (seen.has(b.id) ? false : (seen.add(b.id), true)))
    .sort((a, b) => a.kickoff.localeCompare(b.kickoff) || a.sectionName.localeCompare(b.sectionName) || a.pick.localeCompare(b.pick));
}

/**
 * Limits on staked props before anything is emailed or pushed (audit 2026-11-02):
 *   - no price saved, no bet: a 1u bet at an unknown price can't be judged;
 *   - one bet per prop: two live sections on the same player, market, line and
 *     side are one bet, listing both slices;
 *   - at most PROPS_GAME_MAX per game (they move together) and PROPS_DAY_MAX_U
 *     units a day, soonest first. Anything cut is reported, never silently lost.
 *
 *   limitProps([a, a', b], ...) -> [a (slices of a and a'), b]
 */
export const PROPS_GAME_MAX = 3;
export const PROPS_DAY_MAX_U = 10;
export function limitProps(bets: StakedBet[], prior: { id: string; game: string; stake: number }[] = []): { bets: StakedBet[]; cut: string[] } {
  const cut: string[] = [];
  const byProp = new Map<string, StakedBet>();
  for (const b of bets) {
    if (b.priceText === "no price saved") {
      cut.push(`${b.pick}: no price saved`);
      continue;
    }
    // One identity per prop whichever section found it, so a push or email can never repeat under another section's id.
    const k = propId(b);
    const had = byProp.get(k);
    if (had) byProp.set(k, { ...had, slice: [...new Set([...had.slice.split("; "), ...b.slice.split("; ")])].join("; ") });
    else byProp.set(k, { ...b, id: k, src: b.src ?? b.id });
  }
  // Bets already staked earlier today count against the caps even once their game has started (they drop off later reads).
  const seen = new Set(prior.map((p) => p.id));
  const perGame = new Map<string, number>();
  let units = 0;
  for (const p of prior) {
    perGame.set(p.game, (perGame.get(p.game) ?? 0) + 1);
    units += p.stake;
  }
  const out: StakedBet[] = [];
  for (const b of byProp.values()) {
    if (seen.has(b.id)) {
      out.push(b);
      continue;
    }
    const g = `${b.sport}|${b.game}`;
    if ((perGame.get(g) ?? 0) >= PROPS_GAME_MAX) {
      cut.push(`${b.pick}: ${PROPS_GAME_MAX} bets already on ${b.game}`);
      continue;
    }
    if (units + b.stake > PROPS_DAY_MAX_U) {
      cut.push(`${b.pick}: day limit ${PROPS_DAY_MAX_U}u reached`);
      continue;
    }
    perGame.set(g, (perGame.get(g) ?? 0) + 1);
    units += b.stake;
    out.push(b);
  }
  return { bets: out, cut };
}

/** One prop's identity across sections: sport, game and the pick in words (player, side, line, stat). */
export const propId = (b: Pick<StakedBet, "sport" | "game" | "pick">) => `prop|${b.sport}|${b.game}|${b.pick}`;

/** The minutes before lock inside which no new push goes out. */
export const PUSH_CUTOFF_MS = 5 * 60 * 1000;

/**
 * Can this bet be pushed: lock more than 5 minutes off, and, for a prop the
 * fresh check covers, only once that check passed (fail closed: pending,
 * gone and failed are never pushed).
 */
export const pushable = (b: StakedBet, now: Date) => Date.parse(b.kickoff) - now.getTime() > PUSH_CUTOFF_MS && (!b.check || b.check.state === "checked" || b.check.state === "none");

const etTime = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" }).replace(" ", "").toLowerCase();

/** The price as the push and the Today tab show it: "-115 DraftKings, checked 1:10pm". */
export function checkedPrice(b: Pick<StakedBet, "priceText" | "check">): string {
  const c = b.check;
  if (c?.state === "checked" && c.at) return `${b.priceText}, checked ${etTime(c.at)}`;
  if (c?.state === "none") return `${b.priceText}, this morning's price, not rechecked`;
  return b.priceText;
}

/** The fresh check for a Today tab card: " · price checked 1:10pm", " · check pending", " · not a bet: edge gone at -150". */
export function checkNote(b: Pick<StakedBet, "check">): string {
  const c = b.check;
  if (!c) return "";
  if (c.state === "checked") return c.at ? ` · price checked ${etTime(c.at)}` : " · price checked";
  if (c.state === "pending") return " · check pending";
  if (c.state === "none") return " · price not rechecked";
  return ` · not a bet: ${c.note ?? "no fresh price"}`;
}

/** The phone alert for one staked bet. Pure. */
export function stakedPush(b: StakedBet, appUrl: string): { title: string; message: string; url: string; urlTitle: string } {
  const at = new Date(b.kickoff).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" });
  return {
    title: `${b.sectionName}: ${b.stake}u bet`,
    message: `${b.pick} · ${b.stake}u (${checkedPrice(b)}) · ${b.game}, ${at} ET\n${b.slice}`,
    url: `${appUrl}${b.href}`,
    urlTitle: "Open",
  };
}
