// David Sasser's player prop board (davidsasser.com/nfl/props). His own
// projection for six markets (passing yards and attempts, rushing yards and
// attempts, receiving yards, receptions) set against DraftKings' total and
// prices, with an 80% range from his model's past errors. Current week only,
// and a game drops off once it kicks off, so the tracker keeps its own
// pregame copy, the same way it keeps Sam's.
//
// Two uses:
// - A third outside projection on Sam's markets (like Rotowire and ESPN),
//   matched by game, player and stat, graded at Sam's shown line.
// - His own board, graded as he lays it out: the side his number points to at
//   DraftKings' total and price, 1 unit each. Kept apart from Sam's record.
//
// The page is a server-rendered React app; the whole slate rides in its RSC
// payload as one JSON object ({"slate": {...}}), so no scraping of markup.

import { implied, payout, type PropMarket, type Side, type Stat } from "./parse";
import { nameKey, settle, type EspnBoxTeam, type Outcome } from "./grade";
import { MIN_BETS, type Verdict } from "./trends";

export const DAVID_URL = "https://davidsasser.com/nfl/props";

export type DavidMarket = "passing_yards" | "pass_attempts" | "rushing_yards" | "rush_attempts" | "receiving_yards" | "receptions";

export const DAVID_LABEL: { [m in DavidMarket]: string } = {
  passing_yards: "Passing yards",
  pass_attempts: "Pass attempts",
  rushing_yards: "Rushing yards",
  rush_attempts: "Rush attempts",
  receiving_yards: "Receiving yards",
  receptions: "Receptions",
};
export const DAVID_MARKETS = Object.keys(DAVID_LABEL) as DavidMarket[];

/** David's market for each of Sam's stats. */
const FROM_SAM: { [s in Stat]: DavidMarket } = { pass_yds: "passing_yards", rush_yds: "rushing_yards", rec_yds: "receiving_yards", rec: "receptions" };

export interface DavidProp {
  id: string;
  player: string;
  team: string;
  gameId: string; // "2026_06_DAL_GB", the same as Sam's slug
  kickoff: string;
  market: DavidMarket;
  projection: number;
  line: number;
  over: number | null;
  under: number | null;
  /** 80% range from his model's historical errors. */
  lower: number | null;
  upper: number | null;
}

export interface DavidSlate {
  season: number;
  week: number;
  /** His own "Model Updated" and "Totals Imported" labels. */
  updatedAt: string;
  importedAt: string;
  props: DavidProp[];
}

/** The JSON object starting at `from` (a "{"), by brace matching outside strings. */
function objectAt(s: string, from: number): string | null {
  let depth = 0;
  let inStr = false;
  for (let i = from; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (c === "\\") i++;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return s.slice(from, i + 1);
  }
  return null;
}

const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : null);

