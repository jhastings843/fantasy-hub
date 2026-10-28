// "Offer this trade to this person, and here is why."
//
// Jack's note on the trade page (2026-10-27): the tools were all there (best
// trades, league-wide matches, the builder) but reading them was work. This
// turns the best-trade search into one pitch per manager: the deal, why it
// helps us, why it helps them, the value on both sides (market blended with
// Jingles where his list is current), and a message ready to paste into
// Sleeper. Pure, so the client builder can run it.

import type { PlayerRow, TeamSummary } from "./power-rankings";
import { findBestTrades, jinglesLean, type BestTradeIdea, type PositionalImpact } from "./trade-recommender";

export interface TradeChance {
  label: "Likely yes" | "Good shot" | "Coin flip";
  /** Tailwind tone key for the badge. */
  tone: "good" | "ok" | "even";
}

/**
 * The partner's own score for the deal (value to them plus what it does to
 * their rooms, the same scale the analyzer's verdicts use) read as a chance.
 * Not a fitted probability: no league's accept/decline history exists to fit
 * one, so it stays a three-step read of the verdict thresholds.
 */
export function chanceFor(partnerScore: number): TradeChance {
  if (partnerScore >= 18) return { label: "Likely yes", tone: "good" };
  if (partnerScore >= 6) return { label: "Good shot", tone: "ok" };
  return { label: "Coin flip", tone: "even" };
}

export interface TradeOffer {
  partnerRosterId: number;
  partnerName: string;
  send: PlayerRow[];
  receive: PlayerRow[];
  chance: TradeChance;
  /** Plain sentences, ours first, then theirs, value, his list. */
  why: string[];
  /** Ready to paste into Sleeper's trade note. */
  message: string;
  /** The search's own idea, so the builder can load it. */
  idea: BestTradeIdea;
}

const names = (ps: PlayerRow[]) => ps.map((p) => p.name).join(" and ");

function roomLines(impact: PositionalImpact[], whose: "Your" | "Their"): string[] {
  return impact
    .filter((i) => i.delta > 0)
    .sort((a, b) => b.delta - a.delta)
    .map((i) => {
      const tail = i.holeChange === "closes" ? ", out of the bottom three" : "";
      return `${whose} ${i.position} room goes from #${i.beforeRank} to #${i.afterRank}${tail}`;
    });
}

function costLines(impact: PositionalImpact[], whose: "Your" | "Their"): string[] {
  return impact
    .filter((i) => i.delta < 0)
    .map((i) => `${whose} ${i.position} room slips from #${i.beforeRank} to #${i.afterRank}${i.holeChange === "opens" ? " (into the bottom three)" : ""}`);
}

/** One pitch per manager, strongest first. */
export function tradeOffers(
  myTeam: TeamSummary,
  allTeams: TeamSummary[],
  totalTeams: number,
  options: { youth?: boolean; limit?: number } = {},
): TradeOffer[] {
  const ideas = findBestTrades(myTeam, allTeams, totalTeams, 500, { youth: options.youth ?? false });
  const best = new Map<number, BestTradeIdea>();
  for (const idea of ideas) {
    const had = best.get(idea.partnerRosterId);
    if (!had || idea.score > had.score) best.set(idea.partnerRosterId, idea);
  }
  return [...best.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, options.limit ?? 6)
    .map((idea) => {
      const ours = roomLines(idea.positionalImpact, "Your");
      const theirs = roomLines(idea.partner.positionalImpact, "Their");
      const why = [...ours, ...costLines(idea.positionalImpact, "Your"), ...theirs];
      if (theirs.length === 0) why.push("Their rooms barely move, so the pitch to them is value");

      const gap = idea.theirValue - idea.myValue;
      const base = Math.max(idea.myValue, idea.theirValue) || 1;
      const pct = Math.round((Math.abs(gap) / base) * 100);
      why.push(
        pct < 5
          ? `Even on value: ${idea.myValue.toLocaleString()} out, ${idea.theirValue.toLocaleString()} back`
          : gap > 0
            ? `You come out ${gap.toLocaleString()} ahead on value (${pct}%), so the pitch to them is the room fit`
            : `You give up ${Math.abs(gap).toLocaleString()} in value (${pct}%) for the fit, which makes it easy for them to say yes`,
      );
      why.push(jinglesLean(idea.send, idea.receive)?.line ?? "Values are market only here: no current Jingles list applies to this league");

      const myNeed = idea.positionalImpact.filter((i) => i.delta > 0).sort((a, b) => b.delta - a.delta)[0]?.position;
      const theirNeed = idea.partner.positionalImpact.filter((i) => i.delta > 0).sort((a, b) => b.delta - a.delta)[0]?.position;
      const pitch =
        myNeed && theirNeed && myNeed !== theirNeed
          ? `I'm looking for ${myNeed} help and you could use a ${theirNeed}.`
          : theirNeed
            ? `Looks like you could use a ${theirNeed}.`
            : `Thought this could work for both of us.`;
      const message = `Hey ${idea.partnerName}, ${pitch} Would you do ${names(idea.send)} for ${names(idea.receive)}?`;

      return {
        partnerRosterId: idea.partnerRosterId,
        partnerName: idea.partnerName,
        send: idea.send,
        receive: idea.receive,
        chance: chanceFor(idea.partner.score),
        why,
        message,
        idea,
      };
    });
}
