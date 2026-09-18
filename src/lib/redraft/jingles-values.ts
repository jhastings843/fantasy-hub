// Fold his season-long list into the market values a redraft trade is priced
// on.
//
// FantasyCalc is the crowd: thousands of real trades, which is exactly what a
// trade partner will quote back. Jingles is one analyst Jack trusts more than
// the crowd. Neither alone is the right price. A player he has RB8 and the
// market has RB15 is worth more to Jack than the market says, and less than
// his rank alone implies, because the partner is pricing off the market.
//
// So each ranked player is moved halfway from the market value to the value
// the market pays at HIS rank. Reading the market's own value curve keeps the
// scale honest: a rank-2 player is worth whatever the market's second player
// is worth, not a number invented here.
//
// WITHIN POSITION, not overall. His list is a one-quarterback draft board,
// where Josh Allen sits 40th because a QB can wait; FantasyCalc prices him as
// the top redraft trade asset. Blending on overall rank read that as a fade
// and knocked 1,400 off every elite QB and TE. His QB1 against the market's
// QB1 is the comparison he would actually make.
//
// Pure. The list and the values are both passed in, so this tests without
// Redis or the network and can never quietly read the wrong scoring.

import type { PlayerValueLike, PlayerValuesBySleeperId } from "@/lib/dynasty/power-rankings";

/** How far a player moves toward the value at his rank. */
export const JINGLES_WEIGHT = 0.5;

export interface SeasonListEntry {
  sleeperId: string;
  position: string;
  rank: number;
  positionRank: number;
}

export interface SeasonList {
  entries: SeasonListEntry[];
  byId: Record<string, SeasonListEntry>;
}

export interface BlendResult {
  values: PlayerValuesBySleeperId;
  /** Players whose value changed. Zero means his list and the market agree. */
  moved: number;
}

export function blendWithJingles(
  market: PlayerValuesBySleeperId,
  list: SeasonList,
  weight = JINGLES_WEIGHT,
): BlendResult {
  // The market's value curve per position, best first. Sorting by value
  // rather than trusting the source's positionRank field keeps this right for
  // a source that ranks differently from how it prices.
  const byMarket = Object.entries(market).sort(
    (a, b) => b[1].value - a[1].value || a[0].localeCompare(b[0]),
  );
  const curves: Record<string, number[]> = {};
  const marketPositionRankById: Record<string, number> = {};
  for (const [id, v] of byMarket) {
    const curve = (curves[v.position] ??= []);
    curve.push(v.value);
    marketPositionRankById[id] = curve.length;
  }

  const rankedAtPosition: Record<string, number> = {};
  for (const e of list.entries) {
    rankedAtPosition[e.position] = (rankedAtPosition[e.position] ?? 0) + 1;
  }

  const valueAtRank = (position: string, rank: number): number => {
    const curve = curves[position] ?? [];
    if (curve.length === 0) return 0;
    return curve[Math.min(Math.max(rank, 1), curve.length) - 1];
  };

  let moved = 0;
  const blended: [string, PlayerValueLike][] = byMarket.map(([id, v]) => {
    const marketPositionRank = marketPositionRankById[id];
    const his = list.byId[id];
    const ranked = rankedAtPosition[v.position] ?? 0;

    // Off his list: only meaningful when the market has the player somewhere
    // he would have had to rank. A player below the last one he ranked at the
    // position is outside the exercise, not a fade.
    let effectiveRank: number | null = null;
    if (his) effectiveRank = his.positionRank;
    else if (ranked > 0 && marketPositionRank <= ranked) effectiveRank = ranked + 1;

    if (effectiveRank === null) return [id, { ...v }];

    const target = valueAtRank(v.position, effectiveRank);
    const value = Math.round(v.value * (1 - weight) + target * weight);
    if (value !== v.value) moved += 1;

    return [
      id,
      {
        ...v,
        value,
        marketValue: v.value,
        marketPositionRank,
        jinglesRank: his?.rank ?? null,
        jinglesPositionRank: his?.positionRank ?? null,
      },
    ];
  });

  // Re-rank on the blended value so "#12 RB4" on a row matches the number
  // next to it. Ties keep market order, which is the order they arrived in.
  blended.sort((a, b) => b[1].value - a[1].value);
  const perPos: Record<string, number> = {};
  const values: PlayerValuesBySleeperId = {};
  blended.forEach(([id, v], i) => {
    perPos[v.position] = (perPos[v.position] ?? 0) + 1;
    values[id] = { ...v, overallRank: i + 1, positionRank: perPos[v.position] };
  });

  return { values, moved };
}
