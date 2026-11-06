import type { Action, Holding, HistoryPoint, Idea, PortfolioSnapshot } from "./types";

// Pure helpers for the Portfolio page: formatting, grouping, staleness. No I/O,
// so they test without Redis or cookies.

const MINUS = "−";
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** $93,394 (whole dollars), or $673.97 with cents. Negative gets a real minus sign. */
export function usd(v: number | null | undefined, cents = false): string {
  if (!isNum(v)) return "n/a";
  const s = Math.abs(v).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: cents ? 2 : 0,
    maximumFractionDigits: cents ? 2 : 0,
  });
  return v < 0 ? `${MINUS}${s}` : s;
}

/** Always signed: +$1,204 / −$3,089. */
export function usdSigned(v: number | null | undefined): string {
  if (!isNum(v)) return "n/a";
  return v > 0 ? `+${usd(v)}` : usd(v);
}

/** Always signed: +1.2% / −3.2%. */
export function pctSigned(v: number | null | undefined, digits = 1): string {
  if (!isNum(v)) return "n/a";
  const s = `${Math.abs(v).toFixed(digits)}%`;
  return v > 0 ? `+${s}` : v < 0 ? `${MINUS}${s}` : s;
}

export function pct(v: number | null | undefined, digits = 1): string {
  return isNum(v) ? `${v.toFixed(digits)}%` : "n/a";
}

export function num(v: number | null | undefined, digits = 0): string {
  return isNum(v) ? v.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits }) : "n/a";
}

export type Sign = "pos" | "neg" | undefined;
export const sign = (v: number | null | undefined): Sign => (!isNum(v) || v === 0 ? undefined : v > 0 ? "pos" : "neg");

/** "Thu, Nov 5, 6:40 PM ET". */
export function etTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const s = d.toLocaleString("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  return `${s} ET`;
}

