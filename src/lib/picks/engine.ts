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
  /** Jay's PEM (college only): its home-side line and the market line on its card. */
  pem?: PemLine;
  final?: { home: number; away: number };
}

export interface PemLine {
  model: number;
  /** The line PEM's card graded against (DraftKings), home side. */
  market?: number;
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
  /** PEM's side against the average market line, when PEM covers the game. */
  pemSide?: "home" | "away";
}

export function read(sam: ModelLine, david: ModelLine, pem?: PemLine): Read {
  const samSide: "home" | "away" = sam.model < sam.market ? "home" : "away";
  const davidSide: "home" | "away" = david.model < david.market ? "home" : "away";
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
    pemSide: pem && pem.model !== avgMarket ? (pem.model < avgMarket ? ("home" as const) : ("away" as const)) : undefined,
  };
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
  /** Line from the picked team's side, exclusive upper bound. */
  maxLine?: number;
  minAbsLine?: number;
  maxAbsLine?: number;
  flip?: boolean;
  /** PEM on the same side as the other two, or against them. */
  pem?: "agree" | "disagree";
  /** Sam and David split; back whichever side PEM takes. */
  pemSplit?: boolean;
}

export interface Cut {
  id: string;
  label: string;
  group: string;
  test: CutTest;
  /** Eligible to become the rule. Baselines, slices by week and research cuts are not. */
  candidate: boolean;
  /** For a research refinement: the broader cut it narrows. */
  parent?: string;
}

/** The cut needs PEM's line to be decided at all. */
export function needsPem(t: CutTest): boolean {
  return !!t.pem || !!t.pemSplit;
}

export function matches(r: Read, t: CutTest): boolean {
  if (t.pemSplit) return !r.agree && !!r.pemSide;
  if (!r.agree || r.line === undefined) return false;
  if (t.pem === "agree" && (!r.pemSide || r.pemSide !== r.side)) return false;
  if (t.pem === "disagree" && (!r.pemSide || r.pemSide === r.side)) return false;
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
  if (t.maxLine !== undefined && r.line >= t.maxLine) return false;
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

/** A research refinement: shown with its parent, never eligible to become the rule. */
const research = (id: string, label: string, parent: string, test: CutTest): Cut => ({
  id,
  label,
  group: "Research",
  test,
  candidate: false,
  parent,
});

/**
 * The research refinements, with thresholds fixed in advance (2026-10-07,
 * before any of them was graded) rather than tuned to the record:
 *   Underdog bands split at the key margins: NFL 3 and 7 (a field goal, a
 *   touchdown), college 7 and 14 (one and two touchdowns; 14 is already the
 *   college rule's line).
 *   Edge size uses each league's existing smallest edge threshold (NFL 2,
 *   college 3), once on the average edge and once requiring BOTH models.
 *   Near-market agreement keeps the existing within-4 test and adds a
 *   one-point minimum on both models, the smallest whole-point step.
 *   College favorites laying 14+ are set against dogs getting 14+.
 */
export function researchCuts(league: "nfl" | "cfb"): Cut[] {
  const e = league === "nfl" ? 2 : 3;
  const bands =
    league === "nfl"
      ? [
          research("dog-band-a", "Dog getting 3 or less", "dog", { side: "dog", maxLine: 3.5 }),
          research("dog-band-b", "Dog getting 3.5 to 6.5", "dog", { side: "dog", minLine: 3.5, maxLine: 7 }),
          research("dog-band-c", "Dog getting 7 or more", "dog", { side: "dog", minLine: 7 }),
        ]
      : [
          research("dog-band-a", "Dog getting under 7", "dog", { side: "dog", maxLine: 7 }),
          research("dog-band-b", "Dog getting 7 to 13.5", "dog", { side: "dog", minLine: 7, maxLine: 14 }),
          research("dog-band-c", "Dog getting 14 or more", "dog", { side: "dog", minLine: 14 }),
        ];
  return [
    ...(league === "cfb"
      ? [
          research("big-fav", "Favorite laying 14 or more", "any-14", { side: "fav", minAbsLine: 14 }),
          research("big-dog", "Dog getting 14 or more", "any-14", { side: "dog", minAbsLine: 14 }),
        ]
      : []),
    ...bands,
    research(`avg-edge-${e}`, `Average edge ${e}+`, "agree", { minAvgEdge: e }),
    research(`both-edge-${e}`, `Both models ${e}+ off the line`, `avg-edge-${e}`, { minBothEdge: e }),
    research("near-min1", "Within 4 of Vegas, both at least 1 off", "near-vegas", { maxEachEdge: 4, minBothEdge: 1 }),
  ];
}

/**
 * The cuts tested every week. College lines run far larger than NFL lines, so
 * the size thresholds are set per league; everything else is shared.
 */
export function cutsFor(league: "nfl" | "cfb", withPem = false): Cut[] {
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
    ...(withPem
      ? [
          c("pem-agree", "All three agree (with PEM)", "PEM, third model", { pem: "agree" }),
          c("pem-agree-dog", "All three agree on the dog", "PEM, third model", { pem: "agree", side: "dog" }),
          c("pem-agree-fav", "All three agree on the favorite", "PEM, third model", { pem: "agree", side: "fav" }),
          c("pem-disagree", "Sam + David agree, PEM disagrees", "PEM, third model", { pem: "disagree" }),
          c("pem-split", "Sam and David split: PEM's side", "PEM, third model", { pemSplit: true }),
        ]
      : []),
    ...researchCuts(league),
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
  /** On a split, the result of whichever model PEM sided with. */
  pemSplitResult?: Result;
  /** PEM alone, at its card's line (or the average market line). */
  pemResult?: Result;
}

export function gradeGame(g: Game & { final: { home: number; away: number }; sam: ModelLine; david: ModelLine }): GradedGame {
  const r = read(g.sam, g.david, g.pem);
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
    pemSplitResult:
      !r.agree && r.pemSide
        ? r.pemSide === samSide
          ? grade(g.final, g.sam.market, samSide)
          : grade(g.final, g.david.market, davidSide)
        : undefined,
    pemResult: g.pem ? pemAlone(g.final, g.pem, r.avgMarket) : undefined,
  };
}

