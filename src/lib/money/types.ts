// The snapshot trade-bot posts from Jack's Mac (tradebot/money_export.py).
// Field names match that file; change both together.

export interface BookPoint {
  day: string;
  equity: number;
  /** The same start in SPY on the same days, held the whole time. */
  spy: number | null;
  /** Today at live prices (trade-bot tradebot/live.py), replaced by the close mark the next morning. */
  live?: boolean;
  at?: string;
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
  /** Day the learner retired it; the book is frozen from then. Missing before 2026-10-17. */
  retired?: string | null;
  /** When the last curve point is live, the quote time. Missing before 2026-10-19. */
  liveAt?: string | null;
}

/** The learner's weekday grade of every active book (trade-bot learner.grade). Changes nothing. */
export interface BookGrade {
  book: string;
  /** "retire" means a rule would fire if Saturday's run saw these numbers. */
  action: "keep" | "retire";
  sessions: number;
  ret: number;
  spy: number | null;
  excess: number | null;
  t: number | null;
  /** Whether its strategy still passes the lab's filter; null for books with no backtest on file. */
  passes: boolean | null;
  why: string;
}

export interface Grades {
  day: string;
  through: string;
  books: BookGrade[];
}

/** One weekly learner run on the stock books (trade-bot tradebot/learnlog.py). */
export interface LearnEntry {
  day: string;
  through: string | null;
  tested: number | null;
  candidates: number | null;
  proven: number | null;
  pbo: number | null;
  decisions: { action: string; book: string; why: string }[];
  fixes: string[];
  watch: string[];
  lessons: string | null;
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
  /** Missing before 2026-10-19 (Polymarket then). */
  venue?: "polymarket" | "kalshi";
  /** Kalshi Phil only: market ticker, series, fee paid, whole contracts. */
  ticker?: string | null;
  series?: string | null;
  fee?: number | null;
  contracts?: number | null;
}

export interface Phil {
  error?: string;
  /** Missing before 2026-10-19 (Polymarket then). */
  venue?: "polymarket" | "kalshi";
  /** Kalshi fees paid, already inside every number. */
  fees?: number;
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
  /** Kalshi Phil: a separate agent trading Kalshi on paper, same shape as Phil.
   *  Never added to Phil's numbers. Missing before 2026-10-19. */
  kalshiPhil?: Phil | null;
  /** The stock books' learn log, newest first. Missing before 2026-10-17. */
  learnLog?: LearnEntry[] | null;
  /** Latest weekday grade. Missing before 2026-10-19. */
  grades?: Grades | null;
}

/** Enough of a check that a malformed post can't break the page. */
export function isSnapshot(x: unknown): x is MoneySnapshot {
  const s = x as MoneySnapshot;
  return !!s && s.version === 1 && typeof s.generatedAt === "string" && Array.isArray(s.books)
    && s.books.every((b) => typeof b.id === "string" && Array.isArray(b.curve) && Array.isArray(b.positions))
    && (s.phil === null || typeof s.phil === "object");
}
