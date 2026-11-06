import type { Move, PortfolioSnapshot } from "./types";

// Portfolio moves for the Today page (Jack, 2026-11-05: "add any market moves to
// today if they come up that day, similar to waivers"). Only what is due on this
// Eastern date: advisor actions dated today, a cash-plan trigger that hit or a
// backstop that lands today, and ideas the advisor marked ready. Nothing due, no
// section, the same way claims only show when there are claims.

export interface TodayMove {
  key: string;
  kind: "sell" | "buy" | "limit" | "cash" | "idea" | "swap" | "done";
  /** From the trade monitor: todo = alerted and not placed yet, held = waiting on purpose. */
  status?: "todo" | "held" | "done";
  symbol: string;
  amount: number | null;
  detail: string;
  reason: string;
}

const DATE = /\b(\d{4}-\d{2}-\d{2})\b/;

/** "2026-11-06" for the Eastern calendar day of `now`. */
export function etDate(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

const moveSymbol = (m: Move) => (m.kind === "swap" && m.sell ? `${m.sell} to ${m.buy ?? "?"}` : (m.buy ?? m.sell ?? m.id));
const moveDetail = (m: Move) =>
  m.kind === "swap" ? `Sell all ${m.sell ?? ""}, then buy ${m.buy ?? ""} with the proceeds${m.sellOrder ? ` (${m.sellOrder})` : ""}` : (m.order ?? "");
const md = (ymd?: string) => {
  const d = ymd ? new Date(`${ymd}T12:00:00Z`) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) : (ymd ?? "");
};

/**
 * Trades from the Mac's monitor, as they stand right now (reposted after every
 * monitor check and every new Fidelity file). Alerted but not placed: one row
 * each. Held: one row each with why and when it's looked at again. Placed
 * today: folded into one "Done today" row so a 16-swap morning stays short.
 */
export function monitorMoves(moves: Move[] | undefined, today: string): TodayMove[] {
  const out: TodayMove[] = [];
  const done: Move[] = [];
  (moves ?? []).forEach((m, i) => {
    if (m.status === "alerted") {
      out.push({ key: `m${i}`, kind: m.kind === "swap" ? "swap" : m.kind === "limit" ? "limit" : "cash", status: "todo", symbol: moveSymbol(m), amount: m.amount ?? null, detail: moveDetail(m), reason: m.alertedAt ? `Alerted ${m.alertedAt.slice(11)}${m.alertedAt.slice(0, 10) === today ? "" : ` on ${md(m.alertedAt.slice(0, 10))}`}. Not placed yet.` : "Not placed yet." });
    } else if (m.status === "held") {
      out.push({ key: `m${i}`, kind: m.kind === "swap" ? "swap" : m.kind === "limit" ? "limit" : "cash", status: "held", symbol: moveSymbol(m), amount: m.amount ?? null, detail: m.revisit ? `Held until ${md(m.revisit)}` : "Held", reason: m.heldReason ?? "" });
    } else if (m.status === "done" && m.alertedAt?.slice(0, 10) === today) {
      done.push(m);
    }
  });
  if (done.length) {
    const total = done.reduce((n, m) => n + (m.amount ?? 0), 0);
    out.push({ key: "done", kind: "done", status: "done", symbol: `${done.length} placed today`, amount: total || null, detail: done.map(moveSymbol).join(", "), reason: "" });
  }
  return out;
}

export function todayMoves(s: PortfolioSnapshot | null, today: string): TodayMove[] {
  if (!s) return [];
  const out: TodayMove[] = monitorMoves(s.moves, today);
  // Once the monitor tracks a name, its row above is the live one; skip the advisor's static row for it.
  const tracked = new Set((s.moves ?? []).flatMap((m) => [m.sell, m.buy]).filter(Boolean) as string[]);
  (s.advisor?.actions ?? []).forEach((a, i) => {
    if (a.kind !== "sell" && a.kind !== "buy" && a.kind !== "limit") return;
    if (a.symbol && tracked.has(a.symbol)) return;
    const when = a.when ?? "";
    // "by 2026-11-20" is a deadline, not a day to act; only an exact date counts.
    if (/^by\b/i.test(when.trim()) || DATE.exec(when)?.[1] !== today) return;
    out.push({ key: `a${i}`, kind: a.kind, symbol: a.symbol ?? "", amount: a.amount ?? null, detail: a.detail ?? "", reason: a.reason ?? "" });
  });
  (s.cashPlan ?? []).forEach((c, i) => {
    const hit = c.status === "trigger hit";
    const due = c.backstop === today;
    if (!hit && !due) return;
    out.push({
      key: `c${i}`,
      kind: "cash",
      symbol: c.buy ?? "",
      amount: c.amount ?? null,
      detail: c.label ?? "",
      reason: hit ? `The S&P closed at or below ${c.trigger_spx?.toLocaleString("en-US") ?? "the trigger"}. Check that the limit order filled.` : "Backstop date: if the limit order hasn't filled, cancel it and buy at market.",
    });
  });
  (s.advisor?.ideas ?? []).forEach((d, i) => {
    if (d.status !== "ready") return;
    out.push({ key: `i${i}`, kind: "idea", symbol: d.symbol, amount: d.size ?? null, detail: d.entry ? `Buy when: ${d.entry}` : "", reason: d.thesis ?? "" });
  });
  return out;
}
