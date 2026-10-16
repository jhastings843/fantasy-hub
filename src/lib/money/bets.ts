// Jack's own bets: cards built outside the app (a Jingles email, a tip), as
// opposed to the bets the picks email issues, which Picks already grades.
//
// A bet is logged once (scripts/money-bet.mjs, or POST /api/money/bets) and
// graded from ESPN when its game is final: the final and first-half scores
// for sides and totals, the box score for player props. Anything this file
// cannot read stays pending until it is graded by hand. Units are risked, the
// same convention as the cards: a win pays units x the price's payout.

import { nameKey, settle } from "@/lib/props/grade";
import { payout } from "@/lib/props/parse";
import type { Stat } from "@/lib/props/parse";

export type Market = "spread" | "moneyline" | "total" | "h1_spread" | "h1_moneyline" | "h1_total" | "prop";
export type Outcome = "W" | "L" | "P" | "void";

export interface MoneyBet {
  id: string;
  placedAt: string;
  /** Where the card came from, "Jingles". */
  source?: string;
  sport: "nfl" | "cfb";
  /** Game date in Eastern time, YYYY-MM-DD, used to find the game on ESPN. */
  date: string;
  /** ESPN abbreviations. */
  away: string;
  home: string;
  market: Market;
  /** Spread and moneyline: the side bet. */
  team?: string;
  /** Totals and props. */
  side?: "over" | "under";
  line?: number;
  player?: string;
  stat?: Stat;
  /** American odds. */
  price: number;
  units: number;
  label: string;
  note?: string;
  result?: { outcome: Outcome; net: number; actual?: string; gradedAt: string; by: "espn" | "hand" };
}

export interface FinalGame {
  final: boolean;
  away: { abbr: string; score: number; h1: number | null };
  home: { abbr: string; score: number; h1: number | null };
  box: Map<string, { [s in Stat]: number }> | null;
}

export function netUnits(outcome: Outcome, units: number, price: number): number {
  if (outcome === "W") return Math.round(units * payout(price) * 100) / 100;
  if (outcome === "L") return -units;
  return 0;
}

const STAT_LABEL: { [s in Stat]: string } = { pass_yds: "passing yards", rush_yds: "rushing yards", rec_yds: "receiving yards", rec: "receptions" };

/** The bet's result, or null while its game is not final or can't be read. */
export function gradeBet(b: MoneyBet, g: FinalGame): { outcome: Outcome; actual: string } | null {
  if (!g.final) return null;
  const half = b.market.startsWith("h1_");
  const pts = (t: { score: number; h1: number | null }) => (half ? t.h1 : t.score);
  const a = pts(g.away);
  const h = pts(g.home);
  if (a === null || h === null) return null;
  const scoreLine = `${g.away.abbr} ${a}, ${g.home.abbr} ${h}${half ? " at the half" : ""}`;

  if (b.market === "spread" || b.market === "h1_spread" || b.market === "moneyline" || b.market === "h1_moneyline") {
    const mine = b.team === g.home.abbr ? h : b.team === g.away.abbr ? a : null;
    const theirs = b.team === g.home.abbr ? a : h;
    if (mine === null) return null;
    const margin = mine - theirs + (b.market.endsWith("spread") ? (b.line ?? 0) : 0);
    return { outcome: margin > 0 ? "W" : margin < 0 ? "L" : "P", actual: scoreLine };
  }
  if (b.market === "total" || b.market === "h1_total") {
    if (!b.side || b.line === undefined) return null;
    return { outcome: settle(b.side, b.line, a + h), actual: `${a + h} points (${scoreLine})` };
  }
  if (b.market === "prop") {
    if (!b.side || b.line === undefined || !b.player || !b.stat || !g.box) return null;
    const row = g.box.get(nameKey(b.player));
    // Not in the box score: he didn't play, and a book voids it.
    if (!row) return { outcome: "void", actual: `${b.player} not in the box score` };
    const v = row[b.stat];
    return { outcome: settle(b.side, b.line, v), actual: `${v} ${STAT_LABEL[b.stat]}` };
  }
  return null;
}

export interface BetSummary {
  bets: number;
  decided: number;
  wins: number;
  losses: number;
  pushes: number;
  pending: number;
  risked: number;
  net: number;
  /** Net over units risked on decided bets. */
  roi: number | null;
  /** Running net units, one point per graded bet in grading order. */
  curve: { at: string; net: number; label: string }[];
}

export function summarize(bets: MoneyBet[]): BetSummary {
  const graded = bets.filter((b) => b.result).sort((x, y) => (x.result!.gradedAt + x.id).localeCompare(y.result!.gradedAt + y.id));
  let net = 0;
  const curve = graded.map((b) => {
    net = Math.round((net + b.result!.net) * 100) / 100;
    return { at: b.result!.gradedAt, net, label: b.label };
  });
  const decided = graded.filter((b) => b.result!.outcome === "W" || b.result!.outcome === "L");
  const risked = decided.reduce((s, b) => s + b.units, 0);
  return {
    bets: bets.length,
    decided: decided.length,
    wins: graded.filter((b) => b.result!.outcome === "W").length,
    losses: graded.filter((b) => b.result!.outcome === "L").length,
    pushes: graded.filter((b) => b.result!.outcome === "P").length,
    pending: bets.length - graded.length,
    risked,
    net,
    roi: risked ? Math.round((net / risked) * 1000) / 1000 : null,
    curve,
  };
}

const MARKETS: Market[] = ["spread", "moneyline", "total", "h1_spread", "h1_moneyline", "h1_total", "prop"];
const STATS: Stat[] = ["pass_yds", "rush_yds", "rec_yds", "rec"];

/** A bet from outside, checked field by field. Returns the problem, or the bet. */
export function validateBet(x: unknown): MoneyBet | string {
  const b = x as Partial<MoneyBet>;
  if (!b || typeof b !== "object") return "not an object";
  if (typeof b.id !== "string" || !/^[a-z0-9-]{3,80}$/.test(b.id)) return "id: lowercase letters, digits and dashes";
  if (b.sport !== "nfl" && b.sport !== "cfb") return "sport: nfl or cfb";
  if (typeof b.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(b.date)) return "date: YYYY-MM-DD";
  if (typeof b.away !== "string" || typeof b.home !== "string") return "away and home: ESPN abbreviations";
  if (!MARKETS.includes(b.market as Market)) return `market: one of ${MARKETS.join(", ")}`;
  if (typeof b.price !== "number" || Math.abs(b.price) < 100) return "price: American odds, like -110 or 120";
  if (typeof b.units !== "number" || b.units <= 0) return "units: a positive number";
  if (typeof b.label !== "string" || !b.label) return "label: what the card said";
  const sideMarket = b.market!.endsWith("spread") || b.market!.endsWith("moneyline");
  if (sideMarket && b.team !== b.away && b.team !== b.home) return "team: the away or home abbreviation";
  if (b.market!.endsWith("spread") && typeof b.line !== "number") return "line: the spread for that team, like -2.5";
  if ((b.market!.endsWith("total") || b.market === "prop") && (b.side !== "over" && b.side !== "under")) return "side: over or under";
  if ((b.market!.endsWith("total") || b.market === "prop") && typeof b.line !== "number") return "line: a number";
  if (b.market === "prop" && (typeof b.player !== "string" || !STATS.includes(b.stat as Stat))) return `prop: player and stat (${STATS.join(", ")})`;
  return { placedAt: new Date().toISOString(), ...b } as MoneyBet;
}