/** Read the slate out of the page's RSC payload. Null when it isn't there. */
export function parseDavidSlate(html: string): DavidSlate | null {
  // Each rsc.push("...") argument is a JSON string; join them and decode once.
  let rsc = "";
  for (const m of html.matchAll(/\.rsc\.push\(("(?:[^"\\]|\\.)*")\)/g)) {
    try {
      rsc += JSON.parse(m[1]) as string;
    } catch {
      /* not a string chunk */
    }
  }
  const at = rsc.indexOf('{"slate":');
  const raw = at >= 0 ? objectAt(rsc, at) : null;
  if (!raw) return null;
  const sl = (JSON.parse(raw) as { slate?: { season?: number; week?: number; updatedAt?: string; importedAt?: string; props?: Record<string, unknown>[] } }).slate;
  if (!sl?.season || !sl.week || !Array.isArray(sl.props)) return null;
  const props: DavidProp[] = [];
  for (const p of sl.props) {
    const market = p.market as DavidMarket;
    const projection = num(p.projection);
    const line = num(p.line);
    if (!DAVID_LABEL[market] || projection === null || line === null || p.lineType !== "over_under" || p.preliminary) continue;
    props.push({
      id: String(p.id),
      player: String(p.name ?? ""),
      team: String(p.team ?? ""),
      gameId: String(p.gameId ?? ""),
      kickoff: String(p.kickoff ?? ""),
      market,
      projection: Math.round(projection * 10) / 10,
      line,
      over: num(p.overOdds),
      under: num(p.underOdds),
      lower: num(p.lower) === null ? null : Math.max(0, Math.round(num(p.lower)! * 10) / 10),
      upper: num(p.upper) === null ? null : Math.round(num(p.upper)! * 10) / 10,
    });
  }
  return { season: sl.season, week: sl.week, updatedAt: String(sl.updatedAt ?? ""), importedAt: String(sl.importedAt ?? ""), props };
}

export async function fetchDavidSlate(): Promise<DavidSlate> {
  const res = await fetch(DAVID_URL, { cache: "no-store", headers: { "user-agent": "Mozilla/5.0 (fantasy-hub props tracker)" }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`David's props page answered ${res.status}`);
  const slate = parseDavidSlate(await res.text());
  if (!slate) throw new Error("David's props page did not read");
  return slate;
}

/** David's projection for each of a Sam game's markets he covers, by Sam's market id. */
export function davidFor(gameId: string, markets: PropMarket[], props: DavidProp[]): { [id: string]: number } {
  const idx = new Map(props.filter((p) => p.gameId === gameId).map((p) => [`${nameKey(p.player)}|${p.team}|${p.market}`, p.projection]));
  const out: { [id: string]: number } = {};
  for (const m of markets) {
    if (!m.stat) continue;
    const v = idx.get(`${nameKey(m.player)}|${m.team}|${FROM_SAM[m.stat]}`);
    if (v !== undefined) out[m.id] = v;
  }
  return out;
}

/** David's side: where his projection sits against DraftKings' total. Null on a tie. */
export const davidSide = (p: DavidProp): Side | null => (p.projection > p.line ? "over" : p.projection < p.line ? "under" : null);

/** Every player's line for David's six markets, from ESPN's box score. */
export function davidBox(players: EspnBoxTeam[]): Map<string, { [m in DavidMarket]: number }> {
  const out = new Map<string, { [m in DavidMarket]: number }>();
  const want: { [table: string]: [string, DavidMarket][] } = {
    passing: [
      ["passingYards", "passing_yards"],
      ["completions/passingAttempts", "pass_attempts"],
    ],
    rushing: [
      ["rushingYards", "rushing_yards"],
      ["rushingAttempts", "rush_attempts"],
    ],
    receiving: [
      ["receivingYards", "receiving_yards"],
      ["receptions", "receptions"],
    ],
  };
  for (const t of players) {
    for (const table of t.statistics ?? []) {
      const keys = table.keys ?? [];
      for (const a of table.athletes ?? []) {
        const name = a.athlete?.displayName;
        if (!name) continue;
        const k = nameKey(name);
        let r = out.get(k);
        if (!r) out.set(k, (r = { passing_yards: 0, pass_attempts: 0, rushing_yards: 0, rush_attempts: 0, receiving_yards: 0, receptions: 0 }));
        for (const [key, mk] of want[table.name ?? ""] ?? []) {
          const i = keys.indexOf(key);
          const cell = i >= 0 ? String(a.stats?.[i] ?? "") : "";
          // Attempts ride in "completions/attempts" ("27/51").
          const v = Number(key.includes("/") ? cell.split("/")[1] : cell);
          if (Number.isFinite(v)) r[mk] = v;
        }
      }
    }
  }
  return out;
}

export interface DavidGraded {
  id: string;
  /** Null: the player didn't play (void). */
  actual: number | null;
  side: Side | null;
  outcome: Outcome | null;
  net: number;
  breakEven: number | null;
  /** Did the result land inside his 80% range? */
  inRange: boolean | null;
}

/** Grade a game's props: his side at DraftKings' total and price, 1 unit. */
export function gradeDavid(props: DavidProp[], players: EspnBoxTeam[]): DavidGraded[] {
  const box = davidBox(players);
  return props.map((p) => {
    const r = box.get(nameKey(p.player));
    if (!r) return { id: p.id, actual: null, side: null, outcome: null, net: 0, breakEven: null, inRange: null };
    const actual = r[p.market];
    const side = davidSide(p);
    const price = side === "over" ? p.over : side === "under" ? p.under : null;
    const inRange = p.lower !== null && p.upper !== null ? actual >= p.lower && actual <= p.upper : null;
    if (!side || price === null) return { id: p.id, actual, side, outcome: null, net: 0, breakEven: null, inRange };
    const outcome = settle(side, p.line, actual);
    return {
      id: p.id,
      actual,
      side,
      outcome,
      net: outcome === "W" ? Math.round(payout(price) * 1000) / 1000 : outcome === "L" ? -1 : 0,
      breakEven: Math.round(implied(price) * 1000) / 1000,
      inRange,
    };
  });
}

// David's own board, graded week by week.

export interface DavidGame {
  gameId: string;
  kickoff: string;
  props: DavidProp[];
  capturedAt: string;
  firstSeenAt: string;
  /** DraftKings' total per prop at the first copy, for line movement. */
  first: { [id: string]: number };
  /** His "Model Updated" label on the saved copy. */
  updatedAt: string;
  result?: DavidGraded[];
  gradedAt?: string;
}

export interface DavidSlice {
  id: string;
  label: string;
  n: number;
  w: number;
  l: number;
  p: number;
  units: number;
  needed: number;
  z: number | null;
  /** Mean DraftKings move toward his side, first copy to last, in stat units. */
  move: number | null;
  /** Read on the same bar as Sam's slices. */
  verdict: Verdict;
}

export interface DavidAccuracy {
  market: DavidMarket;
  n: number;
  model: number;
  line: number;
  closer: number;
  /** Share of results inside his 80% range (well calibrated reads about 80%). */
  inRange: number | null;
}

export interface DavidTrends {
  games: number;
  props: number;
  slices: DavidSlice[];
  accuracy: DavidAccuracy[];
}

interface DRow {
  p: DavidProp;
  g: DavidGraded;
  first?: number;
}

const reachD = (p: DavidProp) => Math.abs(p.projection - p.line) / Math.max(p.line, 1);

export const DAVID_SLICES: [string, string, (r: DRow) => boolean][] = [
  ["all", "Every prop on his board", () => true],
  ...DAVID_MARKETS.map((m): [string, string, (r: DRow) => boolean] => [m, DAVID_LABEL[m], (r) => r.p.market === m]),
  ["over", "His number over the total", (r) => r.g.side === "over"],
  ["under", "His number under the total", (r) => r.g.side === "under"],
  ["near", "Within 10% of the total", (r) => reachD(r.p) < 0.1],
  ["mid", "10% to 25% off the total", (r) => reachD(r.p) >= 0.1 && reachD(r.p) < 0.25],
  ["far", "25%+ off the total", (r) => reachD(r.p) >= 0.25],
];

export function davidTrends(games: DavidGame[]): DavidTrends {
  const rows: DRow[] = [];
  const acc = new Map<DavidMarket, { n: number; model: number; line: number; closer: number; rN: number; r: number }>();
  let graded = 0;
  for (const x of games) {
    if (!x.result) continue;
    graded++;
    const byId = new Map(x.props.map((p) => [p.id, p]));
    for (const g of x.result) {
      const p = byId.get(g.id);
      if (!p || g.actual === null) continue;
      const a = acc.get(p.market) ?? { n: 0, model: 0, line: 0, closer: 0, rN: 0, r: 0 };
      const dm = Math.abs(g.actual - p.projection);
      const dl = Math.abs(g.actual - p.line);
      a.n++;
      a.model += dm;
      a.line += dl;
      if (dm < dl) a.closer++;
      if (g.inRange !== null) {
        a.rN++;
        if (g.inRange) a.r++;
      }
      acc.set(p.market, a);
      if (g.outcome) rows.push({ p, g, first: x.first[p.id] });
    }
  }
  const slices = DAVID_SLICES.map(([id, label, f]) => {
    const rs = rows.filter(f);
    const decided = rs.filter((r) => r.g.outcome !== "P");
    const w = decided.filter((r) => r.g.outcome === "W").length;
    const needed = decided.reduce((a, r) => a + (r.g.breakEven ?? 0), 0);
    const variance = decided.reduce((a, r) => a + (r.g.breakEven ?? 0) * (1 - (r.g.breakEven ?? 0)), 0);
    const z = variance > 0 ? (w - needed) / Math.sqrt(variance) : null;
    const units = rs.reduce((a, r) => a + r.g.net, 0);
    const verdict: Verdict =
      decided.length < MIN_BETS ? "early" : z !== null && z >= 1.96 && units > 0 ? "profitable" : z !== null && z <= -1.96 ? "losing" : z !== null && z >= 1 ? "lean-up" : z !== null && z <= -1 ? "lean-down" : "flat";
    const moved = rs.filter((r) => r.first !== undefined);
    const move = moved.length ? moved.reduce((a, r) => a + (r.g.side === "over" ? r.p.line - r.first! : r.first! - r.p.line), 0) / moved.length : null;
    return {
      id,
      label,
      n: decided.length,
      w,
      l: decided.length - w,
      p: rs.length - decided.length,
      units: Math.round(units * 100) / 100,
      needed: Math.round(needed * 10) / 10,
      z: z === null ? null : Math.round(z * 100) / 100,
      move: move === null ? null : Math.round(move * 100) / 100,
      verdict,
    };
  });
  const accuracy = DAVID_MARKETS.flatMap((market) => {
    const a = acc.get(market);
    if (!a?.n) return [];
    const r = (x: number) => Math.round((x / a.n) * 10) / 10;
    return [{ market, n: a.n, model: r(a.model), line: r(a.line), closer: a.closer, inRange: a.rN ? Math.round((a.r / a.rN) * 100) / 100 : null }];
  });
  return { games: graded, props: rows.length, slices, accuracy };
}
