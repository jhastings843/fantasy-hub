// Shared bits for the Picks views: formatting, small components.
import { BREAK_EVEN, MIN_SAMPLE, type Record as Rec, type Tier } from "@/lib/picks/engine";
import type { League } from "@/lib/picks/parse";
import s from "./picks.module.css";

export const LEAGUE_NAME: { [k in League]: string } = { nfl: "NFL", cfb: "College" };

export type Market = "ats" | "su" | "ou";
export type View = "week" | "results" | "research";
export const MARKETS: { id: Market; label: string }[] = [
  { id: "ats", label: "Spreads" },
  { id: "su", label: "Straight up" },
  { id: "ou", label: "Totals" },
];
export const VIEWS: { id: View; label: string }[] = [
  { id: "week", label: "This week" },
  { id: "results", label: "Results" },
  { id: "research", label: "Research" },
];

export const rec = (r: Pick<Rec, "w" | "l" | "p">) => `${r.w}-${r.l}${r.p ? `-${r.p}` : ""}`;
export const pct = (r: Rec) => `${Math.round(r.pct * 100)}%`;
export const units = (u: number) => `${u >= 0 ? "+" : "−"}${Math.abs(u).toFixed(1)}u`;
export const backtestUnits = (r: Rec) => `${r.units >= 0 ? "+" : "−"}${Math.abs(r.units).toFixed(1)}`;
export const line = (x: number) => (x === 0 ? "PK" : `${x > 0 ? "+" : ""}${x}`);
export const price = (p?: number) => (p === undefined ? "no price" : p > 0 ? `+${p}` : `${p}`);
export const n = (r: Pick<Rec, "w" | "l">) => r.w + r.l;

const ET = "America/New_York";
export const kickoffEt = (iso?: string) =>
  iso ? new Date(iso).toLocaleString("en-US", { timeZone: ET, weekday: "short", hour: "numeric", minute: "2-digit" }) : "time TBD";
export const whenEt = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString("en-US", { timeZone: ET, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "never";

export function href(league: League, market: Market, view: View): string {
  const base = league === "nfl" ? "/picks" : "/picks/cfb";
  const q = new URLSearchParams();
  if (market !== "ats") q.set("m", market);
  if (view !== "week") q.set("v", view);
  const qs = q.toString();
  return qs ? `${base}?${qs}` : base;
}

export function parseMarket(x: unknown): Market {
  return x === "su" || x === "ou" ? x : "ats";
}
export function parseView(x: unknown): View {
  return x === "results" || x === "research" ? x : "week";
}

const TIER_LABEL: { [t in Tier]: string } = {
  t1: "Tier 1",
  t2: "Tier 2",
  wait: "Needs PEM",
  fav: "Pass · favorite",
  pass: "Pass",
  split: "Pass · split",
  one: "One model only",
};

export function TierChip({ t }: { t: Tier }) {
  const cls = t === "t1" ? s.t1 : t === "t2" ? s.t2 : s.tPass;
  return <span className={`${s.tier} ${cls}`}>{TIER_LABEL[t]}</span>;
}

/** A cut's record as a row with its 90% range bar. */
export function StrategyRow({ label, r, mark }: { label: string; r: Rec; mark?: "rule" | "second" }) {
  const good = r.pct > BREAK_EVEN;
  const tip = `${label}: ${rec(r)}, ${pct(r)} ATS, ${backtestUnits(r)}u at −110 (backtest, to win 1). 90% likely range ${Math.round(r.lo * 100)}% to ${Math.round(r.hi * 100)}%.`;
  return (
    <div className={`${s.srow} ${mark === "rule" ? s.star : mark === "second" ? s.second : ""}`} title={tip} tabIndex={0}>
      <div className={s.sname}>
        {label}
        {mark === "rule" && <span className={s.pill}>the rule</span>}
        {mark === "second" && <span className={`${s.pill} ${s.pillSoft}`}>tier 2</span>}
        {n(r) > 0 && n(r) < MIN_SAMPLE && <span className={s.thin}> · small sample</span>}
      </div>
      <div className={`${s.right} ${s.num}`}>{n(r) ? rec(r) : "none"}</div>
      <div className={s.sbar}>
        <div className={s.track}>
          {n(r) > 0 && (
            <>
              <span className={s.ci} style={{ left: `${r.lo * 100}%`, width: `${(r.hi - r.lo) * 100}%` }} />
              <span className={`${s.fill} ${good ? s.fillPos : s.fillNeg}`} style={{ width: `${r.pct * 100}%` }} />
            </>
          )}
          <span className={s.be} />
        </div>
      </div>
      <div className={`${s.right} ${s.num} ${s.hideSm}`}>{n(r) ? pct(r) : ""}</div>
      <div className={`${s.right} ${s.num} ${good ? s.pos : s.neg}`}>{n(r) ? backtestUnits(r) : ""}</div>
    </div>
  );
}

/** Largest peak-to-trough fall in a running unit total. */
export function drawdown(steps: number[]): number {
  let peak = 0;
  let run = 0;
  let worst = 0;
  for (const x of steps) {
    run += x;
    peak = Math.max(peak, run);
    worst = Math.max(worst, peak - run);
  }
  return Math.round(worst * 100) / 100;
}
