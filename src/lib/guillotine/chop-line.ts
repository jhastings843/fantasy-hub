// Who is actually in danger this week.
//
// The instinct is to rank projected scores and call the bottom third unsafe.
// That is what the season-goals rules did, and it is a bad model for this
// format: finishing 12th of 16 on projection is not a rank, it is a draw from
// a distribution whose left tail is elimination. Two teams projected within a
// point of each other can have very different odds of finishing last if one is
// four steady volume players and the other is four touchdown-dependent ones.
//
// So this simulates. Each team's weekly score is drawn around its projection,
// and the answer to "am I in trouble" is the share of simulated weeks in which
// this team is the low scorer. That number is directly actionable in a way a
// rank is not: at 16 teams alive, an average roster carries 6.25%, so 4% means
// hold your money and 19% means spend it.

import { bestLineup, type LineupPlayer } from "./lineup";
import { describeLastWeek, type LastWeek } from "./results";
import type { Fragility } from "./fragility";

/**
 * How much a player's weekly score bounces around his projection, as a share
 * of that projection.
 *
 * Quarterbacks are the steadiest: passing volume is stable and the position
 * scores every week. Tight ends are the wildest, because outside the top few
 * the position is touchdown-dependent, and a touchdown is a coin flip worth six
 * points. These are the standard shapes of weekly fantasy distributions rather
 * than measured constants, which is why the floor below matters as much.
 */
const VOLATILITY: Record<string, number> = {
  QB: 0.35,
  RB: 0.55,
  WR: 0.6,
  TE: 0.65,
  K: 0.7,
  DEF: 0.8,
};

const DEFAULT_VOLATILITY = 0.6;

/**
 * Minimum spread in points, so a projection near zero is not treated as a
 * certainty. A player projected for 2 points can score 14; the multiplicative
 * model alone would call that impossible.
 */
const MIN_PLAYER_SIGMA = 3;

export interface SimTeam {
  rosterId: number;
  name: string;
  /** Whose team this is, for the report's framing. */
  isMine: boolean;
  starters: LineupPlayer[];
}

export interface TeamRisk {
  rosterId: number;
  name: string;
  isMine: boolean;
  projected: number;
  /** Spread of this team's weekly outcome, in points. */
  sigma: number;
  /** Share of simulated weeks in which this team scored the least. */
  chopProbability: number;
  /** 1 = lowest projection in the league. */
  projectionRank: number;
  /** A bad-but-not-disastrous week: the 10th percentile outcome. */
  floor: number;
}

export interface ChopLineResult {
  teams: TeamRisk[];
  /** Average of the lowest score across simulations: the line to clear. */
  expectedChopLine: number;
  /**
   * Where the chop line actually lands, 10th to 90th percentile.
   *
   * The average alone reads as reassurance. In a 12-team week the low score
   * averages far below every projection, because it is the minimum of twelve
   * draws and someone always busts, so "31 points above the line" sounds safe
   * while carrying real risk. The spread is the honest picture.
   */
  chopLineRange: [number, number];
  /** My projection minus the expected chop line. Negative means underwater. */
  myMargin: number | null;
  myChopProbability: number | null;
  /** What an average roster carries, for comparison: 1 / teams alive. */
  baselineRisk: number;
  simulations: number;
}

/** Spread of a lineup's weekly total, treating players as independent. */
export function lineupSigma(starters: LineupPlayer[]): number {
  let variance = 0;
  for (const player of starters) {
    const cv = VOLATILITY[player.position] ?? DEFAULT_VOLATILITY;
    const sigma = Math.max(MIN_PLAYER_SIGMA, Math.abs(player.points) * cv);
    variance += sigma * sigma;
  }
  return Math.sqrt(variance);
}

/** Deterministic RNG, so a report generated twice reads the same twice. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normalPair(rand: () => number): [number, number] {
  // Box-Muller. u must not be zero or the log diverges.
  const u = Math.max(rand(), 1e-12);
  const v = rand();
  const r = Math.sqrt(-2 * Math.log(u));
  return [r * Math.cos(2 * Math.PI * v), r * Math.sin(2 * Math.PI * v)];
}

export function simulateChop(
  teams: SimTeam[],
  options: { simulations?: number; seed?: number } = {},
): ChopLineResult {
  const simulations = options.simulations ?? 20000;
  const rand = mulberry32(options.seed ?? 20260901);

  const profiles = teams.map((team) => {
    const projected = team.starters.reduce((sum, p) => sum + p.points, 0);
    return { team, projected, sigma: lineupSigma(team.starters) };
  });

  const lastCount = new Array(profiles.length).fill(0);
  const lowScores: number[] = [];
  let chopLineTotal = 0;

  if (profiles.length > 0) {
    const draws = new Array(profiles.length).fill(0);
    for (let sim = 0; sim < simulations; sim++) {
      let lowIndex = 0;
      let lowScore = Infinity;
      for (let i = 0; i < profiles.length; i++) {
        // One Box-Muller pair yields two normals; taking one and discarding the
        // other costs nothing at this scale and keeps the loop readable.
        const [z] = normalPair(rand);
        const score = profiles[i].projected + z * profiles[i].sigma;
        draws[i] = score;
        if (score < lowScore) {
          lowScore = score;
          lowIndex = i;
        }
      }
      lastCount[lowIndex]++;
      lowScores.push(lowScore);
      chopLineTotal += lowScore;
    }
  }

  const byProjection = [...profiles].sort((a, b) => a.projected - b.projected);
  const rankOf = new Map(byProjection.map((p, i) => [p.team.rosterId, i + 1]));

  const results: TeamRisk[] = profiles.map((p, i) => ({
    rosterId: p.team.rosterId,
    name: p.team.name,
    isMine: p.team.isMine,
    projected: p.projected,
    sigma: p.sigma,
    chopProbability: simulations > 0 ? lastCount[i] / simulations : 0,
    projectionRank: rankOf.get(p.team.rosterId) ?? 0,
    // 10th percentile of a normal sits 1.28 standard deviations below the mean.
    floor: p.projected - 1.2816 * p.sigma,
  }));

  results.sort((a, b) => b.chopProbability - a.chopProbability);

  const expectedChopLine = simulations > 0 ? chopLineTotal / simulations : 0;
  const mine = results.find((r) => r.isMine) ?? null;

  lowScores.sort((a, b) => a - b);
  const percentile = (q: number) =>
    lowScores.length === 0
      ? 0
      : lowScores[Math.min(lowScores.length - 1, Math.floor(q * lowScores.length))];

  return {
    teams: results,
    expectedChopLine,
    chopLineRange: [percentile(0.1), percentile(0.9)],
    myMargin: mine ? mine.projected - expectedChopLine : null,
    myChopProbability: mine ? mine.chopProbability : null,
    baselineRisk: profiles.length > 0 ? 1 / profiles.length : 0,
    simulations,
  };
}

export type Posture = "red" | "yellow" | "green";

function ordinal(n: number): string {
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th";
  return `${n}${suffix}`;
}

export interface PostureCall {
  posture: Posture;
  headline: string;
  detail: string;
}

/**
 * Turn the risk number into the week's stance.
 *
 * Thresholds are relative to the baseline rather than absolute, because the
 * baseline moves all season: 6.25% is average with 16 teams alive and 25% is
 * average with four. A team carrying twice its share of the risk is in trouble
 * whether that is 12% in September or 50% in December.
 */
