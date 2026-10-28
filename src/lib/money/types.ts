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
  /** Plain-English description (trade-bot tradebot/explain.py): the idea, the exact rule, why it was opened. */
  strategy?: { what: string; how: string; record: string | null } | null;
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
  /** When the check ran (hourly with the Money push), and the live prices it used if any. */
  checked?: string;
  liveAt?: string | null;
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
  /** Phil's retros, newest first. Missing in snapshots before 2026-10-19. */
  learner?: PhilLearn[];
}

/** One of Phil's retros, read by trade-bot's money_export.parse_retro. */
export interface PhilLearn {
  file: string;
  ts: string | null;
  headline: string;
  noted: string[];
  lessons: string[];
  changes: string[];
  /** Phil's Kalshi review verdict (shadow check only). */
  review: string | null;
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
  /** The Kalshi half of Phil's retros, newest first. Missing before 2026-10-19. */
  learner?: PhilLearn[];
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
  /** The weather desk (~/Projects/weather-desk). Missing before 2026-10-19. */
  weather?: Weather | null;
  /** The trend book, tracked apart from the stock books (trade-bot tradebot/trends.py). Missing before 2026-10-21. */
  trends?: Trends | null;
  /** The intraday desk (trade-bot tradebot/intraday.py export()): opening-range breakouts on 5-minute bars,
   *  filtered by the Time Machine. Its own $100,000 paper book. Missing before 2026-10-28; `{ error }` if the desk failed. */
  intraday?: Intraday | null;
}

/** n graded picks, average return vs SPY, share that beat SPY, t-stat. */
export interface TrendStats {
  n: number;
  mean: number | null;
  hit: number | null;
  t: number | null;
}

export interface TrendPick {
  id: string;
  ticker: string;
  topic: string | null;
  link: "direct" | "second-order";
  conviction: 1 | 2 | 3;
  horizon: number;
  source: string | null;
  catalyst: string | null;
  why: string | null;
  pricedIn: string | null;
  bought: boolean;
}

export interface TrendGraded {
  id: string;
  day: string;
  ticker: string;
  topic: string | null;
  link: string;
  conviction: number;
  horizon: number;
  ret: number;
  spy: number;
  excess: number;
  through: string;
  bought: boolean;
}

/** trade-bot money_export.trend_desk(): a Claude picker's paper book, graded pick by pick. */
export interface Trends {
  error?: string;
  /** The paper book, same shape as a stock book. Null until its first run. */
  book?: Book | null;
  record?: TrendStats;
  /** The record split by kind of bet: link, conviction, horizon, source, run_up. */
  buckets?: Record<string, (TrendStats & { bucket: string })[]>;
  /** Buckets the fixed rule stopped buying, like "link=second-order". */
  benched?: string[];
  bench?: { n: number; excess: number; t: number };
  latest?: {
    day: string;
    picks: TrendPick[];
    rejected: { ticker: string | null; why: string }[];
    passed: { topic: string | null; why: string | null }[];
    exits: { ticker: string; why: string }[];
    /** The pick cap that day, and the picks past it, graded but not bought (added 2026-10-28). */
    cap?: number | null;
    extras?: { id: string; ticker: string; topic: string | null; link: string; conviction: number; horizon: number; why: string | null }[];
  } | null;
  history?: { day: string; tickers: string[] }[];
  graded?: TrendGraded[];
  playbook?: string | null;
  review?: { day: string; text: string } | null;
  /** The trend learner (trade-bot tradebot/trend_learner.py, added 2026-10-28). Means are fractions of a pick's return over SPY. */
  learner?: {
    cap: number;
    capChanged: string | null;
    reviewed: string | null;
    rules: { minN: number; minWeeks: number; edgeT: number; capCooldownDays: number; maxCap: number } | null;
    slices: TrendSlice[];
    journal: TrendJournal[];
  };
  /** First day the book buys picks; before it every pick is graded only. */
  liveFrom?: string;
  /** Picks waiting for their horizon, counted in trading sessions. */
  pending?: { id: string; ticker: string; day: string; horizon: number; sessionsLeft: number; extra: boolean }[];
}

