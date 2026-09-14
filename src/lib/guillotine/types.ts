// Shared shapes for the FAAB advisor.

import type { Phase, BudgetPlan } from "./budget";
import type { ChopLineResult, PostureCall, TeamRisk } from "./chop-line";
import type { MarketModel, Tier } from "./market";
import type { SeasonOutlook } from "./outlook";

/** A player with everything the advisor needs to price him. */
export interface PoolPlayer {
  playerId: string;
  name: string;
  position: string;
  team: string | null;
  /** Projected points this week under the league's own scoring. */
  weekPoints: number;
  /** Average projected points per remaining week, same scoring. */
  rosPoints: number;
  /** Sleeper's status string when it is anything other than active. */
  injuryStatus: string | null;
  /** The player's next bye, when it falls inside the horizon we care about. */
  byeWeek: number | null;
  /** True when this player came off the roster chopped this week. */
  fromChoppedRoster: boolean;
}

export interface BidTarget {
  player: PoolPlayer;
  tier: Tier;
  /** Points this player adds to your STARTING lineup, not his projection. */
  weekGain: number;
  /** The starter he would replace, when he replaces one. */
  displaces: { playerId: string; name: string; points: number } | null;
  slot: string | null;
  /** Submit this number. */
  bid: number;
  /** Never go past this number on this player. */
  walkAway: number;
  /** What the model expects the winning bid to be. */
  marketExpected: number;
  reason: string;
}

export interface BidChain {
  /** The hole this chain fills, in plain words. */
  need: string;
  /**
   * Every claim in a chain drops the same player, which makes them mutually
   * exclusive. Winning the first cancels the rest.
   */
  drop: { playerId: string; name: string } | null;
  targets: BidTarget[];
}

export interface BidCard {
  chains: BidChain[];
  /** Worst case if every claim you submit happens to win. */
  maxPossibleSpend: number;
  weeklyCap: number;
  /** True when the honest answer is to bid nothing meaningful. */
  sitOut: boolean;
  summary: string;
  /**
   * Starters that more than one chain plans to replace. Winning both claims is
   * legal and the drops differ, but the second upgrade is worth less than its
   * stated gain, because the first one already took that slot.
   */
  sharedDisplacement: string[];
}

export type ReportState =
  | "ok"
  | "not_guillotine"
  | "pre_draft"
  | "no_projections";

export interface Wallet {
  rosterId: number;
  name: string;
  isMine: boolean;
  remaining: number;
}

export interface WeeklyFaabReport {
  state: ReportState;
  /** Set when state is anything but ok: why there is no advice. */
  message?: string;

  league: {
    id: string;
    name: string;
    season: string;
    teams: number;
    teamsAlive: number;
    budget: number;
    scoringNotes: string[];
    tradesDisabled: boolean;
  };
  week: number;
  generatedAt: string;

  posture: PostureCall;
  phase: Phase;
  risk: ChopLineResult;
  /** The field, most at risk first. */
  field: TeamRisk[];

  me: {
    rosterId: number;
    name: string;
    faabRemaining: number;
    projected: number;
    starters: { slot: string; name: string; points: number; injuryStatus: string | null }[];
    weakSlots: string[];
    byeAlerts: string[];
  };

  budget: BudgetPlan;
  /** The same pacing rules, projected forward instead of asserted weekly. */
  season: SeasonOutlook;
  /** Every living team's FAAB, richest first. Who can outbid you, by name. */
  wallets: Wallet[];
  market: MarketModel;
  card: BidCard;

  /** Anything the report wants to caveat about its own inputs. */
  caveats: string[];
}
