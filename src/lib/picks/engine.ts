// The backtest, from joined games to a ranked list of strategies and a board.
//
// Pure. Two models' records come in, one report comes out, and nothing here
// knows whether the rows came off a live page or a fixture. The NFL and
// college tabs run the same code with different inputs.
//
// The conventions, once:
//   Lines are home-side, betting style: -3.5 means the home team gives 3.5.
//   A model "takes the home team" when its line is below the market's.
//   A shared pick is graded at the WORSE of the two sites' market numbers,
//   because a bettor gets one line, and assuming the better one flatters
//   every result.

import type { GradedRow, ModelLine } from "./parse";

/** Break-even at -110. */
export const BREAK_EVEN = 0.5238;

/** A cut needs this many graded games before it can be the rule. */
export const MIN_SAMPLE = 10;

export type Result = "W" | "L" | "P";

/** One game, both models' views of it, and what happened if it is over. */
export interface Game {
  week: number;
  home: string;
  away: string;
  sam?: ModelLine;
  david?: ModelLine;
  final?: { home: number; away: number };
}

/** What both models together say about a game. */
export interface Read {
  agree: boolean;
  /** Present only when both models are on the same side. */
  side?: "home" | "away";
  /** The worse of the two market numbers, from the picked team's side. */
  line?: number;
  dog?: boolean;
  /** |average model line - average market line|. */
  avgEdge: number;
  /** The smaller of the two models' own edges. */
  minEdge: number;
  /** The larger of the two. */
  maxEdge: number;
  /** How far apart the two model lines are. */
  modelGap: number;
  /** Both models make the market underdog the outright winner. */
  flip: boolean;
  /** Each model's side, for splits. */
  samSide: "home" | "away";
  davidSide: "home" | "away";
  /** Average of the two model lines, home side. Negative: home team projected to win. */
  avgModel: number;
  avgMarket: number;
}

export function read(sam: ModelLine, david: ModelLine): Read {
  const samSide = sam.model < sam.market ? "home" : "away";
  const davidSide = david.model < david.market ? "home" : "away";
  // A model sitting exactly on the number has no side; treat it as a split.
  const agree = samSide === davidSide && sam.model !== sam.market && david.model !== david.market;
  const avgModel = (sam.model + david.model) / 2;
  const avgMarket = (sam.market + david.market) / 2;
  const base = {
    agree,
    avgEdge: Math.abs(avgModel - avgMarket),
    minEdge: Math.min(Math.abs(sam.model - sam.market), Math.abs(david.model - david.market)),
    maxEdge: Math.max(Math.abs(sam.model - sam.market), Math.abs(david.model - david.market)),
    modelGap: Math.abs(sam.model - david.model),
    flip: avgMarket !== 0 && sam.model * avgMarket < 0 && david.model * avgMarket < 0,
    samSide,
    davidSide,
    avgModel,
    avgMarket,
  } as const;
  if (!agree) return { ...base };
  const home = samSide === "home";
  // Home bettor wants the larger home number, road bettor the smaller.
  const worst = home ? Math.min(sam.market, david.market) : Math.max(sam.market, david.market);
  const line = home ? worst : -worst;
  return { ...base, side: samSide, line, dog: line > 0 };
}

/** ATS result of backing one side at a home-side line. */
export function grade(final: { home: number; away: number }, homeLine: number, side: "home" | "away"): Result {
  const v = final.home - final.away + homeLine;
  const s = side === "home" ? v : -v;
  return s > 0 ? "W" : s < 0 ? "L" : "P";
}

// ----------------------------------------------------------------- strategies

/**
 * A strategy as data rather than a function, so the page's checker can run
 * the same test in the browser that the server ran on the record.
 */
export interface CutTest {
  side?: "dog" | "fav";
  venue?: "home" | "road";
  minAvgEdge?: number;
  maxAvgEdge?: number;
  minBothEdge?: number;
  /** Each model within this many points of its Vegas line. */
  maxEachEdge?: number;
  maxModelGap?: number;
  minModelGap?: number;
  /** Line from the picked team's side. */
  minLine?: number;
  minAbsLine?: number;
  maxAbsLine?: number;
  flip?: boolean;
}

export interface Cut {
  id: string;
  label: string;
  group: string;
  test: CutTest;
  /** Eligible to become the rule. Baselines and slices by week are not. */
  candidate: boolean;
}

