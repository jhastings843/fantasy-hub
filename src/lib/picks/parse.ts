// Reading the two models off their public pages.
//
// Pure: every function here takes the text a site served and returns rows, so
// the parsers run against saved copies in test/fixtures/picks without a
// network. Both sites are server-rendered, which is the only reason this works
// at all; if either moves its board behind a client-side fetch, the board
// parsers return nothing and the report says so rather than inventing a week.
//
// Lines are kept from the HOME team's side throughout, betting style: -3.5
// means the home team is favored by 3.5. Every comparison downstream assumes
// that, so it is fixed here at the edge.

import { NFL_TEAMS } from "./teams";

export type League = "nfl" | "cfb";

/** One model's view of one game. */
export interface ModelLine {
  /** The Vegas line this model was compared against, home side. */
  market: number;
  /** The model's own line, home side. */
  model: number;
}

/** A finished game from a model's record. */
export interface GradedRow {
  week: number;
  home: string;
  away: string;
  homePts: number;
  awayPts: number;
  line: ModelLine;
  /** ISO date, when the source has one. */
  date?: string;
  /** Names as the site printed them, for display. Keys are for joining. */
  homeName?: string;
  awayName?: string;
}

/** A game on this week's board. */
export interface BoardRow {
  home: string;
  away: string;
  line: ModelLine;
  homeName?: string;
  awayName?: string;
}

export interface Board {
  week: number | null;
  season: number | null;
  rows: BoardRow[];
}

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&#x27;": "'",
  "&#39;": "'",
  "&quot;": '"',
  "&lt;": "<",
  "&gt;": ">",
  "&nbsp;": " ",
};

