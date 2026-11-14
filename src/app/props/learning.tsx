// The shared learning engine's block, the same on every props-style section
// (NFL props, NBA props, First TD): the gate in words, what is live, what is
// closest, and the journal.

import Link from "next/link";
import type { Check, SectionView } from "@/lib/learning/engine";
import { whenEt } from "../picks/ui";
import type { TrackRow } from "../picks/board";
import s from "../picks/picks.module.css";
import { SCHEME, SWITCH_RULE } from "@/lib/props/staking";

const u = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(1)}u`;
const CLOSEST = 8;

/**
 * The Bet Record tile (Jack, 2026-11-05): real bets only, apart from "Every
 * edge". Reads "0-0 · nothing live yet" until a slice goes live.
 *   { bets: 0 }                          -> { value: "0-0", label: "Bet record · nothing live yet" }
 *   { bets: 7, w: 4, l: 3, units: 0.62 } -> { value: "+0.6u", label: "Bet record · 4-3 since Nov 9" }
 */
export function betRecordTile(v: SectionView | null): { value: string; label: string } {
  const r = v?.record;
  if (!r) return { value: "0-0", label: "Bet record · nothing live yet" };
  if (!r.bets) return { value: "0-0", label: r.since ? `Bet record · live since ${sinceDay(r.since)}, no graded bets yet` : "Bet record · nothing live yet" };
  return { value: u(r.units), label: `Bet record · ${r.w}-${r.l}${r.p ? `-${r.p}` : ""}${r.since ? ` since ${sinceDay(r.since)}` : ""}` };
}
const sinceDay = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });

/**
 * What a slice is short, in two lists (Jack, 2026-11-03): "t −1.09 (needs 1.96+) · lines moved our way 69, against us 77 (needs at least even)".
 * Games and weeks have their own columns. t is how sure the edge is real: 1.96 is about a 1-in-40 chance it's luck.
 */
export function hasNeeds(short: Check[]): string {
  // Units sit in their own column, and a t past the bar already means a profit.
  const rows = short.filter((c) => c.name !== "units");
  return (rows.length ? rows : short).map((c) => (c.have && c.need ? `${c.have} (needs ${c.need})` : c.note)).join(" · ");
}

/** Every slice the engine is measuring, for the learner log's progress section. */
export function trackRows(v: SectionView, prefix = ""): TrackRow[] {
  const g = v.gate;
  return v.entries.map((e): TrackRow => {
    const ev = e.ev;
    const paused = e.status === "paused";
    const live = e.status === "active" || paused;
    const rec = e.live ? `${e.live.w}-${e.live.l}${e.live.p ? `-${e.live.p}` : ""}, ${u(e.live.units)} since it went live` : undefined;
    // Games and weeks have their own bars; the note lists what else is short.
    const short = ev?.checks.filter((c) => !c.pass && c.name !== "games" && c.name !== "weeks") ?? [];
    const still = !ev?.games ? "No games yet: only games after it was first tracked count." : short.length ? hasNeeds(short) : ev.ready ? "Ready at the next review" : undefined;
    return {
      id: `${prefix}${e.id}`,
      label: `${prefix}${e.label}`,
      status: live ? "live" : e.status === "rolled-back" ? "back" : e.status === "retired" ? "retired" : "testing",
      games: ev?.games ?? 0,
      needGames: g.minGames,
      weeks: ev?.weeks ?? 0,
      needWeeks: g.minWeeks,
      result: live || e.status === "rolled-back" ? rec : ev && ev.bets ? `${u(ev.units)} over ${ev.bets} bet${ev.bets === 1 ? "" : "s"}` : undefined,
      note: paused
        ? `Paused for the rest of week ${e.pausedWeek}: past its ${g.weeklyLossCap}u weekly loss cap`
        : live && e.probation && !e.probation.until
          ? `Live at ${e.probation.stake}u (probation): full stake at t ${g.minT}, now t ${ev?.t ?? 0}; stops below t 0`
          : live
            ? undefined
            : e.status === "rolled-back" ? e.reason : e.status === "retired" ? `retired week ${e.endedWeek}` : still,
    };
  });
}

export function LearningBlock({ v }: { v: SectionView; unit?: string }) {
  const g = v.gate;
  const lastLive = (e: (typeof v.entries)[number]) => e.activatedAt ?? e.stints?.at(-1)?.from ?? "";
  const live = v.entries.filter((e) => e.activatedAt || e.stints?.length).sort((a, b) => lastLive(b).localeCompare(lastLive(a)));
  const closest = v.entries
    .filter((e) => e.status === "collecting" && e.ev && e.ev.games > 0)
    .sort((a, b) => b.ev!.t - a.ev!.t)
    .slice(0, CLOSEST);
  const collecting = v.entries.filter((e) => e.status === "collecting").length;
  return (
    <>
      <div className={s.sectionHead}>
        <h3 className={s.h3}>Learning</h3>
        <Link href="/learning" className={s.dim} style={{ fontSize: 13 }}>
          Every section&apos;s learning on one page
        </Link>
        <p className={s.p}>{`To go live a slice needs all of: ${g.minGames}+ games over ${g.minWeeks}+ weeks, ${g.minBets}+ bets${g.minWins ? `, ${g.minWins}+ winners` : ""}, a profit, and t ${g.minT}+ (t is how sure the edge is real; ${g.minT} is about ${g.minT >= 2.3 ? "a 1-in-100" : "a 1-in-20"} chance it's luck). A narrower slice must also beat the one it narrows. A live one is rolled back if it turns. ${
          v.lastReviewAt ? `Last review ${whenEt(v.lastReviewAt)}; ${collecting} collecting.` : "First review runs at the next data pull."
        }`}</p>
      </div>
      <div className={s.tw}>
        <table className={s.table}>
          <caption className={s.caption}>Live: money counted only from the day each went live</caption>
          <thead>
            <tr>
              <th>Slice</th>
              <th>Since</th>
              <th>Record</th>
              <th>Units</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {live.length ? (
              live.map((e) => (
                <tr key={e.id}>
                  <td>{e.label}</td>
                  <td className={s.num}>{`Wk ${e.activeWeek}`}</td>
                  <td className={s.num}>{e.live ? `${e.live.w}-${e.live.l}${e.live.p ? `-${e.live.p}` : ""}` : "–"}</td>
                  <td className={`${s.num} ${(e.live?.units ?? 0) > 0 ? s.pos : (e.live?.units ?? 0) < 0 ? s.neg : ""}`}>{u(e.live?.units ?? 0)}</td>
                  <td className={e.status === "rolled-back" || e.status === "paused" ? s.neg : s.pos}>{e.status === "rolled-back" ? `rolled back Wk ${e.endedWeek}` : e.status === "paused" ? `paused Wk ${e.pausedWeek}` : "live"}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={5} className={s.dim}>
                  Nothing live yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <StakingBlock v={v} />
      {closest.length > 0 && (
        <div className={s.tw}>
          <table className={s.table}>
            <caption className={s.caption}>Closest to going live</caption>
            <thead>
              <tr>
                <th>Slice</th>
                <th>Games</th>
                <th>Units</th>
                <th>t</th>
                <th>Has now · needs</th>
              </tr>
            </thead>
            <tbody>
              {closest.map((e) => (
                <tr key={e.id}>
                  <td>{e.label}</td>
                  <td className={s.num}>{e.ev!.games}</td>
                  <td className={`${s.num} ${e.ev!.units > 0 ? s.pos : e.ev!.units < 0 ? s.neg : ""}`}>{u(e.ev!.units)}</td>
                  <td className={s.num}>{e.ev!.t.toFixed(2)}</td>
                  <td className={s.dim}>
                    {e.ev!.checks.some((c) => !c.pass) ? hasNeeds(e.ev!.checks.filter((c) => !c.pass)) : "Ready at the next review"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {v.journal.length > 0 && (
        <ul className={s.journal}>
          {v.journal.slice(0, 8).map((j, i) => (
            <li key={`${j.at}|${i}`}>
              <span className={s.dim}>{`${whenEt(j.at)} · `}</span>
              {j.text}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

const pct = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(1)}%`;

