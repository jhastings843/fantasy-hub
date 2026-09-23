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
  /** Display name. Seeded from the pool's meta, renameable per pool. */
  name: string;
  /** Entries at the start of the season. */
  poolSize: number;
  /** Entries still alive. Falls back to poolSize before week 1. */
  entriesAlive: number | null;
  /**
   * The week `entriesAlive` was counted in.
   *
   * A number read off the pool's own board beats anything derived from the
   * pick distribution, which cannot see entries that left before the snapshot.
   * But it beats it for that week only: an old count left in place would
   * silently outrank the derivation for the rest of the season, which is the
   * failure the derivation was built to end.
   */
  entriesAliveWeek: number | null;

  /**
   * Who picked what, entry by entry, when the pool's board has been read.
   *
   * Optional and expected to be absent: it exists for the pools small enough
   * that transcribing ten rows is a minute's work, and for the back half of a
   * season in the big one. Everything still works without it, on fractions.
   */
  entries?: { name: string; picks: Record<string, string> }[];
  /** The week the rows were read, so a stale board can be spotted. */
  entriesWeek?: number | null;
  /** Where the rows came from, because it changes what the page should offer. */
  entriesSource?: "sleeper" | "screenshot" | null;
  /**
   * The Sleeper league behind this pool, when it has one.
   *
   * Its sport is "pickem:nfl", which is why it never appeared in a leagues
   * list or a pool query: every lookup filters on "nfl". Given the id, the
   * public endpoints serve every entry's whole pick history without a token.
   */
  sleeperLeagueId?: string | null;
  /** Losses allowed before elimination. 1 = one strike. */
  strikes: number;
  canRebuy: boolean;
  /** Does a tie advance you? */
  tieAdvances: boolean;
  /** Teams already burned, canonical abbrs. */
  usedTeams: string[];
  /**
   * What YOU picked, week -> abbr. Distinct from both fields around it.
   *
   * usedTeams means burned and unpickable, and weeklyPicks is what the POOL
   * did. Neither is "my pick for this week", and until 2026-09-10 there was no
   * field that was: taking a team wrote it into usedTeams, so the engine
   * dropped it from the board and the pick vanished instead of becoming the
   * answer.
   *
   * A pick for a week earlier than the current one is burned, derived rather
   * than copied, so a week rolls over on its own with no migration and no job.
   */
  myPicks: Record<string, string>;
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
  name: "Survivor pool",
  poolSize: 500,
  entriesAlive: null,
  entriesAliveWeek: null,
  strikes: 1,
  canRebuy: false,
  tieAdvances: false,
  usedTeams: [],
  myPicks: {},
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
import type { Posture } from "./posture";
import type { Calibration } from "./calibration";

export interface SurvivorReport {
  season: number;
  /** Which pool this board is for. The name for display lives on pool. */
  poolId: string;
  week: number;
  /** When the slate locks, i.e. the first kickoff of the week. */
  locksAt: string | null;
  generatedAt: string;

  pool: PoolConfig;
  entriesAlive: number;
  /** What the pool is playing for: an outright win or a share of one. */
  posture: Posture;
  /**
   * Every team spent, which is pool.usedTeams plus every pick from a week
   * already gone. Published because the two are NOT the same list and the grid
   * was rendering the shorter one.
   */
  burnedTeams: string[];
  /**
   * Every team SPENT, which is burnedTeams plus the pick taken this week.
   *
   * The two lists answer different questions and conflating them is what
   * confused Jack on 2026-09-13: he had JAX taken in the 500 and LAC in the
   * 30-player and neither counted as gone anywhere on the page. A team taken
   * this week is still on this week's board, because it is the answer and its
   * numbers are the thing being read. It is also gone for every week after,
   * because he has spent it.
   *
   * burnedTeams is "cannot be picked now". spentTeams is "cannot be picked
   * again". Counts and future planning want the second one.
   */
  spentTeams: string[];
  /** team -> the week whose pick burned it. Absent for teams burned by hand. */
  burnedByPick: Record<string, number>;

  /** Every legal pick this week, best first. */
  candidates: Candidate[];
  /** The pick the engine would make, and why in one sentence. */
  headline: string;
  reasoning: string[];
  /** The team you have taken this week, when you have taken one. */
  myPick: string | null;
  /**
   * That pick, priced, so the page can draw its card without looking it up.
   *
   * Published because the page WAS looking it up, in candidates, which is the
   * same lookup the engine had already got wrong and which drops a team once
   * its game kicks off. The result was a server saying "you have JAX" in the
   * headline while the page drew a TAKE THIS card recommending someone else.
   * One answer, computed once.
   */
  myPickCandidate: Candidate | null;
  /**
   * What taking it cost against the engine's pick, or null when there is
   * nothing to say: it agrees, or the two are inside the tie band anyway.
   *
   * Stated once and never repeated. An overruled engine is a normal thing on a
   * survivor board and a tool that argues every time is a tool you stop reading.
   */
  myPickNote: string | null;
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
   * Set when every entry's picks were read rather than modelled.
   *
   * The page uses it to stop asking for a weekly paste: a pool that reports
   * itself does not need transcribing, and leaving the box there would invite
   * somebody to overwrite good numbers with worse ones.
   */
  board?: {
    source: "sleeper" | "screenshot";
    alive: number;
    entries: number;
    /** Teams no surviving entry has used, which is what the field can follow you onto. */
    untouched: string[];
  } | null;
  /**
   * Completed weeks whose pool picks have not been logged yet. Logging these is
   * the one recurring input the tool asks for.
   */
  unloggedWeeks: number[];
  /** How far the pool leans off the public, fitted from the logged weeks. */
  calibration: Calibration;
}