function pemAlone(final: { home: number; away: number }, pem: PemLine, avgMarket: number): Result | undefined {
  const m = pem.market ?? avgMarket;
  if (pem.model === m) return undefined;
  return grade(final, m, pem.model < m ? "home" : "away");
}

export interface CutResult extends Cut {
  record: Record;
  games: number;
  /** Weeks with at least one game in the cut. */
  weeks: number[];
  /** A research cut the strategy review activated as a rule candidate (policy.atsCandidates). */
  activated?: boolean;
}

/** Tier 2: judged only on the games it adds outside Tier 1. */
export interface SecondResult extends CutResult {
  /** The cut's full record, including games Tier 1 already takes. Context only. */
  fullRecord: Record;
}

/** Decided games (wins plus losses); pushes do not count toward a sample. */
export const decided = (r: Record) => r.w + r.l;

export interface StrategyBoard {
  cuts: CutResult[];
  baselines: { id: string; label: string; record: Record }[];
  splits: { sam: Record; david: Record };
  byWeek: { week: number; record: Record }[];
  /** The cut in force, chosen by the low end of its 90% range. */
  rule: CutResult | null;
  /**
   * Tier 2: the best other cut judged ONLY on the games it adds outside the
   * rule. Its `record` is that additional sample; `fullRecord` is context.
   */
  second: SecondResult | null;
}

/** The result a cut gives one game, or undefined when the cut does not bet it. */
export function cutResult(g: GradedGame, cut: Cut): Result | undefined {
  if (cut.test.pemSplit) return matches(g.read, cut.test) ? g.pemSplitResult : undefined;
  return g.read.agree && g.result && matches(g.read, cut.test) ? g.result : undefined;
}

/** Ranking: the low end of the likely range, then decided sample size. */
function rank(a: CutResult, b: CutResult): number {
  return b.record.lo - a.record.lo || decided(b.record) - decided(a.record);
}

/**
 * Tier 2 is only ever asked to bet the games Tier 1 does not, so each other
 * candidate is graded on exactly those games, and the same eligibility the
 * rule faces (10+ decided games, a winning rate past break-even) applies to
 * that additional sample. A runner-up whose overall record is mostly Tier 1's
 * games does not get to borrow them. Nothing qualifying means no Tier 2.
 */
