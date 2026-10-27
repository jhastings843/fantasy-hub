// Shadow record, tracked only: what Tier 1 and Tier 2 would have done if we
// ignored the bet/pass price gate and bet every tier pick at PRICE_CAP or
// better, 1u flat. Rebuilt on every core build from the pregame forecast
// archive and each week's frozen rule (rule-freeze.ts), so past weeks fill in
// on their own. Pure: every input is passed in.

import { type PemLine, type Record, type RefLine, type StrategyBoard, grade, key, tally, tierBoard } from "./engine";
import type { ForecastSnapshot } from "./forecasts";
import type { League } from "./parse";
import { decimal } from "./staking";

/** The worst American price the shadow still bets. */
export const PRICE_CAP = -115;

export interface ShadowRow {
  week: number;
  home: string;
  away: string;
  tier: "t1" | "t2";
  side: "home" | "away";
  homeLine: number;
  price: number;
  /** Went out in an email with a stake. */
  bet: boolean;
  result?: "W" | "L" | "P";
  /** At 1u risked, at the quoted price; absent until graded. */
  units?: number;
}

export interface PriceShadow {
  cap: number;
  /** Weeks with a frozen rule (earlier weeks had no fixed rule to replay). */
  weeks: number[];
  rows: ShadowRow[];
  /** Every tier pick at the cap or better. */
  all: Record & { actual: number };
  /** The ones we bet. */
  bet: Record & { actual: number };
  /** The ones the price gate passed on. */
  passed: Record & { actual: number };
  /** Tier picks left out for a price worse than the cap. */
  overCap: number;
}

const units = (r: "W" | "L" | "P", price: number) => (r === "W" ? decimal(price) - 1 : r === "L" ? -1 : 0);

function sum(rows: ShadowRow[]): Record & { actual: number } {
  const g = rows.filter((x) => x.result);
  return { ...tally(g.map((x) => x.result!)), actual: Math.round(g.reduce((a, x) => a + (x.units ?? 0), 0) * 100) / 100 };
}

export function priceShadow(
  league: League,
  snaps: ForecastSnapshot[],
  boards: [number, StrategyBoard][],
  finals: Map<string, { home: number; away: number }>,
  /** Engine keys of games we bet, mapped to the side bet. */
  betKeys: Map<string, "home" | "away">,
  veto: { pem?: boolean } = {},
  cap = PRICE_CAP,
): PriceShadow {
  const rows: ShadowRow[] = [];
  let overCap = 0;
  for (const [week, board] of boards) {
    // Each game's last pregame read with a quote: the closest thing to what a bet would have got.
    const last = new Map<string, ForecastSnapshot>();
    for (const x of snaps) {
      if (x.week !== week || !x.ref || (x.ref.kickoff && x.at >= x.ref.kickoff)) continue;
      const cur = last.get(`${x.away}@${x.home}`);
      if (!cur || x.at > cur.at) last.set(`${x.away}@${x.home}`, x);
    }
    const tiered = tierBoard(
      league,
      [...last.values()].map((x) => ({ home: x.home, away: x.away, sam: x.sam, david: x.david, pem: x.pem as PemLine | undefined, ref: x.ref as RefLine })),
      board,
      "avg",
      veto,
    );
    for (const g of tiered) {
      if ((g.tier !== "t1" && g.tier !== "t2") || !g.side || g.homeLine === undefined) continue;
      const price = g.side === "home" ? g.ref?.homePrice : g.ref?.awayPrice;
      if (price === undefined) continue;
      if (price < cap) {
        overCap++;
        continue;
      }
      const k = key({ week, home: g.home, away: g.away });
      const f = finals.get(k);
      const result = f ? grade(f, g.homeLine, g.side) : undefined;
      rows.push({
        week, home: g.home, away: g.away, tier: g.tier, side: g.side, homeLine: g.homeLine, price,
        bet: betKeys.get(k) === g.side,
        ...(result ? { result, units: Math.round(units(result, price) * 100) / 100 } : {}),
      });
    }
  }
  rows.sort((a, b) => b.week - a.week || a.away.localeCompare(b.away));
  return {
    cap,
    weeks: boards.map(([w]) => w).sort((a, b) => a - b),
    rows,
    all: sum(rows),
    bet: sum(rows.filter((x) => x.bet)),
    passed: sum(rows.filter((x) => !x.bet)),
    overCap,
  };
}
