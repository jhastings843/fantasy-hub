import type { BpStats, VwapRebound, VwapReboundRow, VwapShadow } from "./types";

// Plain reads of the VWAP rebound book and the VWAP/EMA9 shadow log (trade-bot
// tradebot/vwap_rebound.py and vwap_shadow.py), kept pure for the page and the tests.

export const bp = (n: number) => `${n > 0 ? "+" : n < 0 ? "-" : ""}${Math.abs(n).toFixed(1)}bp`;

/** What today's row means, in a few words, and which chip tone it gets. */
export function reboundToday(r: VwapReboundRow | undefined): { chip: string; tone: "live" | "win" | "loss" | "quiet"; text: string } {
  if (!r) return { chip: "No session yet", tone: "quiet", text: "The first check runs at 9:50am Eastern on the next trading day." };
  switch (r.state) {
    case "no-setup":
      return { chip: "No setup", tone: "quiet", text: `Sitting out: ${r.setup_note ?? "yesterday did not qualify"}.` };
    case "waiting":
      return { chip: "Watching", tone: "live", text: "Setup day. Watching for a dip under VWAP between 10am and 1pm." };
    case "open":
      return { chip: "In a trade", tone: "live", text: `Bought ${r.shares ?? "?"} ${r.symbol} at ${r.entry?.toFixed(2) ?? "?"}. Sells after a close back above VWAP, or at the close.` };
    case "closed": {
      const b = r.bp ?? 0;
      return { chip: b >= 0 ? "Won" : "Lost", tone: b >= 0 ? "win" : "loss", text: `In at ${r.entry?.toFixed(2)}, out at ${r.exit?.toFixed(2)} (${r.how === "close" ? "at the close" : "back above VWAP"}): ${bp(b)}.` };
    }
    case "skip":
      return { chip: "Passed", tone: "quiet", text: `Signal at ${r.signal_time ?? "?"} failed a filter: ${r.why ?? ""}.` };
    case "missed":
      return { chip: "Missed", tone: "quiet", text: `${r.why ?? "Seen only after the close"}. No trade.` };
    default:
      return { chip: "No signal", tone: "quiet", text: "Setup day, but no qualifying dip by 1pm." };
  }
}

/** Live record against the backtest: too early under 20 trades, otherwise how the average compares. */
export function reboundRead(d: VwapRebound): string {
  const n = d.record?.n ?? 0;
  const b = d.backtest;
  if (n < 20) return `${n} live ${n === 1 ? "trade" : "trades"} so far. The backtest averaged ${bp(b.meanBp)} over ${b.n}; it takes about 20 live trades (roughly two years) before the comparison means anything.`;
  const m = d.record.meanBp ?? 0;
  return m >= b.meanBp / 2
    ? `Holding up: ${bp(m)} a trade live against ${bp(b.meanBp)} in the backtest.`
    : `Falling short: ${bp(m)} a trade live against ${bp(b.meanBp)} in the backtest.`;
}

const LANE_NAME: Record<string, string> = {
  ema: "SPY + QQQ, 5-min, out on an EMA9 break",
  cross: "SPY + QQQ, 5-min, out on the opposite cross",
  cross3m: "TSLA, NVDA, AMD, NFLX, 3-min, opposite cross",
};

/** The pooled lanes in a fixed order, each with a plain name. */
export function shadowLanes(d: VwapShadow): { key: string; name: string; st: BpStats }[] {
  return ["ema", "cross", "cross3m"].filter((k) => d.lanes?.[k]).map((k) => ({ key: k, name: LANE_NAME[k], st: d.lanes[k] }));
}
