// Every model's record for one league and market, in one expandable block at
// the top of the Learner log (Jack, 2026-10-31: "a place I can see our models
// records on the learner page for each model... make it expandable").
// Records come from the same stores the Research cards read.
import { cache } from "react";
import type { League } from "@/lib/picks/parse";
import type { PicksReport } from "@/lib/picks/report";
import type { NbaPicksView } from "@/lib/picks/nba-track-store";
import { loadForecasts } from "@/lib/picks/forecasts";
import { closingLines } from "@/lib/picks/closing-store";
import { signalRecords, trackedGames } from "@/lib/models/nfl/spread-track";
import { getCfbModelView } from "@/lib/models/cfb/store";
import { getNbaGameModelView } from "@/lib/models/nba/game-store";
import { BREAK_EVEN } from "@/lib/picks/engine";
import { CutRanges, type CutRow } from "./board";
import type { Market } from "./ui";

type R = { w: number; l: number; p?: number; units?: number };
const row = (label: string, r: R | null | undefined, be: number | undefined = BREAK_EVEN): CutRow[] =>
  r && r.w + r.l + (r.p ?? 0) > 0 ? [{ label, w: r.w, l: r.l, p: r.p, units: r.units, be }] : [];

/** Our NFL spread model, every game at the first price we had (ours.tsx's "Our lean, any size"). */
export async function ourNflSpread(season: number): Promise<R | null> {
  const snaps = await loadForecasts("nfl", season).catch(() => []);
  const pre = trackedGames(snaps, []);
  if (!pre.length) return null;
  const { closes } = await closingLines("nfl", season, pre).catch(() => ({ closes: new Map() }));
  return signalRecords(trackedGames(snaps, [...closes.values()])).find((x) => x.id === "lean") ?? null;
}

/**
 * Our own model's record per market, for the game pop-ups' "Our side" boxes.
 * Same sources as the rows below; cached per request so several boxes share one read.
 */
export const ourFootballRecords = cache(async (league: League, season: number, r: Pick<PicksReport, "totals" | "su">) => {
  const spread = league === "nfl" ? await ourNflSpread(season).catch(() => null) : ((await getCfbModelView(season).catch(() => null))?.record ?? null);
  const total = r.totals.backtest.cuts.find((c) => c.id === "t-ours")?.record ?? null;
  const su = r.su.methods.find((m) => m.id === "ours") ?? null;
  return { spread, total, su };
});

/** Our NBA game model's saved games and records (tracked only), cached per request. */
export const ourNbaGameModel = cache((season: number) => getNbaGameModelView(season).catch(() => null));

async function footballRows(league: League, market: Market, r: PicksReport): Promise<CutRow[]> {
  const st = r.strategies;
  const base = (id: string) => st.baselines.find((b) => b.id === id)?.record;
  if (market === "ats") {
    const ours = league === "nfl" ? await ourNflSpread(r.season) : (await getCfbModelView(r.season).catch(() => null))?.record ?? null;
    return [
      ...row(st.rule ? `The rule: ${st.rule.label}` : "The rule", st.rule?.record),
      ...row(st.second ? `Tier 2: ${st.second.label}` : "Tier 2", st.second?.record),
      ...row("Sam alone, every game", base("sam")),
      ...row("David alone, every game", base("david")),
      ...row("PEM alone, games it covers", base("pem")),
      ...row(league === "nfl" ? "Our NFL model, every game (tracked)" : "Our college model, every game (tracked)", ours),
    ];
  }
  if (market === "ou") {
    const bt = r.totals.backtest;
    const cut = (id: string) => bt.cuts.find((c) => c.id === id)?.record;
    return [
      ...row(bt.rule ? `Totals rule: ${bt.rule.label}` : "Totals rule", bt.rule?.record),
      ...row("Sam alone, at the opening total", bt.samAlone.record),
      ...row("Sam and David agree", cut("t-agree")),
      ...row("Our model's side of the total", cut("t-ours")),
    ];
  }
  // Straight up has no price, so no break-even tick.
  return r.su.methods.filter((m) => ["sam", "david", "ours", "vegas", "avg"].includes(m.id)).flatMap((m) => row(m.label, m, undefined));
}

export async function ModelRecords({ league, market, report }: { league: League; market: Market; report: PicksReport }) {
  const rows = await footballRows(league, market, report).catch(() => []);
  return <CutRanges title="Model records" aside={rows.length ? `${rows.length} models · tap to open` : "No graded games yet"} rows={rows} />;
}

export async function NbaModelRecords({ v, market }: { v: NbaPicksView; market: Market }) {
  const cut = (id: string) => v.cuts.find((c) => c.id === id);
  const rule = market === "ats" ? v.ats : market === "ou" ? v.ou : null;
  const ours = market === "su" ? null : await ourNbaGameModel(v.season);
  const mine = ours?.records.find((x) => x.id === (market === "ats" ? "lean" : "total"));
  const rows: CutRow[] = [
    ...(rule ? row(rule.tier1 ? `Tier 1: ${rule.tier1.label}` : "Tier 1", rule.tier1) : []),
    ...(rule ? row(rule.tier2 ? `Tier 2: ${rule.tier2.label}` : "Tier 2", rule.tier2) : []),
    ...row(market === "ats" ? "Sam, every side" : market === "ou" ? "Sam, every total" : "Sam's winner, every game", cut(`${market}:all`), market === "su" ? undefined : BREAK_EVEN),
    ...row(market === "ats" ? "David, every side" : market === "ou" ? "David, every total" : "David's winner, every game", cut(`${market}:d-all`), market === "su" ? undefined : BREAK_EVEN),
    ...row(market === "ats" ? "Our NBA model, every spread (tracked)" : "Our NBA model, every total (tracked)", mine),
  ];
  return <CutRanges title="Model records" aside={rows.length ? `${rows.length} models · tap to open` : "No graded games yet"} rows={rows} />;
}
