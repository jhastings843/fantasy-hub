// The portfolio snapshot Jack's Mac posts after the daily run (stocks repo,
// SNAPSHOT.md, version 1). Field names match that file; change both together.
// Only version, asOf, totals and holdings are promised. Everything else can be
// missing, so the page treats every other field as optional.

export type Bucket = "core" | "bet" | "employer" | "cash";
export type Stance = "defensive" | "neutral" | "constructive";
export type Call = "down" | "flat" | "up";
export type ActionKind = "sell" | "buy" | "limit" | "wait" | "hold";

export interface Totals {
  total: number;
  dayChange?: number | null;
  dayChangePct?: number | null;
  cash?: number | null;
  cashPct?: number | null;
}

export interface Account {
  name: string;
  value?: number | null;
  dayChange?: number | null;
}

export interface Holding {
  symbol: string;
  name?: string | null;
  account?: string | null;
  bucket?: Bucket | string | null;
  qty?: number | null;
  price?: number | null;
  value?: number | null;
  dayChange?: number | null;
  gainLoss?: number | null;
  gainLossPct?: number | null;
  /** % of total. */
  weight?: number | null;
}

export interface Sleeve {
  value?: number | null;
  pct?: number | null;
  capPct?: number | null;
  names?: string[];
}

export interface Employer {
  value?: number | null;
  pctOfBrokerage?: number | null;
  capPct?: number | null;
}

export interface Market {
  spx?: number | null;
  spxDayPct?: number | null;
  spxRecord?: number | null;
  spxDrawdownPct?: number | null;
  ndx?: number | null;
  ndxDayPct?: number | null;
  vix?: number | null;
  tenYear?: number | null;
}

export interface CashStep {
  label?: string;
  amount?: number | null;
  buy?: string | null;
  trigger_spx?: number | null;
  backstop?: string | null;
  status?: "waiting" | "trigger hit" | "backstop due" | string;
  /** How far the S&P is from the trigger, null if no trigger. */
  distancePct?: number | null;
}

export interface WatchItem {
  signal?: string;
  symbol?: string;
  warn_above?: number | null;
  calm_below?: number | null;
  now?: number | null;
  status?: "warn" | "normal" | "calm" | string;
}

export interface CalendarItem {
  date: string;
  event: string;
  symbol?: string | null;
}

export interface HistoryPoint {
  date: string;
  total: number;
  spx?: number | null;
}

export interface Outlook {
  horizon: "days" | "weeks" | "months" | string;
  call?: Call | string;
  confidence?: "low" | "med" | "high" | string;
  reason?: string;
  signal?: string;
}

export interface Action {
  kind: ActionKind | string;
  symbol?: string;
  amount?: number | null;
  detail?: string;
  reason?: string;
  when?: string;
  /** Realized gain (+) or loss (-) if done. */
  tax?: number | null;
}

export interface SourceLink {
  title?: string;
  text?: string;
  source?: string;
  url?: string;
  date?: string;
}

/** Something Jack doesn't own yet, worth a look. Not limited to what he holds. */
export interface Idea {
  symbol: string;
  name?: string;
  type?: "stock" | "etf" | "ipo" | string;
  /** Which part of the plan it would join. */
  fit?: "core" | "bet" | string;
  thesis?: string;
  risk?: string;
  /** The price, date or event that would trigger a buy. */
  entry?: string;
  /** Dollars, from new cash. */
  size?: number | null;
  /** The holding it would swap out, null if none. */
  replaces?: string | null;
  status?: "watching" | "ready" | "dropped" | string;
  source?: string;
  added?: string;
}

export interface Advisor {
  headline?: string;
  stance?: Stance | string;
  summary?: string;
  marketRead?: SourceLink[];
  outlook?: Outlook[];
  actions?: Action[];
  changes?: string[];
  /** Treated as [] when missing. */
  ideas?: Idea[];
  sources?: SourceLink[];
  disclaimer?: string;
}

export interface TrackGroup {
  key: string;
  label?: string;
  scored?: number;
  hits?: number;
  /** Whole percent, null until something is scored. */
  hitRate?: number | null;
  pending?: number;
  /** True once there are enough scored calls for a lesson. */
  enough?: boolean;
}

export interface TrackResult {
  date?: string;
  group?: string;
  label?: string;
  symbol?: string;
  call?: string;
  result?: "hit" | "miss" | string;
  detail?: string;
}

/** One logged advisor call (learn.py). "due" is when it gets graded (an estimate until graded). */
export interface TrackCall {
  logged: string;
  group?: string;
  label?: string;
  symbol?: string;
  call?: string;
  confidence?: string | null;
  text?: string;
  status?: "pending" | "hit" | "miss" | "void" | string;
  due?: string | null;
  detail?: string | null;
}