export interface TrendSlice {
  slice: string;
  n: number;
  weeks: number;
  mean: number | null;
  t: number | null;
  heldOutMean: number | null;
  hit: number | null;
  status: "collecting" | "edge" | "losing" | "no edge";
}

export interface TrendJournal {
  at: string;
  kind: "status" | "cap" | string;
  slice?: string;
  before?: string | number | null;
  after?: string | number | null;
  n?: number;
  mean?: number | null;
  t?: number | null;
  heldOutMean?: number | null;
  why?: string;
}

/** One paper bet on a Kalshi daily-high bracket. */
export interface WeatherBet {
  id: string;
  placed: string;
  city: string;
  name: string;
  day: string;
  lead: "day1" | "day0";
  ticker: string;
  label: string;
  side: "yes" | "no";
  price: number;
  contracts: number;
  cost: number;
  fee: number;
  /** Chance the bet wins: the desk's own, and blended with the market by the trust weight. */
  desk?: number;
  p: number;
  edge: number;
  mu: number;
  sigma: number;
  status: "open" | "won" | "lost";
  settled?: string;
  pnl?: number;
  /** The live slices that earned this bet its stake (added 2026-10-28). */
  slices?: string[];
}

export interface WeatherCity {
  key: string;
  name: string;
  scored: number;
  desk: number | null;
  market: number | null;
  benched: boolean;
  bias: number | null;
  sigma: number | null;
  misses: number;
}

export interface WeatherDay {
  city: string;
  name: string;
  day: string;
  lead: "day1" | "day0";
  mu: number;
  sigma: number;
  favorite: string;
  favoriteP: number;
  favoriteMid: number | null;
  models?: Record<string, number>;
  /** The NWS high for the day and the share of the forecast it carried (added 2026-10-21). */
  nws?: number | null;
  nwsWeight?: number;
  edge: number | null;
  pick: string | null;
  /** Weather inputs (added 2026-10-28): the city's usual miss, how far apart the models are (°F), cloud cover (%), rain (in), and whether that makes the sky "unsettled". */
  citySigma?: number;
  spread?: number | null;
  cloud?: number | null;
  precip?: number | null;
  unsettled?: boolean;
}

/** One slice of the weather desk's edges (weather-desk desk/slices.py table()). roi = profit per $1 contract after fees. */
export interface WeatherSlice {
  key: string;
  label: string;
  status: "tracking" | "live";
  since: string;
  liveSince: string | null;
  n: number;
  days: number;
  won: number;
  roi: number;
  t: number;
}

export interface WeatherSliceGate {
  min_bets: number;
  min_days: number;
  min_t: number;
  max_new: number;
  rollback_bets: number;
  rollback_t: number;
  floor_t: number;
}

export interface WeatherSliceNote {
  day: string;
  kind: "live" | "rollback" | string;
  slice: string;
  label: string;
  why: string;
}

/** An edge the desk tracked at zero stake unless a live slice covered it. */
export interface WeatherTrackedBet {
  id: string;
  placed: string;
  city: string;
  day: string;
  label: string;
  side: "yes" | "no";
  kind: string;
  lead: "day1" | "day0";
  price: number;
  edge: number;
  p: number;
  unsettled: boolean;
  live: string[];
  won: boolean | null;
}

export interface WeatherModelTest {
  terms: string[];
  test: { base: number; weather: number; n: number; t: number } | null;
}

/** Weather desk status (weather-desk desk/desk.py report()). */
export interface Weather {
  version: 1;
  generatedAt: string;
  start: number;
  equity: number;
  cash: number;
  openCost: number;
  /** Set when the bankroll was reset: bets placed before it are the earlier era, summarized here. */
  eraStart?: string | null;
  previousEra?: { bets: number; won: number; open: number; pnl: number } | null;
  record: { settled: number; won: number; pnl: number; staked: number };
  curve: { day: string; equity: number }[];
  open: WeatherBet[];
  settled: WeatherBet[];
  cities: WeatherCity[];
  upcoming: WeatherDay[];
  learned: { days: number; scored: number; desk: number | null; market: number | null };
  trust: { w: number; days: number; fit: number | null };
  /** Desk-wide brake over the last week (added 2026-10-21): off, slow (quarter stakes) or stop. */
  brake?: { level: "off" | "slow" | "stop"; mult: number; n: number; desk: number | null; market: number | null; ratio: number | null };
  rules: { min_edge: number; kelly: number; max_stake: number; cutoff_hour: number; bench_min: number };
  /** Slice gate (added 2026-10-28): every edge is tracked; only edges in a live slice get a stake. */
  slices?: WeatherSlice[];
  sliceGate?: WeatherSliceGate;
  sliceJournal?: WeatherSliceNote[];
  tracked?: { n: number; days: number; won: number; roi: number; t: number; open: number; recent: WeatherTrackedBet[] };
  weatherModel?: { halfLifeDays: number; fitted: string | null; sameDay: WeatherModelTest; dayAhead: WeatherModelTest };
}

