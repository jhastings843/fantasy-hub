// NBA on the Picks tab: the parsing half (pure, tested). The fetching half is
// nba-store.ts.
//
// Sam's NBA board is new (his /nba/ page said "coming 10/19" on the day this
// was built) and David has no NBA page, so this is one model against the
// DraftKings line, shown and not staked. NBA stays out of the NFL/college
// engine (weekly rule, tiers, budget, emails) until Sam's NBA picks have a
// record to judge.
//
// Lines are written from the home side, like the rest of Picks: negative
// means the home team is favored.
import { decode } from "./parse";

export type NbaTeam = { abbr: string; name: string; short: string };

export type NbaGame = {
  id: string;
  /** ESPN tip time, ISO. */
  tip: string;
  /** The game date ESPN files it under (Eastern), YYYYMMDD. */
  day: string;
  state: "pre" | "in" | "post";
  detail: string;
  home: NbaTeam;
  away: NbaTeam;
  /** DraftKings via ESPN. */
  line?: { home: number; homePrice?: number; awayPrice?: number };
  total?: { points: number; overPrice?: number; underPrice?: number };
  ml?: { home?: number; away?: number };
  score?: { home: number; away: number };
};

export type SamNbaRow = { home: string; away: string; model: number; vegas: number; total?: number };

export type SamNbaStatus =
  | { state: "soon"; note: string }
  | { state: "live"; rows: SamNbaRow[] }
  /** The page is up but this parser finds no games on it: the markup changed or isn't the NFL template. */
  | { state: "unread" }
  | { state: "down"; error: string };

const odds = (x: unknown): number | undefined => {
  if (typeof x !== "string" && typeof x !== "number") return undefined;
  const t = String(x).trim().toUpperCase();
  if (t === "EVEN") return 100;
  const v = Number(t.replace("+", ""));
  return Number.isFinite(v) ? v : undefined;
};

const lineNum = (x: unknown): number | undefined => {
  if (typeof x === "number") return x;
  if (typeof x !== "string") return undefined;
  const t = x.trim().replace(/^[ou]/i, "");
  if (/^(pk|even|pick)$/i.test(t)) return 0;
  const v = Number(t.replace("+", ""));
  return Number.isFinite(v) ? v : undefined;
};

/* eslint-disable @typescript-eslint/no-explicit-any */
/** DraftKings' spread, total and moneyline from one ESPN odds entry (scoreboard or summary pickcenter). */
export function nbaOdds(o: any): Pick<NbaGame, "line" | "total" | "ml"> {
  const g: Pick<NbaGame, "line" | "total" | "ml"> = {};
  // `spread` is already the home line; the close prices sit under pointSpread.
  const home = lineNum(o?.pointSpread?.home?.close?.line) ?? lineNum(o?.spread);
  if (home !== undefined) g.line = { home, homePrice: odds(o.pointSpread?.home?.close?.odds), awayPrice: odds(o.pointSpread?.away?.close?.odds) };
  const pts = lineNum(o?.total?.over?.close?.line) ?? lineNum(o?.overUnder);
  if (pts !== undefined) g.total = { points: pts, overPrice: odds(o.total?.over?.close?.odds), underPrice: odds(o.total?.under?.close?.odds) };
  const mh = odds(o?.moneyline?.home?.close?.odds);
  const ma = odds(o?.moneyline?.away?.close?.odds);
  if (mh !== undefined || ma !== undefined) g.ml = { home: mh, away: ma };
  return g;
}

/** The closing odds from ESPN's game summary: the scoreboard drops them once a game tips. */
export function parseNbaSummaryOdds(json: any): Pick<NbaGame, "line" | "total" | "ml"> {
  const pc = json?.pickcenter ?? [];
  const o = pc.find((x: any) => /draftkings/i.test(x?.provider?.name ?? "")) ?? pc[0];
  return o ? nbaOdds(o) : {};
}

