// Price shopping (Jack, 2026-10-26): the bet gate reads DraftKings' price
// through ESPN, and a Tier 1 at -112 there is a pass while FanDuel or
// Fanatics may have -110 at the same number (NFL Week 7: NYG +10.5, a 12-2
// Tier 1 that needs -110 or better). Jack bets at DraftKings, FanDuel and
// Fanatics, so a side's price is the best of the three AT DRAFTKINGS' OWN
// LINE. A better price at a different line is not used: the tier record was
// earned at the reference line, and a half point has its own value (alt
// lines are a later step).
//
// Source: The Odds API's sport odds endpoint, spreads and totals, those
// three books: 2 credits a read (one per market; up to 10 books count as one
// region), whatever the number of games. Pure: parsing, matching, applying.

import type { RefLine } from "./engine";
import type { League } from "./parse";
import { NFL_TEAMS } from "./teams";

// Fanatics is on The Odds API's paid plans only: on the free key it comes back
// empty (checked 2026-10-26), so in practice this shops FanDuel. Kept in the
// list because it costs nothing and works if the plan changes.
export const SHOP_BOOKS = ["draftkings", "fanduel", "fanatics"] as const;
export const SHOP_SPORT: { [l in League]: string } = { nfl: "americanfootball_nfl", cfb: "americanfootball_ncaaf" };
/** A shop read older than this is not applied: prices move. */
export const SHOP_FRESH_MIN = 180;

export interface Px {
  point: number;
  price: number;
}
export interface BookQuote {
  title: string;
  spread?: { home?: Px; away?: Px };
  total?: { over?: Px; under?: Px };
}
/** One game's quotes from every shopped book, keyed by Odds API bookmaker key. */
export interface ShopGame {
  home: string;
  away: string;
  commence: string;
  books: { [key: string]: BookQuote };
}
export interface ShopRead {
  at: string;
  league: League;
  games: ShopGame[];
  cost?: number;
}

interface OddsOutcome {
  name: string;
  price: number;
  point?: number;
}
export interface OddsGame {
  id: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers?: { key: string; title: string; markets?: { key: string; outcomes?: OddsOutcome[] }[] }[];
}

/** "Hawai'i Rainbow Warriors" -> "hawaii rainbow warriors"; "St." -> "state". */
export const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/['’.]/g, "")
    .replace(/&/g, " and ")
    .replace(/\bst\b/g, "state")
    .replace(/[^a-z0-9()]+/g, " ")
    .trim();

/**
 * The app's name for an Odds API team. NFL: the abbreviation table. College:
 * the app's school name that starts the Odds API's full name (school plus
 * mascot), longest first, so "texas tech" wins over "texas".
 */
export function teamOf(league: League, oddsName: string, appNames: string[]): string | null {
  if (league === "nfl") return NFL_TEAMS[oddsName] ?? null;
  const full = norm(oddsName);
  const hit = [...appNames].sort((a, b) => norm(b).length - norm(a).length).find((n) => full === norm(n) || full.startsWith(`${norm(n)} `));
  return hit ?? null;
}

/** The read's games in the app's names; games whose teams can't be named are dropped. */
export function parseShop(league: League, body: OddsGame[], appNames: string[]): ShopGame[] {
  const out: ShopGame[] = [];
  for (const g of body) {
    const home = teamOf(league, g.home_team, appNames);
    const away = teamOf(league, g.away_team, appNames);
    if (!home || !away) continue;
    const books: ShopGame["books"] = {};
    for (const b of g.bookmakers ?? []) {
      const q: BookQuote = { title: b.title };
      for (const m of b.markets ?? []) {
        const px = (o?: OddsOutcome) => (o && typeof o.point === "number" && typeof o.price === "number" ? { point: o.point, price: o.price } : undefined);
        if (m.key === "spreads") q.spread = { home: px(m.outcomes?.find((o) => o.name === g.home_team)), away: px(m.outcomes?.find((o) => o.name === g.away_team)) };
        if (m.key === "totals") q.total = { over: px(m.outcomes?.find((o) => o.name === "Over")), under: px(m.outcomes?.find((o) => o.name === "Under")) };
      }
      books[b.key] = q;
    }
    out.push({ home, away, commence: g.commence_time, books });
  }
  return out;
}

/** Payout per unit risked: higher is better for the bettor. */
const pays = (price: number) => (price < 0 ? 100 / -price : price / 100);

type SideKey = "home" | "away" | "over" | "under";
const PRICE_KEY = { home: "homePrice", away: "awayPrice", over: "overPrice", under: "underPrice" } as const;

/**
 * The reference quote with each side's price raised to the best shopped
 * price at DraftKings' own number, when a shopped book beats it. Records
 * which book and DraftKings' own prices. Unchanged when nothing beats DK.
 */
export function applyShop(ref: RefLine, g: ShopGame | undefined, at: string): RefLine {
  if (!g) return ref;
  const want: { [s in SideKey]: number | undefined } = { home: ref.line, away: -ref.line, over: ref.total, under: ref.total };
  const out: RefLine = { ...ref };
  const shop: NonNullable<RefLine["shop"]> = { at, dk: { homePrice: ref.homePrice, awayPrice: ref.awayPrice, overPrice: ref.overPrice, underPrice: ref.underPrice } };
  let changed = false;
  for (const side of ["home", "away", "over", "under"] as SideKey[]) {
    const dk = ref[PRICE_KEY[side]];
    const point = want[side];
    if (dk === undefined || point === undefined) continue;
    let best: { price: number; title: string } | null = null;
    for (const [k, b] of Object.entries(g.books)) {
      if (k === "draftkings") continue; // DK's own price comes from ESPN, the reference
      const px = side === "home" || side === "away" ? b.spread?.[side] : b.total?.[side];
      if (!px || px.point !== point) continue;
      if (pays(px.price) > pays(best?.price ?? dk) + 1e-9) best = { price: px.price, title: b.title };
    }
    if (best) {
      out[PRICE_KEY[side]] = best.price;
      shop[side] = best.title;
      changed = true;
    }
  }
  return changed ? { ...out, shop } : ref;
}

/** Which book a side's price is from, when it isn't DraftKings. */
export const bookOf = (ref: { shop?: Partial<Record<SideKey, string>> } | undefined, side: SideKey | undefined): string | undefined => (side ? ref?.shop?.[side] : undefined);

/** "-110" or, when the price is another book's, "-110 FanDuel". */
export const priceWithBook = (text: string, ref: { shop?: Partial<Record<SideKey, string>> } | undefined, side: SideKey | undefined) => {
  const b = bookOf(ref, side);
  return b ? `${text} ${b}` : text;
};
