import { NFL_TEAMS } from "./teams";

/** Team abbr -> percent of the pool, the shape weeklyPicks stores. */
export type PastePicks = Record<string, number>;

export type PasteParse =
  | { ok: true; picks: PastePicks; read: "percent" | "count" }
  | { ok: false; error: string };

export interface PasteContext {
  /** Entries alive now. The floor for a count paste, since alive only falls. */
  entriesAlive: number;
  /** Entries at the start of the season. The ceiling for a count paste. */
  poolSize: number;
}

/**
 * Reads what a pool's distribution screen looks like when you copy it: a team
 * key and a number per line, in any order, with or without a percent sign.
 *
 * A 30-entry pool's screen shows COUNTS, not percentages: "LAC 11, JAX 7" sums
 * to 30. Percentages are tried first so a 100-entry pool reads either way. A
 * count paste is accepted anywhere between three quarters of the entries alive
 * now and the season's starting size, because an EARLIER week's count sums to
 * the entries alive back then, which lies between those two numbers. The old
 * check only allowed a band around today's count, so editing Week 1 after a
 * few eliminations was rejected as "neither a percentage nor a count".
 */
export function parsePickPaste(text: string, ctx: PasteContext): PasteParse {
  const valid = new Set(NFL_TEAMS.map((t) => t.abbr));
  const picks: PastePicks = {};
  for (const line of text.split("\n")) {
    const m = line.trim().match(/^([A-Za-z]{2,4})\b[^0-9]*([0-9]+(?:\.[0-9]+)?)\s*%?/);
    if (!m) continue;
    const abbr = m[1].toUpperCase();
    if (!valid.has(abbr)) continue;
    picks[abbr] = Number(m[2]);
  }
  if (Object.keys(picks).length < 2) {
    return { ok: false, error: "Could not read two teams out of that. One team and one number per line." };
  }
  const total = Object.values(picks).reduce((a, b) => a + b, 0);
  if (total >= 50 && total <= 150) return { ok: true, picks, read: "percent" };

  const floor = Math.max(2, ctx.entriesAlive * 0.75);
  const ceiling = Math.max(ctx.poolSize, ctx.entriesAlive) * 1.05;
  if (total >= floor && total <= ceiling) {
    const asPercent: PastePicks = {};
    for (const [k, v] of Object.entries(picks)) asPercent[k] = (v / total) * 100;
    return { ok: true, picks: asPercent, read: "count" };
  }
  return {
    ok: false,
    error: `Those add up to ${total.toFixed(1)}, which is neither a percentage distribution nor a count of entries (${ctx.entriesAlive} alive now, ${ctx.poolSize} to start).`,
  };
}

/**
 * The inverse, for editing: what a saved week looks like back in the box.
 * Biggest share first so the chalk is at the top, one decimal, one per line.
 */
export function formatPickPaste(picks: PastePicks): string {
  return Object.entries(picks)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([team, v]) => `${team} ${v.toFixed(1)}%`)
    .join("\n");
}
