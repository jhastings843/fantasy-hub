import "server-only";
import { getPicksCore } from "@/lib/picks/report";
import { loadIssued } from "@/lib/picks/issued-store";
import { confirmed } from "@/lib/picks/issued";
import { unitReport } from "@/lib/picks/units";
import { firstSends } from "@/lib/picks/update";
import type { League } from "@/lib/picks/parse";
import { propsWeeks, type PropsWeek } from "@/lib/props/store";

// The Money overview's two sports charts (Jack, 2026-10-19: "add a graph for
// props and a graph for picks across all sports"). Read-only, from the same
// records the Picks and Props pages total, so the numbers cannot disagree.
// NBA has no saved record yet (lib/picks/nba-store.ts), so picks are NFL and
// college until it does.

export interface PicksWeek {
  league: League;
  week: number;
  /** The last send that week, which dates it on the chart. */
  at: string;
  units: number;
  w: number;
  l: number;
  p: number;
}

const seasonOf = (d: Date) => (d.getUTCMonth() < 7 ? d.getUTCFullYear() - 1 : d.getUTCFullYear());

async function picksWeeks(league: League): Promise<PicksWeek[]> {
  const core = (await getPicksCore(league)).value;
  if (!core) return [];
  const issued = confirmed(await loadIssued(league, core.season));
  const sentAt = new Map<number, string>();
  for (const r of issued) if (!sentAt.has(r.week) || r.issuedAt > sentAt.get(r.week)!) sentAt.set(r.week, r.issuedAt);
  return unitReport(firstSends(issued), new Map(core.finals))
    .byWeek.filter((x) => x.ledger.w + x.ledger.l + x.ledger.p > 0 && sentAt.has(x.week))
    .map((x) => ({ league, week: x.week, at: sentAt.get(x.week)!, units: x.ledger.units, w: x.ledger.w, l: x.ledger.l, p: x.ledger.p }));
}

export interface SportsView {
  picks: PicksWeek[];
  props: PropsWeek[];
  problems: string[];
}

export async function getSportsView(now = new Date()): Promise<SportsView> {
  const problems: string[] = [];
  const safe = <T,>(what: string, p: Promise<T[]>) =>
    p.catch((e) => {
      problems.push(`${what}: ${e instanceof Error ? e.message : String(e)}`);
      return [] as T[];
    });
  const [nfl, cfb, props] = await Promise.all([safe("NFL picks", picksWeeks("nfl")), safe("college picks", picksWeeks("cfb")), safe("props", propsWeeks(seasonOf(now)))]);
  return { picks: [...nfl, ...cfb].sort((a, b) => a.at.localeCompare(b.at)), props, problems };
}