export function matches(r: Read, t: CutTest): boolean {
  if (!r.agree || r.line === undefined) return false;
  if (t.side === "dog" && !r.dog) return false;
  if (t.side === "fav" && r.dog) return false;
  if (t.venue === "home" && r.side !== "home") return false;
  if (t.venue === "road" && r.side !== "away") return false;
  if (t.minAvgEdge !== undefined && r.avgEdge < t.minAvgEdge) return false;
  if (t.maxAvgEdge !== undefined && r.avgEdge >= t.maxAvgEdge) return false;
  if (t.minBothEdge !== undefined && r.minEdge < t.minBothEdge) return false;
  if (t.maxEachEdge !== undefined && r.maxEdge > t.maxEachEdge) return false;
  if (t.maxModelGap !== undefined && r.modelGap > t.maxModelGap) return false;
  if (t.minModelGap !== undefined && r.modelGap <= t.minModelGap) return false;
  if (t.minLine !== undefined && r.line < t.minLine) return false;
  if (t.minAbsLine !== undefined && Math.abs(r.line) < t.minAbsLine) return false;
  if (t.maxAbsLine !== undefined && Math.abs(r.line) >= t.maxAbsLine) return false;
  if (t.flip !== undefined && r.flip !== t.flip) return false;
  return true;
}

const c = (id: string, label: string, group: string, test: CutTest, candidate = true): Cut => ({
  id,
  label,
  group,
  test,
  candidate,
});

/**
 * The cuts tested every week. College lines run far larger than NFL lines, so
 * the size thresholds are set per league; everything else is shared.
 */
export function cutsFor(league: "nfl" | "cfb"): Cut[] {
  const big = league === "nfl" ? 6.5 : 14;
  const small = league === "nfl" ? 3.5 : 7;
  const e = league === "nfl" ? [2, 3, 4] : [3, 5, 5];
  return [
    c("agree", "Both agree, any edge", "Agreement", {}),
    c("dog", "Agree on underdog", "Side", { side: "dog" }),
    c("fav", "Agree on favorite", "Side", { side: "fav" }),
    c("home", "Agree on home team", "Side", { venue: "home" }),
    c("road", "Agree on road team", "Side", { venue: "road" }),
    c("road-dog", "Agree on road dog", "Side", { side: "dog", venue: "road" }),
    c("home-dog", "Agree on home dog", "Side", { side: "dog", venue: "home" }),
    c(`dog-e${e[0]}`, `Agree on dog, avg edge ${e[0]}+`, "Edge size", { side: "dog", minAvgEdge: e[0] }),
    c(`dog-lt${e[0]}`, `Agree on dog, avg edge under ${e[0]}`, "Edge size", { side: "dog", maxAvgEdge: e[0] }),
    c(`e${e[1]}`, `Agree, avg edge ${e[1]}+ (any side)`, "Edge size", { minAvgEdge: e[1] }),
    c(`both-e${e[2]}`, `Agree, both edges ${e[2]}+`, "Edge size", { minBothEdge: e[2] }),
    c(`fav-e${e[0]}`, `Agree on favorite, avg edge ${e[0]}+`, "Edge size", { side: "fav", minAvgEdge: e[0] }),
    c("near-vegas", "Agree + both lines within 4 of Vegas", "Vegas distance", { maxEachEdge: 4 }),
    c("gap3", "Agree + model lines within 3 of each other", "Model vs model", { maxModelGap: 3 }),
    c("gap3plus", "Agree + model lines 3+ apart", "Model vs model", { minModelGap: 3 }),
    c(`dog-${big}`, `Agree on dog getting +${big} or more`, "Line size", { side: "dog", minLine: big }),
    c(`any-${big}`, `Agree, line ${big}+ either side`, "Line size", { minAbsLine: big }),
    c(`under-${small}`, `Agree, line under ${small} either side`, "Line size", { maxAbsLine: small }),
    c("flip", "Both models pick the dog to win outright", "Line size", { flip: true }),
  ];
}

// ------------------------------------------------------------------- records

export interface Record {
  w: number;
  l: number;
  p: number;
  /** Win rate over decided games, 0 to 1. */
  pct: number;
  /** Units at -110, risking 1.1 to win 1. */
  units: number;
  /** 90% Wilson interval on the win rate. */
  lo: number;
  hi: number;
}

