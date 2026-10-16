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

export interface MoneySnapshot {
  version: 1;
  generatedAt: string;
  books: Book[];
  phil: Phil | null;
}

/** Enough of a check that a malformed post can't break the page. */
export function isSnapshot(x: unknown): x is MoneySnapshot {
  const s = x as MoneySnapshot;
  return !!s && s.version === 1 && typeof s.generatedAt === "string" && Array.isArray(s.books)
    && s.books.every((b) => typeof b.id === "string" && Array.isArray(b.curve) && Array.isArray(b.positions))
    && (s.phil === null || typeof s.phil === "object");
}
