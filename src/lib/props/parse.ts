// Sam's player prop pages (samthemodelman.smmodel.workers.dev/nfl/props/).
//
// One page per game, current week only, like his first TD pages, so the
// tracker keeps its own pregame copy. What a page gives, per market (a player
// and a stat): the model's projection, every book's line and over/under
// prices, the book Sam would play (the row marked "win"), the win probability
// that play gains over a -110 break-even ("gap", shown as a dash when there is
// no play), and how much weight his projection carried against the market for
// that stat ("counted at 25% toward a play"). A short "Some of our favorites"
// block sits on top.
//
// Sam's play is mostly a market read: a book whose line sits off the
// consensus, nudged by the projection at that weight. Receiving yards carry
// 0% projection weight, so there the play can point against his own number.
// Both are kept: `side` is Sam's play, `lean` is where the projection points.

export type NflStat = "pass_yds" | "rush_yds" | "rec_yds" | "rec";
export type NbaStat = "pts" | "reb" | "ast" | "threes";
export type Stat = NflStat | NbaStat;
export type League = "nfl" | "nba";
export type Side = "over" | "under";

export const STAT_LABEL: { [s in Stat]: string } = {
  pass_yds: "Passing yards",
  rush_yds: "Rushing yards",
  rec_yds: "Receiving yards",
  rec: "Receptions",
  pts: "Points",
  reb: "Rebounds",
  ast: "Assists",
  threes: "Threes",
};

export interface BookLine {
  book: string;
  line: number;
  over: number | null;
  under: number | null;
  /** The row Sam marks as the one to play. */
  win: boolean;
}

export interface PropMarket {
  id: string; // "rec_yds|Troy Franklin"
  stat: Stat | null; // null: a heading this tracker doesn't grade yet
  statLabel: string;
  player: string;
  team: string;
  model: number;
  /** The line shown in the summary, the playing book's line. */
  line: number;
  /** Win probability gained at the playing book. Null when the page shows a dash. */
  gap: number | null;
  /** Sam's page draws the gap muted when it doesn't clear the vig. */
  clears: boolean;
  /** Projection weight for this stat, 0..1. */
  weight: number | null;
  books: BookLine[];
  /** Median of every book's line (Sam's "consensus"). */
  consensus: number;
  /** Sam's side at the playing book, read from where its line sits against the consensus. */
  side: Side | null;
  /** Where the projection points from the shown line. Null on a tie. */
  lean: Side | null;
}

export interface PropFavorite {
  rank: number;
  player: string;
  team: string;
  side: Side;
  line: number;
  statLabel: string;
  price: number | null;
  book: string;
  edge: number | null;
  why: string;
}

export interface PropsGame {
  season: number;
  week: number;
  slug: string;
  away: string;
  home: string;
  /** "0.024 breaks even at -110" from the page's own header line. */
  breakEven: number | null;
  favorites: PropFavorite[];
  markets: PropMarket[];
}

