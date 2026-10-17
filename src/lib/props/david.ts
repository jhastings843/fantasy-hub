// David Sasser's player prop board (davidsasser.com/nfl/props). His own
// projection for six markets (passing yards and attempts, rushing yards and
// attempts, receiving yards, receptions) set against DraftKings' total and
// prices, with an 80% range from his model's past errors. Current week only,
// and a game drops off once it kicks off, so the tracker keeps its own
// pregame copy, the same way it keeps Sam's.
//
// David stands level with Sam, the way the Picks tab treats them:
// - His board is graded as he lays it out: the side his number points to at
//   DraftKings' total and price, 1 unit each.
// - Head to head: on every prop both cover (same game, player and stat), each
//   model's side is graded at the SAME DraftKings total and price, so the two
//   records compare like for like, with agree and split cuts as on Picks.
// - On Sam's own markets his number is also kept per market, beside Rotowire
//   and ESPN, and graded at Sam's shown line.
//
// The page is a server-rendered React app; the whole slate rides in its RSC
// payload as one JSON object ({"slate": {...}}), so no scraping of markup.

import { implied, payout, type PropMarket, type PropsGame, type Side, type Stat } from "./parse";
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

// Records: David's board, and Sam against David on the props both cover.

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

/** A saved game with the week it belongs to. */
export type DavidWeekGame = DavidGame & { week: number };

/** Sam's projection keyed "gameId|name|team|davidMarket", to line up with David's props. */
export type SamIndex = Map<string, number>;
const samKey = (gameId: string, player: string, team: string, market: DavidMarket) => `${gameId}|${nameKey(player)}|${team}|${market}`;

/** Index Sam's saved games (late copies left out: they were read after kickoff). */
export function samIndex(games: { game: PropsGame; late?: string }[]): SamIndex {
  const out: SamIndex = new Map();
  for (const x of games) {
    if (x.late) continue;
    for (const m of x.game.markets) if (m.stat) out.set(samKey(x.game.slug, m.player, m.team, FROM_SAM[m.stat]), m.model);
  }
  return out;
}
export const samOn = (sam: SamIndex, p: DavidProp) => sam.get(samKey(p.gameId, p.player, p.team, p.market));

/** A model's side from DraftKings' total. */
const sideAt = (x: number | undefined, line: number): Side | null => (x === undefined ? null : x > line ? "over" : x < line ? "under" : null);

export interface DBet {
  side: Side;
  outcome: Outcome;
  net: number;
  breakEven: number;
}

/** A side at a prop's DraftKings total and price. */
function dkBet(p: DavidProp, side: Side | null, actual: number): DBet | null {
  const price = side === "over" ? p.over : side === "under" ? p.under : null;
  if (!side || price === null) return null;
  const outcome = settle(side, p.line, actual);
  return { side, outcome, net: outcome === "W" ? Math.round(payout(price) * 1000) / 1000 : outcome === "L" ? -1 : 0, breakEven: Math.round(implied(price) * 1000) / 1000 };
}

interface DRow {
  week: number;
  p: DavidProp;
  actual: number;
  first?: number;
  david: DBet | null;
  sam: DBet | null;
  samProj?: number;
}

const reachD = (p: DavidProp) => Math.abs(p.projection - p.line) / Math.max(p.line, 1);
const agree = (r: DRow) => !!r.david && !!r.sam && r.david.side === r.sam.side;
const split = (r: DRow) => !!r.david && !!r.sam && r.david.side !== r.sam.side;

