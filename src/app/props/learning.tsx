// The shared learning engine's block, the same on every props-style section
// (NFL props, NBA props, First TD): the gate in words, what is live, what is
// closest, and the journal.

import Link from "next/link";
import type { SectionView } from "@/lib/learning/engine";
import { whenEt } from "../picks/ui";
import s from "../picks/picks.module.css";

const u = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(1)}u`;
const CLOSEST = 8;

export function LearningBlock({ v }: { v: SectionView; unit?: string }) {
  const g = v.gate;
  const live = v.entries.filter((e) => e.activatedAt).sort((a, b) => (b.activatedAt ?? "").localeCompare(a.activatedAt ?? ""));
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
        <p className={s.p}>{`A slice goes live after ${g.minGames}+ games over ${g.minWeeks}+ weeks with a clear edge, and is rolled back if it turns. ${
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
                  <td className={e.status === "rolled-back" ? s.neg : s.pos}>{e.status === "rolled-back" ? `rolled back Wk ${e.endedWeek}` : "live"}</td>
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
                <th>Still needs</th>
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
                    {e.ev!.checks
                      .filter((c) => !c.pass)
                      .map((c) => c.note)
                      .slice(0, 2)
                      .join("; ") || "ready at the next review"}
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