export function tally(results: Result[]): Record {
  const w = results.filter((r) => r === "W").length;
  const l = results.filter((r) => r === "L").length;
  const p = results.filter((r) => r === "P").length;
  const n = w + l;
  const pct = n ? w / n : 0;
  const z = 1.645;
  let lo = 0;
  let hi = 0;
  if (n) {
    const centre = (pct + (z * z) / (2 * n)) / (1 + (z * z) / n);
    const half = (z * Math.sqrt((pct * (1 - pct)) / n + (z * z) / (4 * n * n))) / (1 + (z * z) / n);
    lo = centre - half;
    hi = centre + half;
  }
  return { w, l, p, pct, units: w - 1.1 * l, lo, hi };
}

export interface GradedGame extends Game {
  final: { home: number; away: number };
  sam: ModelLine;
  david: ModelLine;
  read: Read;
  /** The shared pick's result at the worse line, when they agree. */
  result?: Result;
  samResult: Result;
  davidResult: Result;
}

export function gradeGame(g: Game & { final: { home: number; away: number }; sam: ModelLine; david: ModelLine }): GradedGame {
  const r = read(g.sam, g.david);
  const samSide = g.sam.model < g.sam.market ? "home" : "away";
  const davidSide = g.david.model < g.david.market ? "home" : "away";
  return {
    ...g,
    read: r,
    // Back to the home side: a home pick's line is already home-side.
    result:
      r.agree && r.side && r.line !== undefined
        ? grade(g.final, r.side === "home" ? r.line : -r.line, r.side)
        : undefined,
    samResult: grade(g.final, g.sam.market, samSide),
    davidResult: grade(g.final, g.david.market, davidSide),
  };
}

export interface CutResult extends Cut {
  record: Record;
  games: number;
}

export interface StrategyBoard {
  cuts: CutResult[];
  baselines: { id: string; label: string; record: Record }[];
  splits: { sam: Record; david: Record };
  byWeek: { week: number; record: Record }[];
  /** The cut in force, chosen by the low end of its 90% range. */
  rule: CutResult | null;
  /** The next best cut that adds games the rule does not. */
  second: CutResult | null;
}

/** Ranking: the low end of the likely range, then sample size. */
function rank(a: CutResult, b: CutResult): number {
  return b.record.lo - a.record.lo || b.games - a.games;
}

export function strategies(league: "nfl" | "cfb", games: GradedGame[]): StrategyBoard {
  const agreed = games.filter((g) => g.read.agree && g.result);
  const cuts: CutResult[] = cutsFor(league).map((cut) => {
    const hits = agreed.filter((g) => matches(g.read, cut.test));
    return { ...cut, record: tally(hits.map((g) => g.result as Result)), games: hits.length };
  });

  const dogResults = games
    .filter((g) => g.sam.market !== 0)
    .map((g) => grade(g.final, g.sam.market, g.sam.market > 0 ? "home" : "away"));
  const baselines = [
    { id: "sam", label: "Sam alone, all games", record: tally(games.map((g) => g.samResult)) },
    { id: "david", label: "David alone, all games", record: tally(games.map((g) => g.davidResult)) },
    { id: "dogs", label: "Every underdog, no model", record: tally(dogResults) },
  ];

  const split = games.filter((g) => !g.read.agree);
  const weeks = [...new Set(agreed.map((g) => g.week))].sort((a, b) => a - b);

  const eligible = cuts.filter((x) => x.candidate && x.games >= MIN_SAMPLE && x.record.pct > BREAK_EVEN).sort(rank);
  const rule = eligible[0] ?? null;
  let second: CutResult | null = null;
  if (rule) {
    const inRule = new Set(agreed.filter((g) => matches(g.read, rule.test)).map(key));
    second =
      eligible.slice(1).find((x) => agreed.some((g) => matches(g.read, x.test) && !inRule.has(key(g)))) ?? null;
  }

  return {
    cuts,
    baselines,
    splits: { sam: tally(split.map((g) => g.samResult)), david: tally(split.map((g) => g.davidResult)) },
    byWeek: weeks.map((week) => ({
      week,
      record: tally(agreed.filter((g) => g.week === week).map((g) => g.result as Result)),
    })),
    rule,
    second,
  };
}

export const key = (g: { week: number; home: string; away: string }) => `${g.week}:${g.away}@${g.home}`;

// --------------------------------------------------------------------- board

export type Tier = "t1" | "t2" | "fav" | "pass" | "split" | "one";

