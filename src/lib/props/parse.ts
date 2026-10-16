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

export type Stat = "pass_yds" | "rush_yds" | "rec_yds" | "rec";
export type Side = "over" | "under";

export const STAT_LABEL: { [s in Stat]: string } = {
  pass_yds: "Passing yards",
  rush_yds: "Rushing yards",
  rec_yds: "Receiving yards",
  rec: "Receptions",
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
    const weightM = body.match(/counted at\s*<b>(\d+(?:\.\d+)?)%<\/b>/);
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
    const nameM = b.match(/<b>\d+\.<\/b>\s*([^<]+)<em>([A-Z]{2,3})<\/em>/);
    const betM = b.match(/class="tp-b">\s*(OVER|UNDER)\s+([\d.]+)\s*<span>([^<]+)<\/span>/i);
    const metaM = b.match(/class="tp-m">([\s\S]*?)<\/div>/);
    if (rank === null || !nameM || !betM) continue;
    const meta = metaM ? text(metaM[1]) : "";
    const pm = meta.match(/^([-+]?\d+)\s+at\s+(\S+)/);
    out.push({
      rank,
      player: nameM[1].trim(),
      team: nameM[2],
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
