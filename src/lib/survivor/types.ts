// Core types for the survivor engine.
//
// One report object feeds the page and the API so the two cannot drift,
// which is the same shape the guillotine FAAB advisor settled on.

export interface Game {
  week: number;
  /** Canonical abbr, matches NFL_TEAMS in teams.ts */
  home: string;
  away: string;
  /** ISO kickoff */
  kickoff: string;
  /** Home spread. Negative means home is favored. Null when unpriced. */
  homeSpread: number | null;
  /** American moneylines as posted. Null when unpriced. */
  homeMoneyline: number | null;
  awayMoneyline: number | null;
  overUnder: number | null;
  /** No-vig win probability for the home side, 0-1. */
  homeWinProb: number;
  /** Where homeWinProb came from. Moneyline is the good case. */
  probSource: "moneyline" | "spread" | "rating";
  completed: boolean;
  homeScore: number | null;
  awayScore: number | null;
}

/** One team's situation in one week. */
export interface TeamWeek {
  team: string;
  opponent: string;
  home: boolean;
  winProb: number;
  spread: number | null;
  moneyline: number | null;
  probSource: Game["probSource"];
  kickoff: string;
}

/** Fraction of the field on each team, 0-1, keyed by canonical abbr. */
export type Ownership = Record<string, number>;

export interface OwnershipSnapshot {
  week: number;
  source: "yahoo" | "projected" | "manual";
  /** 0-1 fractions. Only teams playing that week appear. */
  picks: Ownership;
  pulledAt: string;
}

export interface InjuryNote {
  team: string;
  player: string;
  position: string;
  status: string;
  comment: string;
  /** True for the positions that actually move a win probability. */
  premium: boolean;
}

/** A single candidate pick, fully scored. */
export interface Candidate {
  team: string;
  opponent: string;
  home: boolean;
  week: number;
  kickoff: string;

  /** No-vig probability this team wins, 0-1. */
  winProb: number;
  probSource: Game["probSource"];
  spread: number | null;
  moneyline: number | null;

  /** Fraction of the field expected on this team, 0-1. */
  ownership: number;
  /** Expected surviving fraction of the field given this team wins, 0-1. */
  fieldSurvival: number;
  /** Equity multiplier vs an equal share of the prize. 1.0 is neutral. */
  equityMultiplier: number;

  /** Log-points of future survival given up by burning this team now. */
  futureCost: number;
  /** The week this team is most valuable in, if it is not this one. */
  bestFutureWeek: number | null;
  bestFutureWinProb: number | null;

  /** log(equityMultiplier) - futureCost. The ranking number. */
  score: number;

  /** Human-readable flags: trap signals, injuries, scarcity. */
  flags: CandidateFlag[];
}

export interface CandidateFlag {
  kind: "injury" | "trap" | "scarcity" | "leverage" | "chalk" | "data";
  severity: "info" | "warn" | "danger";
  text: string;
}

export interface PoolConfig {
  /** Entries at the start of the season. */
  poolSize: number;
  /** Entries still alive. Falls back to poolSize before week 1. */
  entriesAlive: number | null;
  /** Losses allowed before elimination. 1 = one strike. */
  strikes: number;
  canRebuy: boolean;
  /** Does a tie advance you? */
  tieAdvances: boolean;
  /** Teams already burned, canonical abbrs. */
  usedTeams: string[];
  /**
   * What the pool ACTUALLY picked, week -> abbr -> percent. Only visible after
   * a week ends, so this is a record of the past rather than an input to the
   * present. It does two jobs: it fits how far the pool leans off the public,
   * and it derives which teams the field has burned and how many entries are
   * left.
   */
  weeklyPicks: Record<string, Record<string, number>>;
  /** Weeks to look ahead when pricing future value. */
  horizon: number;
}

export const DEFAULT_POOL: PoolConfig = {
  poolSize: 500,
  entriesAlive: null,
  strikes: 1,
  canRebuy: false,
  tieAdvances: false,
  usedTeams: [],
  weeklyPicks: {},
  horizon: 8,
};

export interface FuturePlan {
  week: number;
  team: string;
  opponent: string;
  home: boolean;
  winProb: number;
}

import type { FieldState } from "./field";
import type { Calibration } from "./calibration";

export interface SurvivorReport {
  season: number;
  week: number;
  /** When the slate locks, i.e. the first kickoff of the week. */
  locksAt: string | null;
  generatedAt: string;

  pool: PoolConfig;
  entriesAlive: number;

  /** Every legal pick this week, best first. */
  candidates: Candidate[];
  /** The pick the engine would make, and why in one sentence. */
  headline: string;
  reasoning: string[];
  /** Highest equity. Always candidates[0], named so the UI cannot mislabel it. */
  bestTeam: string | null;
  /**
   * Teams that cannot honestly be separated from bestTeam, including it.
   *
   * Length 1 means the pick is genuinely ahead. Longer means the gap is inside
   * the error in the ownership estimate and any of them is a defensible pick.
   * Week 1 of 2026 had LAC and JAX 0.06% apart and reported LAC as though that
   * were a decision.
   */
  tied: string[];
  /** Highest raw win probability, which is often a different team. */
  safestTeam: string | null;
  /**
   * How much win probability the recommended pick gives up against the safest
   * board. Past about 8 points that is a big ask even in a 500-entry pool.
   */
  safetyGiveUp: number;

  /** Best assignment of remaining teams to remaining weeks. */
  plan: FuturePlan[];
  /** Probability of surviving the whole planned path, 0-1. */
  planSurvival: number;

  ownership: OwnershipSnapshot;
  injuries: InjuryNote[];
  notes: string[];

  /** Where the pool stands: entries left, and which teams it has burned. */
  field: FieldState;
  /**
   * Completed weeks whose pool picks have not been logged yet. Logging these is
   * the one recurring input the tool asks for.
   */
  unloggedWeeks: number[];
  /** How far the pool leans off the public, fitted from the logged weeks. */
  calibration: Calibration;
}