/** Graded breakouts: count, average result in R (1R = the planned loss), share that made money, t-stat. */
export interface IntradayStats {
  n: number;
  meanR: number | null;
  hit: number | null;
  t: number | null;
}

/** One opening-range breakout the desk saw. "taken" is paper-traded; "rejected" is replayed on the real bars
 *  at the close (the shadow); "stale" was seen too late to act on. */
export interface IntradayRow {
  day: string;
  symbol: string;
  trigger_time: string | null;
  decision: "taken" | "rejected" | "stale";
  reason: string | null;
  entry: number | null;
  stop: number | null;
  target: number | null;
  /** Time Machine: share of the 10,000 replays that hit the target first, and the stop first. */
  p_target: number | null;
  p_stop: number | null;
  /** Average replay result in R. */
  mc_r: number | null;
  /** The same rule on the last 60 days of real sessions: how often it fired and its average R. */
  hist_n: number | null;
  hist_r: number | null;
  verdict: string | null;
  /** Null until graded (taken: on exit; rejected: at the close). */
  outcome: "target" | "stop" | "flat" | null;
  exit_time: string | null;
  exit: number | null;
  r: number | null;
  /** Dollars, taken trades only. */
  pnl: number | null;
  shares: number | null;
  ctx?: { setups?: string[]; quality?: boolean; berkshire?: boolean; headlines?: number; [k: string]: unknown };
}

export interface IntradayDay {
  day: string;
  equity: number;
  spy: number | null;
  ret: number | null;
  spyRet: number | null;
  taken: number;
  rejected: number;
}

/** trade-bot tradebot/intraday.py export(). Before the first session only book, start, equity, curve (empty),
 *  today (empty), record (null), skills, status and filter are present. */
export interface Intraday {
  error?: string;
  book?: string;
  start?: number;
  equity?: number;
  spyEquity?: number | null;
  asOf?: string | null;
  /** Set before the first session, like "waiting for the first session". */
  status?: string;
  curve?: IntradayDay[];
  record?: {
    taken: IntradayStats;
    shadow: IntradayStats;
    /** Sessions graded against SPY, and the average daily return over SPY's open-to-close (a fraction). */
    days: number;
    excessMean: number | null;
    /** Context tags split out, like "quality:yes". */
    tags?: Record<string, IntradayStats>;
  } | null;
  open?: IntradayRow[];
  today?: IntradayRow[];
  staleToday?: number;
  recent?: IntradayRow[];
  /** As if it were real money: short- and long-term realized gains, wash-sale losses disallowed, closed lots. */
  tax?: { short: number; long: number; disallowed: number; count: number } | null;
  log?: { at: string; kind: string; text: string }[];
  skills?: { skill: string; role: string }[];
  filter?: string;
  rules?: { max_loss_per_trade_usd: number; max_daily_loss_usd: number; max_trades_per_day: number; no_entries_after: string; flat_by: string };
}

/** Enough of a check that a malformed post can't break the page. */
export function isSnapshot(x: unknown): x is MoneySnapshot {
  const s = x as MoneySnapshot;
  return !!s && s.version === 1 && typeof s.generatedAt === "string" && Array.isArray(s.books)
    && s.books.every((b) => typeof b.id === "string" && Array.isArray(b.curve) && Array.isArray(b.positions))
    && (s.phil === null || typeof s.phil === "object")
    && (s.intraday === undefined || s.intraday === null || typeof s.intraday === "object");
}