/** One day of ESPN's NBA scoreboard. */
export function parseNbaScoreboard(json: any, day: string): NbaGame[] {
  const out: NbaGame[] = [];
  for (const e of json?.events ?? []) {
    const c = e?.competitions?.[0];
    const team = (side: "home" | "away") => c?.competitors?.find((x: any) => x.homeAway === side);
    const h = team("home");
    const a = team("away");
    if (!c || !h || !a) continue;
    const t = (x: any): NbaTeam => ({ abbr: x.team.abbreviation, name: x.team.displayName, short: x.team.shortDisplayName ?? x.team.name });
    const o = c.odds?.find((x: any) => /draftkings/i.test(x?.provider?.name ?? "")) ?? c.odds?.[0];
    const state = c.status?.type?.state === "in" ? "in" : c.status?.type?.state === "post" ? "post" : "pre";
    const g: NbaGame = {
      id: String(e.id),
      tip: e.date,
      day,
      state,
      detail: c.status?.type?.shortDetail ?? "",
      home: t(h),
      away: t(a),
    };
    if (o) Object.assign(g, nbaOdds(o));
    if (state !== "pre") g.score = { home: Number(h.score) || 0, away: Number(a.score) || 0 };
    out.push(g);
  }
  return out.sort((x, y) => x.tip.localeCompare(y.tip));
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const fold = (s: string) =>
  decode(s)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/**
 * Every way a team's name is likely to be written (full name, city, nickname,
 * abbreviation), folded, mapped to ESPN's abbreviation. Built from the slate
 * itself, so there is no NBA team table to keep up.
 */
export function nbaNameIndex(games: NbaGame[]): Map<string, string> {
  const idx = new Map<string, string>();
  for (const g of games) {
    for (const t of [g.home, g.away]) {
      const full = fold(t.name);
      const words = full.split(" ");
      for (const k of [full, fold(t.short), fold(t.abbr), words[words.length - 1], full.replace(/^los angeles /, "la ")]) {
        if (k) idx.set(k, t.abbr);
      }
    }
  }
  return idx;
}

/** A "<team> <number>" line read from the home side, or NaN. */
function homeLine(text: string, home: string, key: (s: string) => string): number {
  const t = decode(text).trim();
  if (/^(pk|even|pick)$/i.test(t)) return 0;
  const m = t.match(/^(.*?)\s+([+\-−]?[\d.]+|PK|EVEN)$/i);
  if (!m) return NaN;
  const v = /^(pk|even)$/i.test(m[2]) ? 0 : Number(m[2].replace("−", "-"));
  return key(m[1]) === home ? v : -v;
}

/**
 * Sam's NBA page. "Coming soon" is the placeholder; otherwise it is read as
 * his NFL/college board template (one <article class="game"> per game, names
 * away then home, "Vegas line" and "Model line" rows). Names are keyed to
 * ESPN's abbreviations through `index`; a name that doesn't match stays as
 * written and simply won't join a game.
 */
export function parseSamNba(html: string, index: Map<string, string>): SamNbaStatus {
  const text = decode(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ");
  const arts = html.split(/<article class="game"/).slice(1);
  if (!arts.length && /coming soon/i.test(text)) {
    const note = text.match(/(Projections[^.]*?coming[^.←]*?)(?:\s←|\.|$)/i)?.[1]?.trim() ?? "Coming soon";
    return { state: "soon", note };
  }
  const key = (s: string) => {
    const f = fold(s);
    return index.get(f) ?? index.get(f.split(" ").pop() ?? "") ?? f;
  };
  const rows: SamNbaRow[] = [];
  for (const art of arts) {
    const names = [...art.matchAll(/class="nm">([^<]+)</g)].map((m) => m[1]);
    const pts = [...art.matchAll(/class="pts">([\d.]+)</g)].map((m) => Number(m[1]));
    const vegas = art.match(/Vegas line<\/span><span class="val[^"]*">([^<]+)</)?.[1];
    const model = art.match(/Model line<\/span><span class="val[^"]*">([^<]+)</)?.[1];
    if (names.length < 2 || !model) continue;
    const away = key(names[0]);
    const home = key(names[1]);
    const m = homeLine(model, home, key);
    const v = vegas ? homeLine(vegas, home, key) : NaN;
    if (isNaN(m)) continue;
    rows.push({ home, away, model: m, vegas: v, ...(pts.length === 2 ? { total: Math.round((pts[0] + pts[1]) * 10) / 10 } : {}) });
  }
  return rows.length ? { state: "live", rows } : { state: "unread" };
}

export type NbaRead = {
  /** Sam's home line, rounded to a tenth. */
  model: number;
  /** Points between Sam's line and DraftKings', on the side he likes. */
  edge: number;
  side: "home" | "away";
  modelTotal?: number;
  totalSide?: "over" | "under";
  totalEdge?: number;
};

/** Sam's side and edge at the DraftKings line. Null with no line or no model. */
export function readNba(g: NbaGame, sam?: SamNbaRow): NbaRead | null {
  if (!sam || !g.line) return null;
  const diff = g.line.home - sam.model; // > 0: Sam likes the home team more than the book does
  const r: NbaRead = { model: Math.round(sam.model * 10) / 10, edge: Math.round(Math.abs(diff) * 10) / 10, side: diff >= 0 ? "home" : "away" };
  if (sam.total !== undefined && g.total) {
    const t = sam.total - g.total.points;
    r.modelTotal = sam.total;
    r.totalSide = t >= 0 ? "over" : "under";
    r.totalEdge = Math.round(Math.abs(t) * 10) / 10;
  }
  return r;
}