/** "Nov 5" from "2026-11-05" (a calendar date, no time zone shift). */
export function shortDate(ymd: string | null | undefined): string {
  if (!ymd) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return ymd;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

const dayNum = (ymd: string) => {
  const t = Date.parse(`${ymd}T00:00:00Z`);
  return Number.isNaN(t) ? null : t / 86_400_000;
};

/** The notes SNAPSHOT.md asks for: old holdings file, advice that didn't run, missing quotes. */
export function staleNotes(s: PortfolioSnapshot): string[] {
  const notes: string[] = [];
  if (s.holdingsFrom && s.priceDate) {
    const a = dayNum(s.holdingsFrom);
    const b = dayNum(s.priceDate);
    if (a !== null && b !== null && b - a > 7) {
      notes.push(`Holdings are from ${shortDate(s.holdingsFrom)}. Download a new positions file from Fidelity after you trade.`);
    }
  }
  if (!s.advisor) notes.push("Today's advice didn't run; numbers are current.");
  const missing = (s.missingQuotes ?? []).filter((q) => typeof q === "string");
  if (missing.length) notes.push(`No quote today for ${missing.join(", ")}, so those use the last price.`);
  return notes;
}

export const ACTION_GROUPS: { kind: string; label: string }[] = [
  { kind: "sell", label: "Sell" },
  { kind: "buy", label: "Buy now" },
  { kind: "limit", label: "Buy at a set price" },
  { kind: "wait", label: "Wait" },
  { kind: "hold", label: "Hold" },
];

/** Actions in the page's order: Sell, Buy now, Buy at a set price, Wait, Hold. Unknown kinds go last. */
export function groupActions(actions: Action[] | undefined): { kind: string; label: string; items: Action[] }[] {
  const list = (actions ?? []).filter((a) => a && typeof a.kind === "string");
  const known = new Set(ACTION_GROUPS.map((g) => g.kind));
  const groups = ACTION_GROUPS.map((g) => ({ ...g, items: list.filter((a) => a.kind === g.kind) }));
  const other = list.filter((a) => !known.has(a.kind));
  if (other.length) groups.push({ kind: "other", label: "Other", items: other });
  return groups.filter((g) => g.items.length);
}

/** "tax loss $597" / "taxable gain $163", or null when there is no tax line. */
export function taxLine(tax: number | null | undefined): string | null {
  if (!isNum(tax) || tax === 0) return null;
  return tax < 0 ? `tax loss ${usd(-tax)}` : `taxable gain ${usd(tax)}`;
}

/** Ideas with "ready" first, then watching (and anything unlabelled), then "dropped" last. Missing is []. */
export function sortIdeas(ideas: Idea[] | undefined): Idea[] {
  const rank = (s: string | undefined) => (s === "ready" ? 0 : s === "dropped" ? 2 : 1);
  return (ideas ?? [])
    .filter((i) => i && typeof i.symbol === "string")
    .map((i, n) => ({ i, n }))
    .sort((a, b) => rank(a.i.status) - rank(b.i.status) || a.n - b.n)
    .map(({ i }) => i);
}

export const BUCKETS: { key: string; label: string; match: string[] }[] = [
  { key: "core", label: "Core", match: ["core"] },
  { key: "bet", label: "Bets", match: ["bet", "bets"] },
  { key: "employer", label: "Employer", match: ["employer"] },
  { key: "cash", label: "Cash", match: ["cash"] },
];

/** Holdings by bucket (core, bets, employer, cash, then anything else), biggest first, with a subtotal. */
export function groupHoldings(holdings: Holding[]): { key: string; label: string; items: Holding[]; value: number }[] {
  const byValue = (a: Holding, b: Holding) => (b.value ?? 0) - (a.value ?? 0);
  const all = holdings.filter((h) => h && typeof h.symbol === "string");
  const used = new Set<Holding>();
  const groups = BUCKETS.map((b) => {
    const items = all.filter((h) => b.match.includes(String(h.bucket ?? "").toLowerCase())).sort(byValue);
    items.forEach((h) => used.add(h));
    return { key: b.key, label: b.label, items, value: items.reduce((t, h) => t + (h.value ?? 0), 0) };
  });
  const rest = all.filter((h) => !used.has(h)).sort(byValue);
  if (rest.length) groups.push({ key: "other", label: "Other", items: rest, value: rest.reduce((t, h) => t + (h.value ?? 0), 0) });
  return groups.filter((g) => g.items.length);
}

/** Total and S&P, each indexed to 100 at the first point that has it. Empty when fewer than 2 points. */
export function indexHistory(history: HistoryPoint[] | undefined): { total: { x: number; y: number }[]; spx: { x: number; y: number }[] } {
  const pts = (history ?? [])
    .filter((p) => p && isNum(p.total) && !Number.isNaN(Date.parse(`${p.date}T12:00:00Z`)))
    .map((p) => ({ ...p, x: Date.parse(`${p.date}T12:00:00Z`) }))
    .sort((a, b) => a.x - b.x);
  if (pts.length < 2) return { total: [], spx: [] };
  const t0 = pts[0].total;
  const total = t0 ? pts.map((p) => ({ x: p.x, y: (p.total / t0) * 100 })) : [];
  const withSpx = pts.filter((p) => isNum(p.spx) && p.spx > 0);
  const s0 = withSpx[0]?.spx as number | undefined;
  const spx = s0 && withSpx.length >= 2 ? withSpx.map((p) => ({ x: p.x, y: ((p.spx as number) / s0) * 100 })) : [];
  return { total, spx };
}

/** A sleeve against its cap: over when past it. */
export function capState(value: number | null | undefined, cap: number | null | undefined): "over" | "near" | "ok" | "unknown" {
  if (!isNum(value) || !isNum(cap) || cap <= 0) return "unknown";
  if (value > cap) return "over";
  if (value >= cap * 0.9) return "near";
  return "ok";
}