/** From learn.py on Jack's Mac (code): the advisor's past calls graded against real closes. */
export interface TrackRecord {
  asOf?: string;
  minForLesson?: number;
  logged?: number;
  firstLogged?: string | null;
  oldestPending?: string | null;
  groups?: TrackGroup[];
  recent?: TrackResult[];
  lessons?: string[];
  log?: TrackCall[];
}

/** A trade the Mac's monitor is timing (stocks state/monitor.json), with where it stands. */
export interface Move {
  id: string;
  /** swap = sell one name and buy its replacement with the proceeds; limit = a GTC limit order; cash = new money. */
  kind?: "swap" | "limit" | "cash" | string;
  sell?: string;
  buy?: string;
  amount?: number | null;
  tax?: number | null;
  /** open = not decided yet, alerted = Jack was told to do it, held = waiting on purpose, done = placed. */
  status?: "open" | "alerted" | "held" | "done" | string;
  /** "2026-11-06 10:00" Eastern. */
  alertedAt?: string;
  heldReason?: string;
  revisit?: string;
  deadline?: string;
  order?: string;
  sellOrder?: string;
}

export interface PortfolioSnapshot {
  version: 1;
  asOf: string;
  priceDate?: string;
  holdingsFrom?: string;
  holdingsFile?: string;
  totals: Totals;
  accounts?: Account[];
  holdings: Holding[];
  sleeve?: Sleeve | null;
  employer?: Employer | null;
  market?: Market | null;
  cashPlan?: CashStep[];
  watch?: WatchItem[];
  calendar?: CalendarItem[];
  missingQuotes?: string[];
  history?: HistoryPoint[];
  advisor?: Advisor | null;
  trackRecord?: TrackRecord | null;
  moves?: Move[];
  movesAt?: string;
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const optArray = (v: unknown) => v === undefined || v === null || Array.isArray(v);
const optObj = (v: unknown) => v === undefined || v === null || isObj(v);
const optStr = (v: unknown) => v === undefined || v === null || typeof v === "string";

/**
 * A version 1 snapshot: the four promised fields typed, every list a list,
 * every nested block an object. Anything else is refused at the door.
 */
export function isPortfolioSnapshot(x: unknown): x is PortfolioSnapshot {
  if (!isObj(x)) return false;
  if (x.version !== 1 || typeof x.asOf !== "string" || Number.isNaN(Date.parse(x.asOf))) return false;
  const t = x.totals;
  if (!isObj(t) || !isNum(t.total)) return false;
  for (const k of ["dayChange", "dayChangePct", "cash", "cashPct"]) {
    if (t[k] !== undefined && t[k] !== null && !isNum(t[k])) return false;
  }
  if (!Array.isArray(x.holdings) || !x.holdings.every((h) => isObj(h) && typeof h.symbol === "string")) return false;
  for (const k of ["priceDate", "holdingsFrom", "holdingsFile"]) if (!optStr(x[k])) return false;
  for (const k of ["accounts", "cashPlan", "watch", "calendar", "missingQuotes", "history", "moves"]) if (!optArray(x[k])) return false;
  for (const k of ["sleeve", "employer", "market", "advisor", "trackRecord"]) if (!optObj(x[k])) return false;
  if (Array.isArray(x.history) && !x.history.every((p) => isObj(p) && typeof p.date === "string" && isNum(p.total))) return false;
  if (Array.isArray(x.moves) && !x.moves.every((m) => isObj(m) && typeof m.id === "string")) return false;
  if (!optStr(x.movesAt)) return false;
  if (isObj(x.trackRecord)) {
    const r = x.trackRecord;
    for (const k of ["groups", "recent", "lessons", "log"]) if (!optArray(r[k])) return false;
    if (Array.isArray(r.log) && !r.log.every((c) => isObj(c) && typeof c.logged === "string")) return false;
    if (Array.isArray(r.groups) && !r.groups.every((g) => isObj(g) && typeof g.key === "string")) return false;
  }
  if (isObj(x.advisor)) {
    const a = x.advisor;
    for (const k of ["marketRead", "outlook", "actions", "changes", "ideas", "sources"]) if (!optArray(a[k])) return false;
    if (Array.isArray(a.actions) && !a.actions.every((r) => isObj(r) && typeof r.kind === "string")) return false;
    if (Array.isArray(a.ideas) && !a.ideas.every((r) => isObj(r) && typeof r.symbol === "string")) return false;
  }
  return true;
}
