import type { PortfolioSnapshot } from "./types";

// Portfolio moves for the Today page (Jack, 2026-11-05: "add any market moves to
// today if they come up that day, similar to waivers"). Only what is due on this
// Eastern date: advisor actions dated today, a cash-plan trigger that hit or a
// backstop that lands today, and ideas the advisor marked ready. Nothing due, no
// section, the same way claims only show when there are claims.

export interface TodayMove {
  key: string;
  kind: "sell" | "buy" | "limit" | "cash" | "idea";
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

export function todayMoves(s: PortfolioSnapshot | null, today: string): TodayMove[] {
  if (!s) return [];
  const out: TodayMove[] = [];
  (s.advisor?.actions ?? []).forEach((a, i) => {
    if (a.kind !== "sell" && a.kind !== "buy" && a.kind !== "limit") return;
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