export function decode(s: string): string {
  return s
    .replace(/&(amp|#x27|#39|quot|lt|gt|nbsp);/g, (m) => ENTITIES[m] ?? m)
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

/** The page as a flat run of text cells, split by " | ". Scripts and styles dropped. */
export function textCells(html: string): string {
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " | ");
  return decode(stripped).replace(/(\s*\|\s*)+/g, " | ");
}

/** "−3.5", "-3.5", "+7", "PK", "EVEN" to a number. */
export function num(s: string): number {
  const t = s.trim().replace(/−/g, "-");
  if (/^(pk|even|pick)$/i.test(t)) return 0;
  return Number(t);
}

/**
 * The key two sites agree on for a team.
 *
 * NFL names are mapped to the standard abbreviations. College names are
 * folded: accents and punctuation dropped, "State" and "St." treated alike,
 * so "San José State" and "San Jose St." meet. Names that still differ fall
 * out of the join and are listed on the page as unmatched.
 */
export function teamKey(league: League, name: string): string {
  const raw = decode(name).trim();
  if (league === "nfl") {
    if (/^[A-Z]{2,3}$/.test(raw)) return raw;
    return NFL_TEAMS[raw] ?? raw;
  }
  const folded = raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\bst\.?$/, "state")
    .replace(/\bst\.\s/g, "saint ")
    .replace(/['’.()]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return CFB_ALIASES[folded] ?? folded;
}

/**
 * College names that fold differently across sources, mapped to the spelling
 * Sam and David share. PEM's cards turned most of these up; extend the list
 * when the page reports an unmatched game.
 */
const CFB_ALIASES: { [folded: string]: string } = {
  "miami fl": "miami",
  "miami florida": "miami",
  "miami ohio": "miami oh",
  "m oh": "miami oh",
  umass: "massachusetts",
  ulm: "ul monroe",
  "louisiana monroe": "ul monroe",
  "louisiana lafayette": "louisiana",
  "ul lafayette": "louisiana",
  fiu: "florida international",
  "app state": "appalachian state",
  usf: "south florida",
  connecticut: "uconn",
  "north carolina state": "nc state",
  "southern methodist": "smu",
  "texas christian": "tcu",
  "brigham young": "byu",
  "central florida": "ucf",
  "southern mississippi": "southern miss",
  "sam houston state": "sam houston",
  nmsu: "new mexico state",
};

/** A line written as "<team> <number>" from the home side. */
function homeLine(league: League, text: string, home: string): number {
  const t = text.trim();
  if (/^(pk|even|pick)$/i.test(t)) return 0;
  const m = t.match(/^(.*?)\s+([+\-−]?[\d.]+|PK|EVEN)$/i);
  if (!m) return NaN;
  const v = num(m[2]);
  return teamKey(league, m[1]) === home ? v : -v;
}

// ---------------------------------------------------------------- Sam's Models

/**
 * Sam's record page: every graded game, newest first.
 *
 * Each pick carries the pick and its line, the edge, projected and final
 * scores as "away–home". The model line is the projected margin, and the
 * market line is recovered from the pick.
 */
export function parseSamRecord(league: League, html: string, weekOf: (date: string) => number): GradedRow[] {
  const out: GradedRow[] = [];
  const blocks = html.split(/<div class="pick"/).slice(1);
  for (const b of blocks) {
    const date = b.match(/class="pd">([\d-]+)</)?.[1];
    const matchup = b.match(/class="pm">([^<]+)</)?.[1];
    const vals = [...b.matchAll(/class="pv[^"]*">([^<]*)</g)].map((m) => decode(m[1]).trim());
    if (!date || !matchup || vals.length < 5) continue;
    const [pick, , projected, final] = vals;
    const teams = decode(matchup).split(/\s+at\s+/);
    if (teams.length !== 2) continue;
    const away = teamKey(league, teams[0]);
    const home = teamKey(league, teams[1]);
    const pm = pick.match(/^(.*?)\s+([+\-−]?[\d.]+|PK)$/i);
    const pj = projected.split(/[–-]/).map(Number);
    const fs = final.split(/[–-]/).map(Number);
    if (!pm || pj.length !== 2 || fs.length !== 2 || fs.some(isNaN) || pj.some(isNaN)) continue;
    const pickLine = num(pm[2]);
    const pickHome = teamKey(league, pm[1]) === home;
    out.push({
      week: weekOf(date),
      date,
      home,
      away,
      homeName: teams[1].trim(),
      awayName: teams[0].trim(),
      awayPts: fs[0],
      homePts: fs[1],
      line: { market: pickHome ? pickLine : -pickLine, model: -(pj[1] - pj[0]) },
    });
  }
  return out;
}

/** Sam's board: one <article class="game"> per game. */
export function parseSamBoard(league: League, html: string): Board {
  const title = textCells(html).match(/Week (\d+)/);
  const rows: BoardRow[] = [];
  let season: number | null = null;
  for (const art of html.split(/<article class="game"/).slice(1)) {
    const names = [...art.matchAll(/class="nm">([^<]+)</g)].map((m) => m[1]);
    const vegas = art.match(/Vegas line<\/span><span class="val[^"]*">([^<]+)</)?.[1];
    const model = art.match(/Model line<\/span><span class="val[^"]*">([^<]+)</)?.[1];
    const id = art.match(/game\/(\d{4})_(\d+)_/);
    if (id) season = Number(id[1]);
    if (names.length < 2 || !vegas || !model) continue;
    const away = teamKey(league, names[0]);
    const home = teamKey(league, names[1]);
    const market = homeLine(league, decode(vegas), home);
    const m = homeLine(league, decode(model), home);
    if (isNaN(market) || isNaN(m)) continue;
    rows.push({ home, away, homeName: decode(names[1]).trim(), awayName: decode(names[0]).trim(), line: { market, model: m } });
  }
  return { week: title ? Number(title[1]) : null, season, rows };
}

// --------------------------------------------------------------- David Sasser

/** The tabs of David's history sheet, from its public htmlview page. */
export function parseSheetTabs(html: string): { name: string; gid: string; week: number }[] {
  const tabs: { name: string; gid: string; week: number }[] = [];
  for (const m of html.matchAll(/\{name: "([^"]+)", pageUrl: "[^"]*", gid: "(\d+)"/g)) {
    const w = m[1].match(/week\s*(\d+)/i);
    if (w) tabs.push({ name: m[1], gid: m[2], week: Number(w[1]) });
  }
  return tabs;
}

/** RFC 4180-ish: quoted fields with commas, nothing more exotic. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/**
 * One week's tab of David's sheet.
 *
 * `predicted` is the model's home line; `side` and `sideLine` are the pick and
 * the market number it was graded at. The tally columns to the right are
 * ignored.
 */
export function parseSheetWeek(league: League, week: number, csv: string): GradedRow[] {
  const rows = parseCsv(csv);
  const head = rows[0]?.map((h) => h.trim());
  if (!head) return [];
  const col = (n: string) => head.indexOf(n);
  const ix = {
    home: col("homeTeam"),
    away: col("awayTeam"),
    pred: col("predicted"),
    side: col("side"),
    line: col("sideLine"),
    hs: col("homeScore"),
    as: col("awayScore"),
  };
  if (Object.values(ix).some((i) => i < 0)) return [];
  const out: GradedRow[] = [];
  for (const r of rows.slice(1)) {
    if (!r[ix.home]?.trim()) continue;
    const home = teamKey(league, r[ix.home]);
    const away = teamKey(league, r[ix.away]);
    const sideLine = num(r[ix.line] ?? "");
    const model = Number(r[ix.pred]);
    const hp = Number(r[ix.hs]);
    const ap = Number(r[ix.as]);
    if ([sideLine, model].some(isNaN) || r[ix.hs] === "" || r[ix.as] === "" || isNaN(hp) || isNaN(ap)) continue;
    const sideHome = teamKey(league, r[ix.side]) === home;
    out.push({
      week,
      home,
      away,
      homeName: r[ix.home].trim(),
      awayName: r[ix.away].trim(),
      homePts: hp,
      awayPts: ap,
      line: { market: sideHome ? sideLine : -sideLine, model },
    });
  }
  return out;
}

/**
 * David's board, read as text.
 *
 * The NFL page lists "Market line" and "Model line" as "<abbr> −3.5". The
 * college page lists "Open", "Current" (team name and number) and "Proj.
 * Line" as a bare home-side number. Current is used, matching the NFL page's
 * single market number.
 */
export function parseDavidBoard(league: League, html: string): Board {
  const t = textCells(html);
  const wk = t.match(/\| Week \| (\d+) \| Projections/);
  const season = t.match(/\| (20\d\d) \| /);
  const rows: BoardRow[] = [];
  if (league === "nfl") {
    const re =
      /\| [A-Z]{2,3} \| ([A-Z][A-Za-z0-9. ']+?) \| [\d–-]+ \| Projected score \| [\d.]+ \| [A-Z]{2,3} \| ([A-Z][A-Za-z0-9. ']+?) \| [\d–-]+ \| Projected score \| [\d.]+ \| Market line \| ([^|]+?) \| Model line \| ([^|]+?) \|/g;
    for (const m of t.matchAll(re)) {
      const away = teamKey(league, m[1]);
      const home = teamKey(league, m[2]);
      // "DAL −8.5": the named team is the favorite.
      const fav = (s: string) => {
        const x = s.trim().match(/^([A-Z]{2,3})\s+([−\-+]?[\d.]+)$/);
        if (!x) return /^(pk|even)/i.test(s.trim()) ? 0 : NaN;
        const v = num(x[2]);
        return x[1] === home ? v : -v;
      };
      const market = fav(m[3]);
      const model = fav(m[4]);
      if (isNaN(market) || isNaN(model)) continue;
      rows.push({ home, away, homeName: m[2], awayName: m[1], line: { market, model } });
    }
  } else {
    const re =
      /\| ([^|]+?) \| at \| ([^|]+?) \| (?:[^|]+? \| ){0,12}?Open \| [^|]+? \| Current \| ([^|]+?) \| Proj\. Line \| ([^|]+?) \|/g;
    for (const m of t.matchAll(re)) {
      const away = teamKey(league, m[1]);
      const home = teamKey(league, m[2]);
      const market = homeLine(league, m[3], home);
      const model = num(m[4]);
      if (isNaN(market) || isNaN(model)) continue;
      rows.push({ home, away, homeName: m[2].trim(), awayName: m[1].trim(), line: { market, model } });
    }
  }
  return { week: wk ? Number(wk[1]) : null, season: season ? Number(season[1]) : null, rows };
}

// ------------------------------------------------------------------ calendar

/** Tuesday of NFL week 1: the day after Labor Day (first Monday of September). */
export function nflWeekOneTuesday(season: number): Date {
  const sep1 = new Date(Date.UTC(season, 8, 1));
  const toMonday = (8 - sep1.getUTCDay()) % 7;
  return new Date(Date.UTC(season, 8, 1 + toMonday + 1));
}

/**
 * The week a game date falls in, Tuesday to Monday.
 *
 * College runs one week ahead of the NFL on the same calendar: CFB week 6 and
 * NFL week 5 share the Tuesday of October 6, 2026.
 */
export function weekOf(league: League, isoDate: string): number {
  const d = new Date(`${isoDate}T12:00:00Z`);
  const season = d.getUTCMonth() <= 1 ? d.getUTCFullYear() - 1 : d.getUTCFullYear();
  const start = nflWeekOneTuesday(season);
  const nfl = Math.floor((d.getTime() - start.getTime()) / 86_400_000 / 7) + 1;
  return league === "nfl" ? nfl : nfl + 1;
}
