// Today's spotlight (Jack, 2026-11-13): the teal box is the next best bet. Only
// something big from the last few hours takes it over: a props slice going live
// or being rolled back, or a portfolio trade the monitor says to place now.
// Claims and lineup changes never take it; they live in their own sections.

import type { JournalLine } from "@/lib/learning/engine";
import type { TodayMove } from "@/lib/portfolio/today";

/** How long a big event holds the box. */
export const BIG_WINDOW_MS = 3 * 3_600_000;

export interface BigNews {
  key: string;
  label: string;
  verb: string;
  reason: string;
  href: string;
  at: string;
}

export interface ProductJournal {
  name: string;
  href: string;
  journal: JournalLine[];
}

/** Newest big event inside the window, else null (then the bet keeps the box). */
export function bigNews(
  products: ProductJournal[],
  portfolio: { at?: string; moves: TodayMove[] } | null,
  now: Date,
): BigNews | null {
  const fresh = (at?: string) => {
    const t = at ? Date.parse(at) : NaN;
    return Number.isFinite(t) && t <= now.getTime() + 60_000 && now.getTime() - t <= BIG_WINDOW_MS;
  };
  const out: BigNews[] = [];
  for (const p of products) {
    for (const j of p.journal) {
      if ((j.kind === "activated" || j.kind === "rolled back") && fresh(j.at)) {
        out.push({
          key: `slice-${p.name}-${j.id ?? j.at}`,
          label: j.kind === "activated" ? `Now staking · ${p.name}` : `Rolled back · ${p.name}`,
          verb: j.kind === "activated" ? "A slice just went live with real stakes." : "A live slice was just pulled back to tracking.",
          reason: j.text,
          href: p.href,
          at: j.at,
        });
      }
    }
  }
  if (portfolio && fresh(portfolio.at)) {
    const todo = portfolio.moves.filter((m) => m.status === "todo");
    if (todo.length) {
      const m = todo[0];
      out.push({
        key: `portfolio-${m.key}`,
        label: "Portfolio · do now",
        verb: `${m.kind === "sell" ? "Sell" : m.kind === "buy" || m.kind === "idea" ? "Buy" : m.kind === "limit" ? "Set a limit on" : "Act on"} ${m.symbol}${m.amount ? `, $${Math.round(m.amount).toLocaleString("en-US")}` : ""}.${todo.length > 1 ? ` ${todo.length - 1} more waiting.` : ""}`,
        reason: [m.detail, m.reason].filter(Boolean).join(" · "),
        href: "/portfolio",
        at: portfolio.at!,
      });
    }
  }
  return out.sort((a, b) => b.at.localeCompare(a.at))[0] ?? null;
}