export function pickSecond(games: GradedGame[], rule: Cut, cuts: CutResult[]): SecondResult | null {
  const extra = games.filter((g) => cutResult(g, rule) === undefined);
  const options = cuts
    .filter((x) => x.candidate && x.id !== rule.id)
    .map((x): SecondResult => {
      const hits = extra.filter((g) => cutResult(g, x) !== undefined);
      return {
        ...x,
        fullRecord: x.record,
        record: tally(hits.map((g) => cutResult(g, x) as Result)),
        games: hits.length,
        weeks: [...new Set(hits.map((g) => g.week))].sort((a, b) => a - b),
      };
    })
    .filter((x) => decided(x.record) >= MIN_SAMPLE && x.record.pct > BREAK_EVEN)
    .sort(rank);
  return options[0] ?? null;
}

export function strategies(
  league: "nfl" | "cfb",
  games: GradedGame[],
  opts: { activated?: string[] } = {},
): StrategyBoard {
  const agreed = games.filter((g) => g.read.agree && g.result);
  const withPem = games.some((g) => g.pem);
  const cuts: CutResult[] = cutsFor(league, withPem).map((cut) => {
    const hits = games.filter((g) => cutResult(g, cut) !== undefined);
    return {
      ...cut,
      record: tally(hits.map((g) => cutResult(g, cut) as Result)),
      games: hits.length,
      weeks: [...new Set(hits.map((g) => g.week))].sort((a, b) => a - b),
    };
  });

  const dogResults = games
    .filter((g) => g.sam.market !== 0)
    .map((g) => grade(g.final, g.sam.market, g.sam.market > 0 ? "home" : "away"));
  const baselines = [
    { id: "sam", label: "Sam alone, all games", record: tally(games.map((g) => g.samResult)) },
    { id: "david", label: "David alone, all games", record: tally(games.map((g) => g.davidResult)) },
    { id: "dogs", label: "Every underdog, no model", record: tally(dogResults) },
    ...(withPem
      ? [{ id: "pem", label: "PEM alone, games it covers", record: tally(games.flatMap((g) => (g.pemResult ? [g.pemResult] : []))) }]
      : []),
  ];

  const split = games.filter((g) => !g.read.agree);
  const weeks = [...new Set(agreed.map((g) => g.week))].sort((a, b) => a - b);

  const qualifies = (r: Record) => decided(r) >= MIN_SAMPLE && r.pct > BREAK_EVEN;

  // Research cuts become candidates only when the strategy review has
  // activated them on forward, pregame evidence (see learning/). Here they
  // then compete on the same source-line record as every other cut.
  const activated = new Set(opts.activated ?? []);
  const promoted: CutResult[] = cuts
    .filter((c) => c.group === "Research" && activated.has(c.id))
    .map((c) => ({ ...c, candidate: true, activated: true }));
  const pool = [...cuts.filter((x) => x.candidate), ...promoted];
  const eligible = pool.filter((x) => qualifies(x.record)).sort(rank);
  const rule = eligible[0] ?? null;
  const second = rule ? pickSecond(games, rule, pool) : null;

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

export type Tier = "t1" | "t2" | "wait" | "fav" | "pass" | "split" | "one";

/** One current market number every model on a game is judged against. */
export interface RefLine {
  /** Home-side spread. */
  line: number;
  /** The game total from the same quote, when there is one. */
  total?: number;
  /** American prices on each side of the spread and total, from the same quote. */
  homePrice?: number;
  awayPrice?: number;
  overPrice?: number;
  underPrice?: number;
  /** Scheduled kickoff (ISO). */
  kickoff?: string;
  /** Where it came from, e.g. "DraftKings via ESPN". */
  source: string;
  /** When we read it (the feed carries no quote time of its own). */
  fetchedAt: string;
}

export interface BoardGame {
  home: string;
  away: string;
  sam?: ModelLine;
  david?: ModelLine;
  read?: Read;
  tier: Tier;
  /** "TB +8.5", or each model's side on a split. */
  play: string;
  /**
   * "reference": every model judged at one current quote (`ref`); a play here
   * is a current recommendation. "source": no current quote, so each model is
   * judged at the number on its own site, the way the backtest is; a research
   * signal only, never sent as a play.
   */
  basis: "reference" | "source" | "started";
  ref?: RefLine;
  /** Picked side and the home-side line it was picked at (plays only). */
  side?: "home" | "away";
  homeLine?: number;
  /** Straight-up call, by the selected method. */
  su?: StraightUp;
  pem?: PemLine;
  /** The play is PEM's side of a Sam/David split. */
  pemPick?: boolean;
  /** An input the rule needs that is not on file (tier "wait"). */
  missing?: "PEM";
  /** Which tier a "wait" game would be if the missing input agreed. */
  waitFor?: "t1" | "t2";
  /** Bets: the estimated win probability (tier record pulled toward 50%, an estimate, not a calibration). */
  p?: number;
  /** The quoted price on the picked side; absent when the book quoted none. */
  price?: number;
  priceSource?: "quoted" | "missing";
  /** Units the policy wanted before the limits, and units allocated (0 = no bet). */
  want?: number;
  stake?: number;
  /** Already issued this week (any send): what went out. Not allocated again. */
  issued?: { units: number; price?: number; homeLine: number; side: "home" | "away" };
  /** Held until this time (ISO): an early look, not yet a bet (hold.ts). */
  held?: string;
  /** Finished: the final score, and each pick's result at its own line (finished.ts). */
  final?: { home: number; away: number };
  results?: { pick?: Result; issued?: Result; sam?: Result; david?: Result; pem?: Result };
}

const fmt = (x: number) => (x === 0 ? "PK" : `${x > 0 ? "+" : ""}${x}`);

/**
 * Both models (and PEM) against ONE number. Two models judged at their own
 * sites' lines can both "back the road team" while disagreeing at the price
 * actually available: Sam home -2 against his -3, David home -6 against his
 * -7, and at home -5 Sam is on the road team and David on the home team.
 */
export function readAt(ref: number, sam: ModelLine, david: ModelLine, pem?: PemLine): Read {
  return read(
    { market: ref, model: sam.model },
    { market: ref, model: david.model },
    pem ? { model: pem.model, market: ref } : undefined,
  );
}

/** The rule's test with its PEM condition dropped, to tell "PEM missing" from "PEM disagrees". */
function withoutPem(t: CutTest): CutTest {
  const rest = { ...t };
  delete rest.pem;
  delete rest.pemSplit;
  return rest;
}

export function tierBoard(
  league: "nfl" | "cfb",
  rows: { home: string; away: string; sam?: ModelLine; david?: ModelLine; pem?: PemLine; ref?: RefLine; started?: boolean }[],
  s: StrategyBoard,
  suMethod = "avg",
): BoardGame[] {
  return rows.map((row) => {
    // A game that has kicked off is never actionable, whatever the cache says.
    const basis: BoardGame["basis"] = row.started ? "started" : row.ref ? "reference" : "source";
    const su = straightUp(row.sam, row.david, league, suMethod, row.ref?.line);
    const team = (side: "home" | "away") => (side === "home" ? row.home : row.away);
    if (!row.sam || !row.david) {
      const only = row.sam ? "Sam" : "David";
      const m = (row.sam ?? row.david) as ModelLine;
      const at = row.ref?.line ?? m.market;
      return { ...row, basis, tier: "one", play: `${only} only: ${team(m.model < at ? "home" : "away")}`, su };
    }
    const r = row.ref ? readAt(row.ref.line, row.sam, row.david, row.pem) : read(row.sam, row.david, row.pem);
    const pemMissing = league === "cfb" && !row.pem;
    // A rule that needs PEM, on a game PEM has not covered, is undecided, not a "no".
    const waiting = (cut: CutResult | null): boolean =>
      !!cut && pemMissing && needsPem(cut.test) &&
      (cut.test.pemSplit ? !r.agree : matches(r, withoutPem(cut.test)));
    const wait = (waitFor: "t1" | "t2", play: string): BoardGame => ({
      ...row, basis, read: r, tier: "wait", missing: "PEM", waitFor, play, su,
    });

    if (!r.agree || !r.side || r.line === undefined) {
      const splitPlay = `Sam: ${team(r.samSide)} · David: ${team(r.davidSide)}`;
      const pemTier: "t1" | "t2" | null =
        r.pemSide && s.rule?.test.pemSplit ? "t1" : r.pemSide && s.second?.test.pemSplit ? "t2" : null;
      if (pemTier && r.pemSide) {
        // PEM's side, at the line it is graded at: the reference line when
        // there is one, otherwise the source line of the model PEM sided with
        // (the same number the backtest grades pem-split at).
        const m = r.pemSide === r.samSide ? row.sam : row.david;
        const homeLine = row.ref ? row.ref.line : m.market;
        const l = r.pemSide === "home" ? homeLine : -homeLine;
        return {
          ...row, basis, read: r, tier: pemTier, play: `${team(r.pemSide)} ${fmt(l)}`, su, pemPick: true,
          side: r.pemSide, homeLine,
        };
      }
      if (waiting(s.rule)) return wait("t1", splitPlay);
      if (waiting(s.second)) return wait("t2", splitPlay);
      return { ...row, basis, read: r, tier: "split", play: splitPlay, su };
    }
    const play = `${team(r.side)} ${fmt(r.line)}`;
    const homeLine = r.side === "home" ? r.line : -r.line;
    const base = { ...row, basis, read: r, play, su, side: r.side, homeLine };
    if (s.rule && matches(r, s.rule.test)) return { ...base, tier: "t1" };
    if (waiting(s.rule)) return { ...wait("t1", play), side: r.side, homeLine };
    if (s.second && matches(r, s.second.test)) return { ...base, tier: "t2" };
    if (waiting(s.second)) return { ...wait("t2", play), side: r.side, homeLine };
    return { ...base, tier: r.dog ? "pass" : "fav" };
  });
}

// --------------------------------------------------------------- straight up

/**
 * Projected-margin bands. These describe how far apart the pick projects the
 * two teams, nothing more: there is no probability calibration behind them.
 */
export type MarginBand = "wide" | "clear" | "close";

export interface StraightUp {
  side: "home" | "away";
  /** Projected margin of the picked team, by the selected method. */
  margin: number;
  band: MarginBand;
  /** The method that made the call (avg, sam, david, vegas). */
  method: string;
  /** Both models name the same winner. */
  agree: boolean;
  /** The pick is the market underdog. */
  upset: boolean;
}

/** Band edges, in points of projected margin. */
export const SU_BANDS = { nfl: { wide: 6, clear: 3 }, cfb: { wide: 14, clear: 7 } } as const;

export function marginBand(league: "nfl" | "cfb", margin: number): MarginBand {
  const b = SU_BANDS[league];
  return margin >= b.wide ? "wide" : margin >= b.clear ? "clear" : "close";
}

/** "By 6+", "By 3 to 6", "By under 3". */
export function marginLabel(league: "nfl" | "cfb", band: MarginBand): string {
  const b = SU_BANDS[league];
  return band === "wide" ? `By ${b.wide}+` : band === "clear" ? `By ${b.clear} to ${b.wide}` : `By under ${b.clear}`;
}

export function straightUp(
  sam?: ModelLine,
  david?: ModelLine,
  league: "nfl" | "cfb" = "nfl",
  method = "avg",
  ref?: number,
): StraightUp | undefined {
  const p = suPick(method, sam, david, ref);
  if (!p) return undefined;
  const ms = [sam, david].filter((m): m is ModelLine => !!m);
  const mkt = ref ?? ms.reduce((t, m) => t + m.market, 0) / ms.length;
  const agree = ms.length === 2 && Math.sign(ms[0].model) === Math.sign(ms[1].model) && ms[0].model !== 0;
  const upset = mkt !== 0 && (p.side === "home") !== mkt < 0;
  return { side: p.side, margin: p.margin, band: marginBand(league, p.margin), method, agree, upset };
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
  const avgOf = (g: GradedGame) => Math.abs((g.sam.model + g.david.model) / 2);
  const pickAvg = (g: GradedGame) => by((g.sam.model + g.david.model) / 2);
  const bands = (["wide", "clear", "close"] as const).map((band) =>
    rec(band, `${marginLabel(league, band)} (models' average margin)`, (g) =>
      marginBand(league, avgOf(g)) === band ? pickAvg(g) : null,
    ),
  );
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
  ref?: number,
): { side: "home" | "away"; margin: number } | null {
  const ms = [sam, david].filter((m): m is ModelLine => !!m);
  if (!ms.length) return null;
  const avg = (f: (m: ModelLine) => number) => ms.reduce((t, m) => t + f(m), 0) / ms.length;
  let x: number;
  // The market favorite at the current quote when there is one.
  if (method === "vegas") x = ref ?? avg((m) => m.market);
  else if (method === "sam" && sam) x = sam.model;
  else if (method === "david" && david) x = david.model;
  else x = avg((m) => m.model);
  if (x === 0) x = avg((m) => m.market) || avg((m) => m.model);
  return { side: x < 0 ? "home" : "away", margin: Math.abs(x) };
}
