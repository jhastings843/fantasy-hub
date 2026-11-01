"use client";
// Parlay of the day with a leg-count picker (Jack, 2026-11-01): the same pool,
// its top 2 to 6 legs. Only the tracked count is graded; the others are a view.
import { useState } from "react";
import type { Ticket } from "@/lib/models/nfl/attd-parlay";
import s from "../picks/picks.module.css";

const pct = (x: number) => `${Math.round(x * 100)}%`;
const am = (p: number) => (p > 0 ? `+${p}` : `${p}`);
const be = (p: number) => (p > 0 ? 100 / (p + 100) : -p / (-p + 100));
const ev = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(2)}u`;

export function ParlayPicker({ tickets, tracked, status }: { tickets: Ticket[]; tracked: number; status?: string }) {
  const [n, setN] = useState(tracked);
  const t = tickets.find((x) => x.legs.length === n) ?? tickets[0];
  return (
    <>
      {tickets.length > 1 && (
        <div className={s.sortBar} role="group" aria-label="Legs">
          <span className={s.sortLabel}>Legs</span>
          {tickets.map((x) => (
            <button key={x.legs.length} type="button" className={s.chip} aria-pressed={x.legs.length === n} onClick={() => setN(x.legs.length)}>
              {x.legs.length === tracked ? `${x.legs.length} · tracked` : x.legs.length}
            </button>
          ))}
        </div>
      )}
      <p className={s.thin}>
        {`${t.legs.length} legs at ${am(t.price)} · blended chance ${(t.chance * 100).toFixed(1)}% · EV ${ev(t.ev)} per 1u`}
        {t.legs.length === tracked ? (status ?? "") : " · not tracked"}
      </p>
      <div className={s.tw}>
        <table className={s.table}>
          <thead>
            <tr>
              <th>Leg</th>
              <th>DK</th>
              <th>Ours</th>
              <th>Venom</th>
              <th>Blend / DK</th>
            </tr>
          </thead>
          <tbody>
            {t.legs.map((l) => (
              <tr key={l.key}>
                <td>
                  {`${l.name} ${l.team}`}
                  <br />
                  <span className={s.dim}>{l.game}</span>
                </td>
                <td className={s.num}>{am(l.price)}</td>
                <td className={s.num}>{pct(l.ours)}</td>
                <td className={s.num}>{pct(l.venom)}</td>
                <td className={s.num}>{`${pct(l.chance)} / ${pct(be(l.price))}`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