/** Slice id, label, and the bet a row contributes (null: not in the slice). Ids are stable: the system keeps them. */
export const DAVID_SLICES: [string, string, (r: DRow) => DBet | null][] = [
  ["dboard:all", "Every prop on David's board", (r) => r.david],
  ...DAVID_MARKETS.map((m): [string, string, (r: DRow) => DBet | null] => [`dboard:${m}`, `David: ${DAVID_LABEL[m].toLowerCase()}`, (r) => (r.p.market === m ? r.david : null)]),
  ["dboard:over", "David on the over", (r) => (r.david?.side === "over" ? r.david : null)],
  ["dboard:under", "David on the under", (r) => (r.david?.side === "under" ? r.david : null)],
  ["dboard:near", "David within 10% of the total", (r) => (reachD(r.p) < 0.1 ? r.david : null)],
  ["dboard:mid", "David 10% to 25% off the total", (r) => (reachD(r.p) >= 0.1 && reachD(r.p) < 0.25 ? r.david : null)],
  ["dboard:far", "David 25%+ off the total", (r) => (reachD(r.p) >= 0.25 ? r.david : null)],
  ["h2h:sam", "Sam's side, every shared prop", (r) => (r.david ? r.sam : null)],
  ["h2h:david", "David's side, every shared prop", (r) => (r.sam ? r.david : null)],
  ["h2h:agree", "Both agree", (r) => (agree(r) ? r.david : null)],
  ["h2h:agree-over", "Both agree on the over", (r) => (agree(r) && r.david!.side === "over" ? r.david : null)],
  ["h2h:agree-under", "Both agree on the under", (r) => (agree(r) && r.david!.side === "under" ? r.david : null)],
  ["h2h:split-sam", "Split: Sam's side", (r) => (split(r) ? r.sam : null)],
  ["h2h:split-david", "Split: David's side", (r) => (split(r) ? r.david : null)],
];

