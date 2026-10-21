// Injury news, NBA (Jack 2026-10-21: the edge pros like Calvin describe is
// pricing a teammate's prop the minute a player is ruled out, before the book
// moves). Pure helpers; the IO lives in news-store.ts.
//
// 1. Read ESPN's league injury feed and keep each player's status.
// 2. A change is news when a rotation player on a team playing today (game
//    not started) goes Out, or comes back from Out.
// 3. The game is repriced at once (store.ts, runOurNbaProps with `only`), and
//    every teammate prop whose number moved is logged with DraftKings' line
//    and price at that moment.
// 4. Graded later: did DraftKings move toward our new number by tip (line or
//    no-vig chance), and did the side win.

import type { PropMarket } from "@/lib/props/parse";
import { implied } from "@/lib/props/parse";
import { noVig } from "./market";

export interface FeedEntry {
  id: string;
  name: string;
  team: string;
  status: string;
  comment: string;
  date?: string;
}

interface EspnInjuries {
  injuries?: {
    injuries?: {
      status?: string;
      date?: string;
      shortComment?: string;
      athlete?: { displayName?: string; links?: { href?: string }[]; team?: { abbreviation?: string } };
    }[];
  }[];
}

export function readFeed(d: EspnInjuries): FeedEntry[] {
  const out: FeedEntry[] = [];
  for (const t of d.injuries ?? [])
    for (const i of t.injuries ?? []) {
      const id = i.athlete?.links?.map((l) => /\/id\/(\d+)/.exec(l.href ?? "")?.[1]).find(Boolean);
      if (!id) continue;
      out.push({ id, name: i.athlete?.displayName ?? "", team: i.athlete?.team?.abbreviation ?? "", status: i.status ?? "", comment: i.shortComment ?? "", ...(i.date ? { date: i.date } : {}) });
    }
  return out;
}

export interface StatusChange {
  id: string;
  name: string;
  team: string;
  change: "out" | "back";
  comment: string;
}

/**
 * Changes since the last read. `prev` is athlete id -> status at the last
 * read; a player missing from the feed is available. Only "Out" counts as out,
 * the same rule the model uses.
 */
export function changes(prev: { [id: string]: string }, now: FeedEntry[], names: { [id: string]: { name: string; team: string } } = {}): StatusChange[] {
  const cur = new Map(now.map((e) => [e.id, e]));
  const out: StatusChange[] = [];
  for (const e of now) if (e.status === "Out" && prev[e.id] !== "Out") out.push({ id: e.id, name: e.name, team: e.team, change: "out", comment: e.comment });
  for (const [id, st] of Object.entries(prev))
    if (st === "Out" && cur.get(id)?.status !== "Out") {
      const e = cur.get(id);
      out.push({ id, name: e?.name ?? names[id]?.name ?? id, team: e?.team ?? names[id]?.team ?? "", change: "back", comment: e?.comment ?? "no longer listed out" });
    }
  return out;
}

export interface Affected {
  id: string;
  player: string;
  team: string;
  stat: string;
  line: number;
  before: number;
  after: number;
  /** Our side after the news, its DK price, our chance and edge over DK's no-vig chance (null when DK has one side only). */
  side: "over" | "under";
  price: number | null;
  chance: number;
  gap: number | null;
  /** DK's no-vig chance of our side at the news. */
  fair: number | null;
  /** Our edge clears DK's price and the player has 3+ games this season. */
  edge: boolean;
}

/** Teammate markets whose number moved by at least `minMove`, biggest move first. */
export function affected(
  before: PropMarket[],
  after: PropMarket[],
  extra: { [id: string]: { over: number; under: number; games?: number } },
  minMove = 0.3,
  minGames = 3,
): Affected[] {
  const old = new Map(before.map((m) => [m.id, m]));
  const out: Affected[] = [];
  for (const m of after) {
    const o = old.get(m.id);
    if (!o || o.model === null || m.model === null || Math.abs(m.model - o.model) < minMove) continue;
    const side: "over" | "under" = m.side ?? (m.model >= m.line ? "over" : "under");
    const dk = m.books[0];
    const price = dk?.[side] ?? null;
    const x = extra[m.id];
    const fair = dk?.over != null && dk?.under != null ? noVig(dk.over, dk.under)[side] : null;
    out.push({
      id: m.id,
      player: m.player,
      team: m.team,
      stat: m.stat ?? m.statLabel,
      line: m.line,
      before: o.model,
      after: m.model,
      side,
      price,
      chance: x?.[side] ?? 0.5,
      gap: fair !== null && x ? Math.round((x[side] - fair) * 1000) / 1000 : null,
      fair,
      edge: m.clears && m.side === side && (x?.games ?? 0) >= minGames,
    });
  }
  return out.sort((a, b) => Math.abs(b.after - b.before) - Math.abs(a.after - a.before));
}

export interface Followup {
  /** DK at the last pregame copy: line and no-vig chance of our side. */
  line: number | null;
  fair: number | null;
  /** Points the line moved our way (+ = toward us), and the no-vig chance's move our way. */
  lineMove: number | null;
  fairMove: number | null;
  outcome?: "W" | "L" | "P";
}

/** How DK moved after the news, judged at its last pregame line for the same market. */
export function followup(a: Affected, last: PropMarket | undefined, outcome?: "W" | "L" | "P"): Followup {
  if (!last) return { line: null, fair: null, lineMove: null, fairMove: null, ...(outcome ? { outcome } : {}) };
  const dk = last.books[0];
  const fair = dk?.over != null && dk?.under != null ? noVig(dk.over, dk.under)[a.side] : dk?.[a.side] != null ? implied(dk[a.side]!) : null;
  const dir = a.side === "over" ? 1 : -1;
  return {
    line: last.line,
    fair,
    lineMove: Math.round(dir * (last.line - a.line) * 10) / 10,
    fairMove: fair !== null && a.fair !== null && last.line === a.line ? Math.round((fair - a.fair) * 1000) / 1000 : null,
    ...(outcome ? { outcome } : {}),
  };
}