export interface BoardGame {
  home: string;
  away: string;
  sam?: ModelLine;
  david?: ModelLine;
  read?: Read;
  tier: Tier;
  /** "TB +8.5", or each model's side on a split. */
  play: string;
  /** Straight-up call. */
  su?: StraightUp;
}

const fmt = (x: number) => (x === 0 ? "PK" : `${x > 0 ? "+" : ""}${x}`);

export function tierBoard(
  league: "nfl" | "cfb",
  rows: { home: string; away: string; sam?: ModelLine; david?: ModelLine }[],
  s: StrategyBoard,
): BoardGame[] {
  return rows.map((row) => {
    const su = straightUp(row.sam, row.david, league);
    if (!row.sam || !row.david) {
      const only = row.sam ? "Sam" : "David";
      const m = (row.sam ?? row.david) as ModelLine;
      const side = m.model < m.market ? row.home : row.away;
      return { ...row, tier: "one", play: `${only} only: ${side}`, su };
    }
    const r = read(row.sam, row.david);
    if (!r.agree || !r.side || r.line === undefined) {
      const team = (side: "home" | "away") => (side === "home" ? row.home : row.away);
      return { ...row, read: r, tier: "split", play: `Sam: ${team(r.samSide)} · David: ${team(r.davidSide)}`, su };
    }
    const team = r.side === "home" ? row.home : row.away;
    const play = `${team} ${fmt(r.line)}`;
    let tier: Tier = r.dog ? "pass" : "fav";
    if (s.rule && matches(r, s.rule.test)) tier = "t1";
    else if (s.second && matches(r, s.second.test)) tier = "t2";
    return { ...row, read: r, tier, play, su };
  });
}

// --------------------------------------------------------------- straight up

export type Confidence = "lock" | "solid" | "toss";

export interface StraightUp {
  /** "home" or "away", by the average of whatever models are present. */
  side: "home" | "away";
  /** Projected margin of the picked team. */
  margin: number;
  confidence: Confidence;
  /** Both models name the same winner. */
  agree: boolean;
  /** The pick is the Vegas underdog. */
  upset: boolean;
}

/** Confidence bands, in points of average projected margin. */
export const SU_BANDS = { nfl: { lock: 6, solid: 3 }, cfb: { lock: 14, solid: 7 } } as const;

export function straightUp(sam?: ModelLine, david?: ModelLine, league: "nfl" | "cfb" = "nfl"): StraightUp | undefined {
  const ms = [sam, david].filter((m): m is ModelLine => !!m);
  if (!ms.length) return undefined;
  const avg = ms.reduce((t, m) => t + m.model, 0) / ms.length;
  const mkt = ms.reduce((t, m) => t + m.market, 0) / ms.length;
  const side = avg < 0 ? "home" : avg > 0 ? "away" : mkt <= 0 ? "home" : "away";
  const margin = Math.abs(avg);
  const b = SU_BANDS[league];
  const confidence: Confidence = margin >= b.lock ? "lock" : margin >= b.solid ? "solid" : "toss";
  const agree = ms.length === 2 && Math.sign(ms[0].model) === Math.sign(ms[1].model) && ms[0].model !== 0;
  const favHome = mkt < 0;
  const upset = mkt !== 0 && (side === "home") !== favHome;
  return { side, margin, confidence, agree, upset };
}

export interface SuRecord {
  id: string;
  label: string;
  w: number;
  l: number;
  pct: number;
}