export interface DavidSlice {
  id: string;
  group: "dboard" | "h2h";
  label: string;
  n: number;
  w: number;
  l: number;
  p: number;
  units: number;
  needed: number;
  z: number | null;
  /** Mean DraftKings move toward the side, first copy to last, in stat units. */
  move: number | null;
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

/** Shared props: each model's average miss against DraftKings' total. */
export interface H2hAccuracy {
  market: DavidMarket;
  n: number;
  sam: number;
  david: number;
  line: number;
  /** How often Sam's number was closer than David's. */
  samCloser: number;
}

export interface DavidTrends {
  games: number;
  props: number;
  shared: number;
  slices: DavidSlice[];
  accuracy: DavidAccuracy[];
  h2h: H2hAccuracy[];
}

function rowsOf(games: DavidWeekGame[], sam: SamIndex): DRow[] {
  const rows: DRow[] = [];
  for (const x of games) {
    if (!x.result) continue;
    const byId = new Map(x.result.map((g) => [g.id, g]));
    for (const p of x.props) {
      const g = byId.get(p.id);
      if (!g || g.actual === null) continue;
      const samProj = samOn(sam, p);
      rows.push({ week: x.week, p, actual: g.actual, first: x.first[p.id], david: dkBet(p, davidSide(p), g.actual), sam: dkBet(p, sideAt(samProj, p.line), g.actual), samProj });
    }
  }
  return rows;
}

const verdictOf = (n: number, z: number | null, units: number): Verdict =>
  n < MIN_BETS ? "early" : z !== null && z >= 1.96 && units > 0 ? "profitable" : z !== null && z <= -1.96 ? "losing" : z !== null && z >= 1 ? "lean-up" : z !== null && z <= -1 ? "lean-down" : "flat";

export function davidTrends(games: DavidWeekGame[], sam: SamIndex): DavidTrends {
  const rows = rowsOf(games, sam);
  const slices: DavidSlice[] = DAVID_SLICES.map(([id, label, pick]) => {
    const bs = rows.flatMap((r) => {
      const b = pick(r);
      return b ? [{ r, b }] : [];
    });
    const decided = bs.filter((x) => x.b.outcome !== "P");
    const w = decided.filter((x) => x.b.outcome === "W").length;
    const needed = decided.reduce((a, x) => a + x.b.breakEven, 0);
    const variance = decided.reduce((a, x) => a + x.b.breakEven * (1 - x.b.breakEven), 0);
    const z = variance > 0 ? (w - needed) / Math.sqrt(variance) : null;
    const units = bs.reduce((a, x) => a + x.b.net, 0);
    const moved = bs.filter((x) => x.r.first !== undefined);
    const move = moved.length ? moved.reduce((a, x) => a + (x.b.side === "over" ? x.r.p.line - x.r.first! : x.r.first! - x.r.p.line), 0) / moved.length : null;
    return {
      id,
      group: id.startsWith("h2h:") ? "h2h" : "dboard",
      label,
      n: decided.length,
      w,
      l: decided.length - w,
      p: bs.length - decided.length,
      units: Math.round(units * 100) / 100,
      needed: Math.round(needed * 10) / 10,
      z: z === null ? null : Math.round(z * 100) / 100,
      move: move === null ? null : Math.round(move * 100) / 100,
      verdict: verdictOf(decided.length, z, units),
    };
  });

  const r1 = (x: number, n: number) => Math.round((x / n) * 10) / 10;
  const accuracy: DavidAccuracy[] = DAVID_MARKETS.flatMap((market) => {
    const rs = rows.filter((r) => r.p.market === market);
    if (!rs.length) return [];
    const ranged = rs.filter((r) => r.p.lower !== null && r.p.upper !== null);
    return [
      {
        market,
        n: rs.length,
        model: r1(rs.reduce((a, r) => a + Math.abs(r.actual - r.p.projection), 0), rs.length),
        line: r1(rs.reduce((a, r) => a + Math.abs(r.actual - r.p.line), 0), rs.length),
        closer: rs.filter((r) => Math.abs(r.actual - r.p.projection) < Math.abs(r.actual - r.p.line)).length,
        inRange: ranged.length ? Math.round((ranged.filter((r) => r.actual >= r.p.lower! && r.actual <= r.p.upper!).length / ranged.length) * 100) / 100 : null,
      },
    ];
  });
  const h2h: H2hAccuracy[] = DAVID_MARKETS.flatMap((market) => {
    const rs = rows.filter((r) => r.p.market === market && r.samProj !== undefined);
    if (!rs.length) return [];
    return [
      {
        market,
        n: rs.length,
        sam: r1(rs.reduce((a, r) => a + Math.abs(r.actual - r.samProj!), 0), rs.length),
        david: r1(rs.reduce((a, r) => a + Math.abs(r.actual - r.p.projection), 0), rs.length),
        line: r1(rs.reduce((a, r) => a + Math.abs(r.actual - r.p.line), 0), rs.length),
        samCloser: rs.filter((r) => Math.abs(r.actual - r.samProj!) < Math.abs(r.actual - r.p.projection)).length,
      },
    ];
  });
  return { games: games.filter((g) => g.result).length, props: rows.length, shared: rows.filter((r) => r.samProj !== undefined).length, slices, accuracy, h2h };
}

/** A slice's bets with their weeks, for the system's out-of-sample record. */
export function davidSliceBets(games: DavidWeekGame[], sam: SamIndex, id: string): { week: number; bet: DBet }[] {
  const pick = DAVID_SLICES.find((x) => x[0] === id)?.[2];
  if (!pick) return [];
  return rowsOf(games, sam).flatMap((r) => {
    const b = pick(r);
    return b ? [{ week: r.week, bet: b }] : [];
  });
}

/** Does an unsettled prop fall in a slice (for marking this week's system bets)? Returns the side it would bet. */
export function davidSliceSide(id: string, p: DavidProp, samProj: number | undefined): Side | null {
  const pick = DAVID_SLICES.find((x) => x[0] === id)?.[2];
  if (!pick) return null;
  const fake = (side: Side | null): DBet | null => (side ? { side, outcome: "P", net: 0, breakEven: 0 } : null);
  return pick({ week: 0, p, actual: 0, david: fake(davidSide(p)), sam: fake(sideAt(samProj, p.line)), samProj })?.side ?? null;
}