/**
 * The section's widest slice staked every way (lib/props/staking.ts), from
 * our saved chance and the saved price: what flat 1u made and what the other
 * schemes would have. "Bankroll" compounds each bet at 1u = 1% of bankroll.
 */
export function StakingBlock({ v }: { v: SectionView }) {
  const t = v.staking;
  if (!t || !t.rows.some((r) => r.bets > 0)) return null;
  const test = new Map(t.tests.map((x) => [x.scheme, x]));
  return (
    <div className={s.tw}>
      <table className={s.table}>
        <caption className={s.caption}>{`Staking: ${t.baseLabel.toLowerCase()}, every graded bet sized each way`}</caption>
        <thead>
          <tr>
            <th>Scheme</th>
            <th>Bets</th>
            <th>Units</th>
            <th>ROI</th>
            <th>Drawdown</th>
            <th>Bankroll</th>
          </tr>
        </thead>
        <tbody>
          {t.rows.map((r) => (
            <tr key={r.scheme}>
              <td>
                {SCHEME[r.scheme].label}
                {r.scheme === t.inUse && <span className={s.pos}>{" · in use"}</span>}
              </td>
              <td className={s.num}>{r.bets}</td>
              <td className={`${s.num} ${r.units > 0 ? s.pos : r.units < 0 ? s.neg : ""}`}>{u(r.units)}</td>
              <td className={s.num}>{pct(r.roi)}</td>
              <td className={s.num}>{r.drawdown ? `−${r.drawdown.toFixed(1)}u` : "0u"}</td>
              <td className={`${s.num} ${r.logGrowth > 0 ? s.pos : r.logGrowth < 0 ? s.neg : ""}`} title={`log-growth ${r.logGrowth}${test.get(r.scheme) ? `, paired t vs flat ${test.get(r.scheme)!.t}` : ""}`}>
                {pct(Math.exp(r.logGrowth) - 1)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className={s.dim} style={{ fontSize: 12.5, marginTop: 6 }}>
        {`ROI is units won per unit risked. Bankroll is what the bets would have done to a bankroll at 1u = 1%, compounding. Live bets leave flat only when a scheme grows the bankroll more over ${SWITCH_RULE.minBets}+ graded bets in ${SWITCH_RULE.minWeeks}+ weeks (paired t ${SWITCH_RULE.minT}+), and go back once it falls below flat.${
          t.missing ? ` ${t.missing} older bet${t.missing === 1 ? " has" : "s have"} no saved chance and ${t.missing === 1 ? "is" : "are"} left out.` : ""
        }${t.inUse !== "flat" && t.since ? ` ${SCHEME[t.inUse].label} since ${whenEt(t.since)}.` : ""}`}
      </p>
    </div>
  );
}