const text = (s: string) =>
  s
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&mdash;/g, "—")
    .replace(/&middot;/g, "·")
    .replace(/&#39;|&rsquo;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
const num = (s: string | undefined): number | null => {
  if (!s) return null;
  const m = s.replace(/−/g, "-").match(/[-+]?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
};

export function statOf(label: string): Stat | null {
  const l = label.toLowerCase();
  if (/^passing yards/.test(l)) return "pass_yds";
  if (/^rushing yards/.test(l)) return "rush_yds";
  if (/^receiving yards/.test(l)) return "rec_yds";
  if (/^receptions/.test(l)) return "rec";
  if (/^points/.test(l)) return "pts";
  if (/^rebounds/.test(l)) return "reb";
  if (/^assists/.test(l)) return "ast";
  if (/^threes/.test(l)) return "threes";
  return null;
}

/** "2026_06_SEA_DEN" to its parts. Sam writes away first. */
export function parseSlug(slug: string): { season: number; week: number; away: string; home: string } | null {
  const m = slug.match(/^(\d{4})_(\d{2})_([A-Z]{2,3})_([A-Z]{2,3})$/);
  return m ? { season: Number(m[1]), week: Number(m[2]), away: m[3], home: m[4] } : null;
}

/** The props links on Sam's NFL board, in board order. */
export function parsePropsLinks(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/href="props\/(\d{4}_\d{2}_[A-Z]{2,3}_[A-Z]{2,3})(?:\.html)?"/g)) {
    if (!out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

/** American price to implied probability (with the vig). */
export function implied(price: number): number {
  return price < 0 ? -price / (-price + 100) : 100 / (price + 100);
}
/** Profit on 1 unit risked at an American price. */
export function payout(price: number): number {
  return price < 0 ? 100 / -price : price / 100;
}

export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  if (!s.length) return NaN;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Sam's side at the playing book. Its line below the consensus is an over
 * (fewer yards to clear), above is an under. When every book hangs the same
 * number the play is a price play: the side where the playing book is
 * cheapest against the others.
 */
export function playSide(books: BookLine[], consensus: number): Side | null {
  const w = books.find((b) => b.win);
  if (!w) return null;
  if (w.line < consensus) return "over";
  if (w.line > consensus) return "under";
  const same = books.filter((b) => b.line === w.line);
  const avg = (k: "over" | "under") => {
    const xs = same.map((b) => b[k]).filter((x): x is number => x !== null).map(implied);
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
  };
  const ao = avg("over");
  const au = avg("under");
  if (w.over === null || w.under === null || ao === null || au === null) return null;
  const go = ao - implied(w.over);
  const gu = au - implied(w.under);
  if (go === gu) return null;
  return go > gu ? "over" : "under";
}

function parseMarkets(html: string): PropMarket[] {
  const out: PropMarket[] = [];
  // Walk the headings and the market blocks in page order.
  const re = /<div class="pp-mkt"><h3>([^<]+)<\/h3>|<details class="pp">([\s\S]*?)<\/details>/g;
  let statLabel = "";
  for (const m of html.matchAll(re)) {
    if (m[1]) {
      statLabel = text(m[1]);
      continue;
    }
    const body = m[2];
    const player = text((body.match(/<span class="nm">([\s\S]*?)<\/span>/) ?? [])[1] ?? "");
    const team = text((body.match(/<span class="tm">([\s\S]*?)<\/span>/) ?? [])[1] ?? "");
    const model = num((body.match(/class="pp-proj"><em>model<\/em>\s*<b>([^<]+)<\/b>/) ?? [])[1]);
    const line = num((body.match(/class="pp-line"><em>line<\/em>\s*<b>([^<]+)<\/b>/) ?? [])[1]);
    const gapM = body.match(/<span class="gapv( nil)?">([^<]*)<\/span>/);
    const gap = gapM ? num(gapM[2]) : null;
    // NFL pages say "counted at 25%", NBA pages "It counts 0%".
    const weightM = body.match(/(?:counted at|counts)\s*<b>(\d+(?:\.\d+)?)%<\/b>/);
    const books: BookLine[] = [];
    for (const r of body.matchAll(/<tr class="(win)?"><td>([^<]+)<\/td><td>([^<]+)<\/td><td>([^<]*)<\/td><td>([^<]*)<\/td><\/tr>/g)) {
      const l = num(r[3]);
      if (l === null) continue;
      books.push({ book: r[2].trim(), line: l, over: num(r[4]), under: num(r[5]), win: !!r[1] });
    }
    if (!player || model === null || line === null || !books.length) continue;
    const stat = statOf(statLabel);
    const consensus = Math.round(median(books.map((b) => b.line)) * 100) / 100;
    out.push({
      id: `${stat ?? statLabel}|${player}`,
      stat,
      statLabel,
      player,
      team,
      model,
      line,
      gap,
      clears: !!gapM && !gapM[1] && gap !== null,
      weight: weightM ? Number(weightM[1]) / 100 : null,
      books,
      consensus,
      side: playSide(books, consensus),
      lean: model > line ? "over" : model < line ? "under" : null,
    });
  }
  return out;
}

function parseFavorites(html: string): PropFavorite[] {
  const out: PropFavorite[] = [];
  for (const c of html.matchAll(/<div class="tp-c">([\s\S]*?)<div class="tp-w">([\s\S]*?)<\/div><\/div>/g)) {
    const b = c[1];
    const rank = num((b.match(/<b>(\d+)\.<\/b>/) ?? [])[1]);
    // NFL favorites carry the team (<em>DEN</em>); NBA favorites don't.
    const nameM = b.match(/<b>\d+\.<\/b>\s*([^<]+)(?:<em>([A-Z]{2,3})<\/em>)?/);
    const betM = b.match(/class="tp-b">\s*(OVER|UNDER)\s+([\d.]+)\s*<span>([^<]+)<\/span>/i);
    const metaM = b.match(/class="tp-m">([\s\S]*?)<\/div>/);
    if (rank === null || !nameM || !betM) continue;
    const meta = metaM ? text(metaM[1]) : "";
    const pm = meta.match(/^([-+]?\d+)\s+at\s+(\S+)/);
    out.push({
      rank,
      player: nameM[1].trim(),
      team: nameM[2] ?? "",
      side: betM[1].toLowerCase() as Side,
      line: Number(betM[2]),
      statLabel: text(betM[3]),
      price: pm ? Number(pm[1]) : null,
      book: pm ? pm[2] : "",
      edge: num((meta.match(/edge\s*([-+]?\d*\.?\d+)/) ?? [])[1]),
      why: text(c[2]),
    });
  }
  return out;
}

/** The props links on Sam's NBA board: one page per game, named by the NBA's game id. */
export function parseNbaPropsLinks(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/href="props\/(\d{10})(?:\.html)?"/g)) {
    if (!out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

/** The season an NBA game id belongs to: "0022600001" is 2026-27, filed as 2026. */
export const nbaSeasonOf = (gameId: string): number | null => (/^\d{3}(\d{2})\d{5}$/.test(gameId) ? 2000 + Number(gameId.slice(3, 5)) : null);

/** The season a date belongs to (October to June is one season, filed under its first year). */
export const nbaSeasonOfDate = (d: Date) => (d.getUTCMonth() < 7 ? d.getUTCFullYear() - 1 : d.getUTCFullYear());

/** Eastern date (YYYY-MM-DD) of an instant. */
export function etDate(at: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

/** Week of the season for a tip time. Week 1 is the Monday-to-Sunday week holding October 21. */
export function nbaWeek(at: Date, season: number): number {
  const anchor = new Date(Date.UTC(season, 9, 21));
  const monday = Date.UTC(season, 9, 21 - ((anchor.getUTCDay() + 6) % 7));
  const day = Date.parse(`${etDate(at)}T00:00:00Z`);
  return Math.floor((day - monday) / (7 * 86_400_000)) + 1;
}

/** An NBA play needs Sam this far off the market's consensus, as a share of it, and at least NBA_MIN_DIFF in the stat. */
export const NBA_MIN_EDGE = 0.15;
export const NBA_MIN_DIFF = 0.5;
/**
 * And a price no worse than this: comparing numbers can't see juice, and a
 * line hung at -200 already means the market sits well past it (Over 0.5
 * threes at -210 is not "Sam 60% off the market").
 */
export const NBA_MAX_JUICE = -150;

/**
 * NBA plays are Sam's projection against the market's number (Jack,
 * 2026-10-19), not his page's pick of an off-market book: the side is where
 * his number sits from the consensus (median of every book's line), priced at
 * the best price among books posting that consensus line (else the nearest
 * line on the bet's side), and `gap` holds his edge as a share of the
 * consensus. His page's own play and win row are dropped.
 */
export function samVsMarket(m: PropMarket): PropMarket {
  const diff = m.model - m.consensus;
  const side: Side | null = diff > 0 ? "over" : diff < 0 ? "under" : null;
  const edge = Math.round((Math.abs(diff) / Math.max(m.consensus, 1)) * 1000) / 1000;
  const books = m.books.map((b) => ({ ...b, win: false }));
  if (side) {
    const atCons = books.filter((b) => b.line === m.consensus && b[side] !== null);
    // No book on the consensus itself (an even count of books): the nearest line on the bet's side.
    const pool = atCons.length
      ? atCons
      : books.filter((b) => b[side] !== null && (side === "over" ? b.line <= m.consensus : b.line >= m.consensus)).sort((a, b) => Math.abs(a.line - m.consensus) - Math.abs(b.line - m.consensus));
    const near = pool.length ? pool.filter((b) => b.line === pool[0].line) : [];
    const best = near.sort((a, b) => implied(a[side]!) - implied(b[side]!))[0];
    if (best) best.win = true;
  }
  const w = books.find((b) => b.win);
  return {
    ...m,
    books,
    line: w?.line ?? m.consensus,
    gap: edge,
    clears: !!side && !!w && edge >= NBA_MIN_EDGE && Math.abs(diff) >= NBA_MIN_DIFF && implied(w[side]!) <= implied(NBA_MAX_JUICE),
    side,
    lean: side,
  };
}

/**
 * One NBA props page. Same template as the NFL pages; the teams come from the
 * title ("BOS at DET") and the week from the tip date (see nba-props.ts).
 */
export function parseNbaPropsPage(gameId: string, html: string, week: number): PropsGame | null {
  const season = nbaSeasonOf(gameId);
  const t = html.match(/<title>\s*([A-Z]{2,4}) at ([A-Z]{2,4})/);
  if (season === null || !t) return null;
  // NBA pages put the book count ("4 bk") where the NFL pages put the team.
  const markets = parseMarkets(html).map((m) => samVsMarket(/\bbk$/.test(m.team) ? { ...m, team: "" } : m));
  if (!markets.length) return null;
  const be = html.match(/<b>([\d.]+)<\/b>\s*breaks even/);
  return { season, week, slug: gameId, away: t[1], home: t[2], breakEven: be ? Number(be[1]) : null, favorites: parseFavorites(html), markets };
}

/** One props page. Null when it isn't a props page we can read. */
export function parsePropsPage(slug: string, html: string): PropsGame | null {
  const id = parseSlug(slug);
  if (!id) return null;
  const markets = parseMarkets(html);
  if (!markets.length) return null;
  const be = html.match(/<b>([\d.]+)<\/b>\s*breaks even/);
  return { ...id, slug, breakEven: be ? Number(be[1]) : null, favorites: parseFavorites(html), markets };
}

/** The playing book's price on a side, or the best price on that side if no row is marked. */
export function playPrice(m: PropMarket, side: Side): { line: number; price: number; book: string } | null {
  const w = m.books.find((b) => b.win);
  if (w && w[side] !== null) return { line: w.line, price: w[side]!, book: w.book };
  // Best for the side: lowest line for an over, highest for an under, then the best price.
  const xs = m.books
    .filter((b) => b[side] !== null)
    .sort((a, b) => (side === "over" ? a.line - b.line : b.line - a.line) || implied(a[side]!) - implied(b[side]!));
  return xs.length ? { line: xs[0].line, price: xs[0][side]!, book: xs[0].book } : null;
}