export function callPosture(
  result: ChopLineResult,
  lastWeek: LastWeek | null = null,
  fragility: Fragility | null = null,
): PostureCall {
  const risk = result.myChopProbability;
  const baseline = result.baselineRisk;
  const margin = result.myMargin;

  if (risk == null || margin == null) {
    return {
      posture: "yellow",
      headline: "No read yet",
      detail: "Your team is not in the simulation, so this week has no risk number.",
    };
  }

  const ratio = baseline > 0 ? risk / baseline : 1;
  const pct = (risk * 100).toFixed(1);
  const call = escalateForFragility(callFor(result, ratio, pct), pct, fragility);
  return { ...call, detail: `${call.detail}${scoreboardNote(lastWeek)}` };
}

/**
 * A green read that rests on every starter playing is not green. When one
 * ordinary absence would put the roster inside the chop range, the week is
 * selective: buy the cheap cover before the week you need it. Fragility never
 * makes a week red, because red is for danger that is already here.
 */
function escalateForFragility(
  call: PostureCall,
  pct: string,
  fragility: Fragility | null,
): PostureCall {
  if (!fragility?.fragile) return call;
  const why = fragility.reasons.join(" ");
  if (call.posture === "green") {
    return {
      posture: "yellow",
      headline: `Selective. ${pct}% chance you are chopped this week, but only if everyone plays`,
      detail: `The simulation likes your best lineup, and the roster behind it is thin. ${why} Buy cover for that slot now, while it is cheap.`,
    };
  }
  return { ...call, detail: `${call.detail} ${why}` };
}

/**
 * Last week's finish, for context. It does not move the posture: a single
 * week is mostly noise and the projections already reflect what was real
 * about it. It is here so a reader can see it next to the forecast.
 */
function scoreboardNote(lastWeek: LastWeek | null): string {
  return lastWeek ? ` ${describeLastWeek(lastWeek)}` : "";
}

function callFor(result: ChopLineResult, ratio: number, pct: string): PostureCall {
  if (ratio >= 1.6) {
    return {
      posture: "red",
      headline: `Spend. ${pct}% chance you are chopped this week`,
      detail: `That is ${ratio.toFixed(1)}x an average roster's risk, and your floor sits well inside the range where the low score lands. Saved FAAB is worth nothing next week if this week ends you.`,
    };
  }

  if (ratio >= 0.85) {
    const mine = result.teams.find((t) => t.isMine);
    const rank = mine?.projectionRank ?? 0;
    const field = result.teams.length;
    // "About average" was the old wording here and it read as reassurance even
    // when this team was the single likeliest to be chopped. Where you sit in
    // the field is the honest version of the same number.
    const standing =
      rank > 0 && rank <= 3
        ? `You project ${ordinal(rank)} lowest of ${field}, so the margin is thinner than it looks.`
        : `You project ${ordinal(field - rank + 1)} highest of ${field}.`;
    return {
      posture: "yellow",
      headline: `Selective. ${pct}% chance you are chopped this week`,
      detail: `${ratio.toFixed(2)}x an average roster's risk. ${standing} Fix the weakest starting slot if it is cheap, and do not chase the headline name.`,
    };
  }

  return {
    posture: "green",
    headline: `Hold. ${pct}% chance you are chopped this week`,
    detail: `${ratio.toFixed(2)}x an average roster's risk, and your floor clears where the low score usually lands. Let someone else overpay. Minimum bids only.`,
  };
}

/** Convenience for callers holding rosters rather than solved lineups. */
export function toSimTeam(
  rosterId: number,
  name: string,
  isMine: boolean,
  players: LineupPlayer[],
  rosterPositions: string[],
): SimTeam {
  const lineup = bestLineup(players, rosterPositions);
  return {
    rosterId,
    name,
    isMine,
    starters: lineup.slots
      .map((s) => s.player)
      .filter((p): p is LineupPlayer => p !== null),
  };
}
