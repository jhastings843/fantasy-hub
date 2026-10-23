"use client";

import { useMemo, useState } from "react";
import s from "../picks/picks.module.css";

// The settled issued recommendations, sortable from the buttons or the column
// headers (Jack, 2026-10-22: "allow for sorting buttons on records").

export interface IssuedRow {
  key: string;
  league: string;
  week: number;
  position: string;
  kind: string;
  tier: string;
  stake: number;
  /** American price; absent on a parlay. */
  price: number | null;
  result: "W" | "L" | "P";
  net: number;
}

type Key = "week" | "net" | "stake" | "price" | "result" | "league";
const RES = { W: 2, P: 1, L: 0 } as const;
const implied = (o: number) => (o < 0 ? -o / (-o + 100) : 100 / (o + 100));
const VALUE: { [k in Key]: (r: IssuedRow) => number | string } = {
  week: (r) => r.week,
  net: (r) => r.net,
  stake: (r) => r.stake,
  price: (r) => (r.price === null ? -1 : implied(r.price)),
  result: (r) => RES[r.result],
  league: (r) => r.league,
};
const PRESETS: { id: string; label: string; k: Key; d: 1 | -1 }[] = [
  { id: "new", label: "Newest", k: "week", d: -1 },
  { id: "old", label: "Oldest", k: "week", d: 1 },
  { id: "best", label: "Best result", k: "net", d: -1 },
  { id: "worst", label: "Worst result", k: "net", d: 1 },
  { id: "stake", label: "Biggest stake", k: "stake", d: -1 },
  { id: "league", label: "League", k: "league", d: 1 },
];
const units = (x: number) => `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(x).toFixed(2)}u`;
const odds = (o: number | null) => (o === null ? "parlay" : o > 0 ? `+${o}` : `−${Math.abs(o)}`);

export default function RecordsTable({ rows }: { rows: IssuedRow[] }) {
  const [sort, setSort] = useState<{ k: Key; d: 1 | -1 }>({ k: "week", d: -1 });
  // League filter above the sort (Jack, 2026-10-22): All is the default and always an option.
  const leagues = useMemo(() => [...new Set(rows.map((r) => r.league))], [rows]);
  const [league, setLeague] = useState<string>("All");
  const sorted = useMemo(
    () =>
      rows.filter((r) => league === "All" || r.league === league).sort((a, b) => {
        const x = VALUE[sort.k](a);
        const y = VALUE[sort.k](b);
        return (x < y ? -1 : x > y ? 1 : 0) * sort.d || b.week - a.week || a.position.localeCompare(b.position);
      }),
    [rows, sort, league],
  );
  const head = (k: Key, label: string, num = false) => {
    const on = sort.k === k;
    return (
      <th className={num ? s.thNum : undefined} aria-sort={on ? (sort.d < 0 ? "descending" : "ascending") : "none"}>
        <button type="button" className={s.thSort} onClick={() => setSort(on ? { k, d: sort.d === 1 ? -1 : 1 } : { k, d: k === "league" ? 1 : -1 })}>
          {label}
          {on ? (sort.d < 0 ? " ↓" : " ↑") : ""}
        </button>
      </th>
    );
  };
  if (!rows.length) return <p className={s.calm}>No issued recommendation has settled yet.</p>;
  const net = sorted.reduce((a, r) => a + r.net, 0);
  const w = sorted.filter((r) => r.result === "W").length;
  const l = sorted.filter((r) => r.result === "L").length;
  const p = sorted.filter((r) => r.result === "P").length;
  return (
    <>
      <div className={s.sortBar} role="group" aria-label="League">
        <span className={s.sortLabel}>League</span>
        {["All", ...leagues].map((x) => (
          <button key={x} type="button" className={s.chip} aria-pressed={league === x} onClick={() => setLeague(x)}>
            {x}
          </button>
        ))}
      </div>
      <div className={s.sortBar} role="group" aria-label="Sort settled recommendations">
        <span className={s.sortLabel}>Sort</span>
        {PRESETS.map((p) => (
          <button key={p.id} type="button" className={s.chip} aria-pressed={sort.k === p.k && sort.d === p.d} onClick={() => setSort({ k: p.k, d: p.d })}>
            {p.label}
          </button>
        ))}
      </div>
      <div className={s.tw}>
        <table className={s.table}>
          <caption className={s.caption}>{`${league === "All" ? "All leagues" : league} · ${w}-${l}${p ? `-${p}` : ""} · ${units(net)}`}</caption>
          <thead>
            <tr>
              {head("week", "Week")}
              {head("league", "League")}
              <th>Position</th>
              <th>Tier</th>
              {head("stake", "Stake", true)}
              {head("price", "Price", true)}
              {head("result", "Result")}
              {head("net", "Net", true)}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.key}>
                <td className={s.num}>{r.week}</td>
                <td>{r.league}</td>
                <td>
                  <b>{r.position}</b>
                  {r.kind !== "Spread" && <span className={s.muted}>{` · ${r.kind}`}</span>}
                </td>
                <td>{r.tier}</td>
                <td className={`${s.num} ${s.tdNum}`}>{`${r.stake}u`}</td>
                <td className={`${s.num} ${s.tdNum}`}>{odds(r.price)}</td>
                <td>
                  <span className={`${s.readChip} ${r.result === "W" ? s.readW : r.result === "L" ? s.readL : ""}`}>{r.result === "W" ? "Won" : r.result === "L" ? "Lost" : "Push"}</span>
                </td>
                <td className={`${s.num} ${s.tdNum} ${r.net > 0 ? s.pos : r.net < 0 ? s.neg : ""}`}>{units(r.net)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
