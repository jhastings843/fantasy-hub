// What the trade tools take from the season plan (Jack, 2026-11-07: "does the
// trade page follow each league's goals and needs in my plan?" It only used
// the two weakest rooms). Pure and plain: keyword rules, no model call. Safe
// for client and server.
//
// Inputs: the plan page's trajectory (dynasty only) and Jack's own goals for
// that league. Output: a stance (win now / balanced / build) plus positions to
// add, positions to sell and players to keep.
//
// Examples (my roster has Jahmyr Gibbs and Davante Adams):
//   "Get a WR1 before the deadline"   -> focus WR
//   "Sell an RB, I'm deep there"      -> shed RB (not focus)
//   "Keep Gibbs, build around him"    -> keep Gibbs (on the do-not-trade list)
//   "Go all in for the title"         -> stance win_now, overrides trajectory
//   "Rebuild: get younger, add picks" -> stance build
//   a goal ticked done                -> ignored

import type { LeagueType } from "@/lib/league/types";
import type { PlayerRow } from "./power-rankings";
import type { Trajectory } from "./season-plan";

export type TradeStance = "win_now" | "balanced" | "build";

export interface PlanGoal {
  id: string;
  text: string;
  category: string;
  done: boolean;
}

export interface TradePlan {
  stance: TradeStance;
  /** Why the stance is what it is, for the line on the trade page. */
  stanceFrom: "trajectory" | "goal" | "format";
  trajectory: Trajectory | null;
  /** The goal text that set the stance, when a goal did. */
  stanceGoal: string | null;
  /** Positions a goal asks to add, with the goal that asked. */
  focus: { position: string; goal: string }[];
  /** Positions a goal asks to sell from. */
  shed: { position: string; goal: string }[];
  /** My players a goal says to keep. */
  keep: { id: string; name: string; goal: string }[];
}

export const STANCE_LABEL: Record<TradeStance, string> = {
  win_now: "Win now",
  balanced: "Balanced",
  build: "Build for later",
};

// Trailing (?![a-z]) rather than \b so "WR1" and "RB2" still read.
const POSITION_WORDS: [string, RegExp][] = [
  ["QB", /\b(qbs?|quarterbacks?)(?![a-z])/i],
  ["RB", /\b(rbs?|running ?backs?)(?![a-z])/i],
  ["WR", /\b(wrs?|wide ?receivers?|receivers?|wideouts?)(?![a-z])/i],
  ["TE", /\b(tes?|tight ?ends?)(?![a-z])/i],
];

const SELL = /\b(sell|selling|shop|move|deal|trade away|cash in|surplus|too many|deep at|deep there|i'?m deep)\b/i;
const KEEP = /\b(keep|hold|holding|untouchable|build around|not trading|no trade|don'?t trade|do not trade|never trade)\b/i;
const WIN_NOW = /\b(win now|win-now|all in|all-in|contend|contending|title|championship|ring|go for it|push for)\b/i;
const BUILD = /\b(rebuild|rebuilding|get younger|youth|young|future|draft capital|add picks|stockpile|sell (aging|old|vets?|veterans))\b/i;

/** Dynasty trajectory to stance; everything else plays for this season. */
export function stanceForTrajectory(t: Trajectory): TradeStance {
  if (t === "contender" || t === "compete") return "win_now";
  if (t === "rebuild") return "build";
  return "balanced";
}

function lastName(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts[parts.length - 1] ?? name;
}

function mentions(text: string, p: PlayerRow): boolean {
  const lower = text.toLowerCase();
  if (lower.includes(p.name.toLowerCase())) return true;
  // Last name alone, when it is long enough not to collide ("Gibbs", not "Hill"
  // inside "Chill"), and as a whole word.
  const last = lastName(p.name);
  if (last.length < 4) return false;
  return new RegExp(`\\b${last.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text);
}

export function buildTradePlan(input: {
  leagueType: LeagueType;
  trajectory: Trajectory | null;
  goals: PlanGoal[];
  myPlayers: PlayerRow[];
}): TradePlan {
  const open = input.goals.filter((g) => !g.done && g.category !== "draft");
  const dynasty = input.leagueType === "dynasty";

  let stance: TradeStance = dynasty && input.trajectory
    ? stanceForTrajectory(input.trajectory)
    : dynasty ? "balanced" : "win_now";
  let stanceFrom: TradePlan["stanceFrom"] = dynasty ? "trajectory" : "format";
  let stanceGoal: string | null = null;

  const focus: TradePlan["focus"] = [];
  const shed: TradePlan["shed"] = [];
  const keep: TradePlan["keep"] = [];

  for (const g of open) {
    const text = g.text;
    // Stance only moves in dynasty: a redraft team has no "later".
    if (dynasty) {
      const w = WIN_NOW.test(text);
      const b = BUILD.test(text);
      if (w !== b) {
        stance = w ? "win_now" : "build";
        stanceFrom = "goal";
        stanceGoal = text;
      }
    }

    const keeping = KEEP.test(text);
    if (keeping) {
      for (const p of input.myPlayers) {
        if (mentions(text, p) && !keep.some((k) => k.id === p.id)) {
          keep.push({ id: p.id, name: p.name, goal: text });
        }
      }
    }

    const selling = SELL.test(text);
    for (const [pos, re] of POSITION_WORDS) {
      if (!re.test(text)) continue;
      // "Keep my RBs" is neither a need nor a sale.
      if (keeping && !selling) continue;
      const list = selling ? shed : focus;
      if (!list.some((x) => x.position === pos)) list.push({ position: pos, goal: text });
    }
  }

  // A position cannot be both wanted and for sale; the wanted reading wins.
  const shedOnly = shed.filter((s) => !focus.some((f) => f.position === s.position));

  return {
    stance,
    stanceFrom,
    trajectory: dynasty ? input.trajectory : null,
    stanceGoal,
    focus,
    shed: shedOnly,
    keep,
  };
}

/** Marks a plan's keepers untouchable on my roster, in place. */
export function markPlanKeeps(players: PlayerRow[], plan: TradePlan): void {
  const ids = new Set(plan.keep.map((k) => k.id));
  for (const p of players) if (ids.has(p.id)) p.untouchable = true;
}
