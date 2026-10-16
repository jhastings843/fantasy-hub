// The snapshot trade-bot posts from Jack's Mac (tradebot/money_export.py).
// Field names match that file; change both together.

export interface BookPoint {
  day: string;
  equity: number;
  /** The same start in SPY on the same days, held the whole time. */
  spy: number | null;
}

export interface Book {
  id: string;
  label: string;
  about: string;
  started: string;
  start: number;
  cash: number;
  equity: number;
  spyEquity: number | null;
  asOf: string | null;
  curve: BookPoint[];
  positions: { symbol: string; shares: number; entryDay: string; entryPrice: number; last: number | null; lastDay: string | null; reason: string }[];
  fills: { day: string; symbol: string; side: string; shares: number; price: number; reason: string }[];
}

export interface PhilBet {
  id: string;
  ts: string;
  question: string | null;
  outcome: string | null;
  category: string | null;
  stake: number | null;
  entry: number | null;
  est: number | null;
  status: string;
  settledTs: string | null;
  endDate: string | null;
  pnl: number | null;
  slug: string | null;
}

export interface Phil {
  error?: string;
  bankroll: number;
  equity: number;
  cash: number;
  exposure: number;
  realizedPnl: number;
  settled: number;
  wins: number;
  voids: number;
  brierPhil: number | null;
  brierMarket: number | null;
  firstBet: string | null;
  lastCycle: string | null;
  health: string;
  healthOk: boolean;
  curve: { ts: string; equity: number }[];
  open: PhilBet[];
  settledBets: PhilBet[];
  categories: { category: string; bets: number; pnl: number }[];
  tracks: { name: string; maxStake: number; cash: number; realizedPnl: number; bets: number; open: number }[];
}

export interface KalshiRow {
  id: string;
  ts: string;
  ticker: string;
  title: string | null;
  pick: string | null;
  side: "yes" | "no" | null;
  decision: "bet" | "skip";
  skipReason: string | null;
  category: string | null;
  origin: "matched" | "kalshi_only";
  est: number | null;
  ask: number | null;
  effPrice: number | null;
  edge: number | null;
  /** Cost plus Kalshi's fee; 0 on a pass. */
  stake: number;
  baselineWouldBet: boolean | null;
  closes: string | null;
  status: "open" | "won" | "lost" | "void";
  settledTs: string | null;
  pnl: number | null;
  /** What it would have made at the default stake, bet or pass. */
  hypoPnl: number | null;
}

export interface KalshiBrier { n: number; brier_phil: number; brier_kalshi: number; brier_delta: number }

/** Phil's Kalshi shadow record. Its own venue and book: never added to Phil's Polymarket numbers. */
export interface Kalshi {
  error?: string;
  bankroll: number;
  cash: number;
  decisions: number;
  bets: number;
  open: number;
  settled: number;
  settledBets: number;
  wins: number;
  pnl: number;
  fees: number;
  roi: number | null;
  vsMarket: KalshiBrier | null;
  comparisons: { total: number; equivalent?: number; flagged?: number; rejected?: number };
  byOrigin: Record<"matched" | "kalshi_only", { decisions: number; bets: number; settled: number; pnl: number; vsMarket: KalshiBrier | null }>;
  thresholds: { testN: number; needed: number; usable: number; chosen: number | null; verdict: string };
  pooling: { pairs: number; needed: number; supported: boolean; note: string };
  lastScan: { ts: string; eligible?: Record<string, number>; picks: { ticker: string; bucket: "near" | "far"; category?: string; event?: string; title?: string; yes_sub_title?: string; mid?: number; settles_by?: string }[] } | null;
  watching: KalshiRow[];
  recent: KalshiRow[];
}

export interface MoneySnapshot {
  version: 1;
  generatedAt: string;
  books: Book[];
  phil: Phil | null;
  /** Missing from snapshots posted before 2026-10-16. */
  kalshi?: Kalshi | null;
}

/** Enough of a check that a malformed post can't break the page. */
export function isSnapshot(x: unknown): x is MoneySnapshot {
  const s = x as MoneySnapshot;
  return !!s && s.version === 1 && typeof s.generatedAt === "string" && Array.isArray(s.books)
    && s.books.every((b) => typeof b.id === "string" && Array.isArray(b.curve) && Array.isArray(b.positions))
    && (s.phil === null || typeof s.phil === "object");
}
