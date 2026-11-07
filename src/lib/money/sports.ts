import "server-only";
import { getPicksCore } from "@/lib/picks/report";
import { loadIssued } from "@/lib/picks/issued-store";
import { confirmed } from "@/lib/picks/issued";
import { unitReport } from "@/lib/picks/units";
import { firstSends } from "@/lib/picks/update";
import type { League } from "@/lib/picks/parse";
import { ourProps, type OurPropsType, type OurPropsWeek } from "@/lib/models/money";

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


/** A league's weeks plus its season total. The total comes from the season
 *  ledger, not the sum of the rounded weekly ledgers, so it matches Today and
 *  /records to the cent (they read the same ledger; 2026-11-06 the week sum was
 *  -4.14u against their -4.15u). */
interface PicksLeague { weeks: PicksWeek[]; total: { units: number; w: number; l: number; p: number } }

async function picksWeeks(league: League): Promise<PicksLeague> {
  const core = (await getPicksCore(league)).value;
  if (!core) return { weeks: [], total: { units: 0, w: 0, l: 0, p: 0 } };
  const issued = confirmed(await loadIssued(league, core.season));
  const sentAt = new Map<number, string>();
  for (const r of issued) if (!sentAt.has(r.week) || r.issuedAt > sentAt.get(r.week)!) sentAt.set(r.week, r.issuedAt);
  const report = unitReport(firstSends(issued), new Map(core.finals));
  const t = report.total;
  const weeks = report
    .byWeek.filter((x) => x.ledger.w + x.ledger.l + x.ledger.p > 0 && sentAt.has(x.week))
    .map((x) => ({ league, week: x.week, at: sentAt.get(x.week)!, units: x.ledger.units, w: x.ledger.w, l: x.ledger.l, p: x.ledger.p }));
  return { weeks, total: { units: t.units, w: t.w, l: t.l, p: t.p } };
}

export interface SportsView {
  picks: PicksWeek[];
  /** Season totals per league from the season ledger; use these for any headline number. */
  picksTotals: ({ league: League } & PicksLeague["total"])[];
  /** Our props models (Sam's props record is no longer shown, Jack 2026-10-21). */
  props: OurPropsWeek[];
  /** The same edges split by prop type, for the Props row's breakdown. */
  propTypes: OurPropsType[];
  problems: string[];
}

export async function getSportsView(now = new Date()): Promise<SportsView> {
  const problems: string[] = [];
  const safe = (what: string, p: Promise<PicksLeague>) =>
    p.catch((e): PicksLeague => {
      problems.push(`${what}: ${e instanceof Error ? e.message : String(e)}`);
      return { weeks: [], total: { units: 0, w: 0, l: 0, p: 0 } };
    });
  const [nfl, cfb, props] = await Promise.all([
    safe("NFL picks", picksWeeks("nfl")),
    safe("college picks", picksWeeks("cfb")),
    ourProps(now).catch((e) => {
      problems.push(`props: ${e instanceof Error ? e.message : String(e)}`);
      return { weeks: [], byType: [] };
    }),
  ]);
  return {
    picks: [...nfl.weeks, ...cfb.weeks].sort((a, b) => a.at.localeCompare(b.at)),
    picksTotals: [{ league: "nfl" as League, ...nfl.total }, { league: "cfb" as League, ...cfb.total }],
    props: props.weeks, propTypes: props.byType, problems };
}