/** Straight-up accuracy of each way of picking a winner, plus the confidence bands. */
export function suRecords(league: "nfl" | "cfb", games: GradedGame[]): { methods: SuRecord[]; bands: SuRecord[]; best: SuRecord | null } {
  const decided = games.filter((g) => g.final.home !== g.final.away);
  const homeWon = (g: GradedGame) => g.final.home > g.final.away;
  const rec = (id: string, label: string, pick: (g: GradedGame) => "home" | "away" | null, pool = decided): SuRecord => {
    let w = 0;
    let l = 0;
    for (const g of pool) {
      const p = pick(g);
      if (!p) continue;
      if ((p === "home") === homeWon(g)) w++;
      else l++;
    }
    return { id, label, w, l, pct: w + l ? w / (w + l) : 0 };
  };
  const by = (x: number): "home" | "away" | null => (x < 0 ? "home" : x > 0 ? "away" : null);
  const methods = [
    rec("avg", "Average of both models", (g) => by((g.sam.model + g.david.model) / 2)),
    rec("sam", "Sam's projected winner", (g) => by(g.sam.model)),
    rec("david", "David's projected winner", (g) => by(g.david.model)),
    rec("vegas", "Vegas favorite", (g) => by((g.sam.market + g.david.market) / 2)),
    rec("both", "Only when both models agree", (g) =>
      Math.sign(g.sam.model) === Math.sign(g.david.model) ? by(g.sam.model) : null,
    ),
    rec("upset", "Both models pick the Vegas dog", (g) => {
      const mkt = (g.sam.market + g.david.market) / 2;
      const s = Math.sign(g.sam.model);
      return s === Math.sign(g.david.model) && s !== 0 && mkt !== 0 && s !== Math.sign(mkt) ? by(g.sam.model) : null;
    }),
  ];
  const b = SU_BANDS[league];
  const avgOf = (g: GradedGame) => Math.abs((g.sam.model + g.david.model) / 2);
  const pickAvg = (g: GradedGame) => by((g.sam.model + g.david.model) / 2);
  const bands = [
    rec("lock", `Lock: ${b.lock}+ point projected margin`, (g) => (avgOf(g) >= b.lock ? pickAvg(g) : null)),
    rec("solid", `Solid: ${b.solid} to ${b.lock}`, (g) => (avgOf(g) >= b.solid && avgOf(g) < b.lock ? pickAvg(g) : null)),
    rec("toss", `Toss-up: under ${b.solid}`, (g) => (avgOf(g) < b.solid ? pickAvg(g) : null)),
  ];
  // Methods that pick every game compete for "best"; partial ones are context.
  const full = methods.filter((m) => ["avg", "sam", "david", "vegas"].includes(m.id));
  const best = full.slice().sort((x, y) => y.pct - x.pct || (x.id === "avg" ? -1 : 1))[0] ?? null;
  return { methods, bands, best };
}

// ----------------------------------------------------------------------- join

export interface Joined {
  /** Finished games both models graded. */
  graded: GradedGame[];
  /** Finished games only one model graded, by which one. */
  onlySam: number;
  onlyDavid: number;
}

/**
 * Pairs the two records game by game.
 *
 * Keyed by week and both teams. Where the sites disagree on a final score
 * (it has happened: one listed a 24, the other a 21), Sam's is kept; the
 * difference is reported, and it only matters when it crosses a number.
 */
export function join(sam: GradedRow[], david: GradedRow[]): Joined & { scoreMismatches: string[] } {
  const d = new Map(david.map((r) => [key(r), r]));
  const graded: GradedGame[] = [];
  const scoreMismatches: string[] = [];
  let onlySam = 0;
  for (const s of sam) {
    const k = key(s);
    const o = d.get(k);
    if (!o) {
      onlySam++;
      continue;
    }
    d.delete(k);
    if (o.homePts !== s.homePts || o.awayPts !== s.awayPts) {
      scoreMismatches.push(`Week ${s.week} ${s.away} at ${s.home}: Sam ${s.awayPts}-${s.homePts}, David ${o.awayPts}-${o.homePts}`);
    }
    graded.push(
      gradeGame({
        week: s.week,
        home: s.home,
        away: s.away,
        sam: s.line,
        david: o.line,
        final: { home: s.homePts, away: s.awayPts },
      }),
    );
  }
  graded.sort((a, b) => a.week - b.week || a.home.localeCompare(b.home));
  return { graded, onlySam, onlyDavid: d.size, scoreMismatches };
}

/**
 * A straight-up pick by a named method, for the pick'em list.
 *
 * The page follows whichever method has the best straight-up record, so in a
 * league where the Vegas favorite is winning more often than the models, the
 * list is the favorites and the models only rank them.
 */
export function suPick(
  method: string,
  sam: ModelLine | undefined,
  david: ModelLine | undefined,
): { side: "home" | "away"; margin: number } | null {
  const ms = [sam, david].filter((m): m is ModelLine => !!m);
  if (!ms.length) return null;
  const avg = (f: (m: ModelLine) => number) => ms.reduce((t, m) => t + f(m), 0) / ms.length;
  let x: number;
  if (method === "vegas") x = avg((m) => m.market);
  else if (method === "sam" && sam) x = sam.model;
  else if (method === "david" && david) x = david.model;
  else x = avg((m) => m.model);
  if (x === 0) x = avg((m) => m.market) || avg((m) => m.model);
  return { side: x < 0 ? "home" : "away", margin: Math.abs(x) };
}
