import type { PortfolioSnapshot } from "./types";

// A made-up version 1 snapshot for tests and local page checks. None of these
// numbers are Jack's: round, invented values only.
export function fixture(): PortfolioSnapshot {
  return {
    version: 1,
    asOf: "2026-11-05T23:40:00+00:00",
    priceDate: "2026-11-05",
    holdingsFrom: "2026-11-04",
    holdingsFile: "Portfolio_Positions_Test.csv",
    totals: { total: 50000, dayChange: -1000, dayChangePct: -1.96, cash: 4000, cashPct: 8 },
    accounts: [
      { name: "Brokerage", value: 30000, dayChange: -700 },
      { name: "Roth IRA", value: 15000, dayChange: -300 },
      { name: "Emergency fund", value: 5000, dayChange: 0 },
    ],
    holdings: [
      { symbol: "AAA", name: "Example Index Fund", account: "Brokerage", bucket: "core", qty: 40, price: 500, value: 20000, dayChange: -400, gainLoss: 2000, gainLossPct: 11.1, weight: 40 },
      { symbol: "BBB", name: "Example Growth Co", account: "Roth IRA", bucket: "bet", qty: 10, price: 300, value: 3000, dayChange: -150, gainLoss: -500, gainLossPct: -14.3, weight: 6 },
      { symbol: "CCC", name: "Example Employer Inc", account: "Brokerage", bucket: "employer", qty: 20, price: 150, value: 3000, dayChange: -60, gainLoss: 400, gainLossPct: 15.4, weight: 6 },
      { symbol: "DDD", name: "Example Bond Fund", account: "Roth IRA", bucket: "core", qty: 100, price: 120, value: 12000, dayChange: -90, gainLoss: 100, gainLossPct: 0.8, weight: 24 },
      { symbol: "CASH", name: "Money market", account: "Brokerage", bucket: "cash", value: 4000, dayChange: 0, weight: 8 },
    ],
    sleeve: { value: 3000, pct: 6, capPct: 8, names: ["BBB"] },
    employer: { value: 3000, pctOfBrokerage: 11, capPct: 10 },
    market: { spx: 6000, spxDayPct: -2, spxRecord: 6300, spxDrawdownPct: -4.76, ndx: 21000, ndxDayPct: -3, vix: 25, tenYear: 4.5 },
    cashPlan: [
      { label: "Step 2 (limit AAA $480 x2)", amount: 960, buy: "AAA", trigger_spx: 5800, backstop: "2026-11-20", status: "waiting", distancePct: -3.33 },
      { label: "Step 3 (backstop)", amount: 1000, buy: "AAA", trigger_spx: null, backstop: "2026-11-06", status: "backstop due", distancePct: null },
    ],
    watch: [{ signal: "VIX", symbol: "^VIX", warn_above: 35, calm_below: 20, now: 25, status: "normal" }],
    calendar: [{ date: "2026-11-17", event: "Example Co earnings", symbol: "BBB" }],
    missingQuotes: [],
    history: [
      { date: "2026-11-02", total: 51000, spx: 6100 },
      { date: "2026-11-03", total: 51500, spx: 6150 },
      { date: "2026-11-04", total: 51000, spx: 6120 },
      { date: "2026-11-05", total: 50000, spx: 6000 },
    ],
    advisor: {
      headline: "Stick to the plan: a rough day, nothing broke.",
      stance: "neutral",
      summary: "Stocks fell on rate worries. Your core funds moved with the market.",
      marketRead: [{ text: "S&P -2%, Nasdaq 100 -3%.", source: "Example News", url: "https://example.com/a", date: "2026-11-05" }],
      outlook: [
        { horizon: "days", call: "down", confidence: "med", reason: "Selling pressure may run another day.", signal: "VIX above 35" },
        { horizon: "weeks", call: "flat", confidence: "low", reason: "Earnings season is mixed.", signal: "Breadth" },
        { horizon: "months", call: "up", confidence: "med", reason: "Earnings still growing.", signal: "Jobs report" },
      ],
      actions: [
        { kind: "hold", symbol: "DDD", detail: "", reason: "Bonds do their job." },
        { kind: "buy", symbol: "AAA", amount: 1000, detail: "Market order", reason: "Backstop date reached.", when: "2026-11-06" },
        { kind: "sell", symbol: "BBB", amount: 500, detail: "Market order", reason: "Harvest the loss.", when: "2026-11-06", tax: -200 },
        { kind: "limit", symbol: "AAA", amount: 960, detail: "2 sh limit $480 GTC", reason: "Buy the dip at a set price.", when: "by 2026-11-20" },
        { kind: "wait", symbol: "BBB", amount: 300, detail: "Buy after earnings", reason: "Wait for the report.", when: "2026-11-18" },
      ],
      changes: ["Moved the AAA limit down $5."],
      ideas: [
        { symbol: "EEE", name: "Example Robotics", type: "stock", fit: "bet", thesis: "Orders doubled last quarter.", risk: "One big customer.", entry: "After its next report", size: 500, replaces: "BBB", status: "watching", source: "https://example.com/c", added: "2026-11-05" },
        { symbol: "FFF", name: "Example Dropped Co", type: "ipo", fit: "bet", thesis: "New listing.", risk: "No track record.", entry: "Not before lockup ends", size: 300, replaces: null, status: "dropped", added: "2026-11-01" },
        { symbol: "GGG", name: "Example World Index ETF", type: "etf", fit: "core", thesis: "Cheap way to own markets outside the US.", risk: "Dollar swings.", entry: "Any day, from new cash", size: 1000, replaces: null, status: "ready", added: "2026-11-03" },
      ],
      sources: [{ title: "Example source", url: "https://example.com/b", date: "2026-11-05" }],
      disclaimer: "Research, not licensed financial advice.",
    },
  };
}
