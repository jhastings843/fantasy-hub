"use client";
// One stock book's equity against the same money in SPY, large and
// interactive: slide the pointer (or a finger, or the arrow keys) across it
// and a cursor reads out that day's value, its return, SPY's and the gap.
// Trade days are ticked along the bottom.
import { useState, type KeyboardEvent, type PointerEvent } from "react";
import m from "./money.module.css";

export interface BookChartPoint {
  day: string;
  equity: number;
  spy: number | null;
  live?: boolean;
}

const W = 1000;
const H = 360;
const PAD = { l: 64, r: 20, t: 20, b: 40 };
const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const pct = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(n * 100).toFixed(2)}%`;
const day = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

export default function BookChart({ points, start, trades, label }: { points: BookChartPoint[]; start: number; trades: { day: string; text: string }[]; label: string }) {
  const [at, setAt] = useState(points.length - 1);
  if (points.length < 2) return <p className={m.sub}>Not enough history to draw yet.</p>;
  const ys = points.flatMap((p) => [p.equity, ...(p.spy !== null ? [p.spy] : [])]).concat(start);
  const lo = Math.min(...ys);
  const hi = Math.max(...ys);
  const span = hi - lo || 1;
  const x = (i: number) => PAD.l + (i * (W - PAD.l - PAD.r)) / (points.length - 1);
  const y = (v: number) => PAD.t + (1 - (v - lo) / span) * (H - PAD.t - PAD.b);
  const path = (f: (p: BookChartPoint) => number | null) =>
    points
      .map((p, i) => [i, f(p)] as const)
      .filter(([, v]) => v !== null)
      .map(([i, v], k) => `${k ? "L" : "M"}${x(i).toFixed(1)},${y(v!).toFixed(1)}`)
      .join(" ");
  const p = points[at];
  const up = points.at(-1)!.equity >= start;
  const color = up ? "var(--pos)" : "var(--neg)";
  const tradeDays = new Set(trades.map((t) => t.day));
  const ticks = [0, Math.floor((points.length - 1) / 2), points.length - 1];
  const move = (e: PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const i = Math.round(((px - PAD.l) / (W - PAD.l - PAD.r)) * (points.length - 1));
    setAt(Math.max(0, Math.min(points.length - 1, i)));
  };
  const key = (e: KeyboardEvent<SVGSVGElement>) => {
    if (e.key === "ArrowLeft") setAt((a) => Math.max(0, a - 1));
    if (e.key === "ArrowRight") setAt((a) => Math.min(points.length - 1, a + 1));
  };
  const todays = trades.filter((t) => t.day === p.day);
  return (
    <div className={m.bigChart}>
      <div className={m.readout} aria-live="polite">
        <span>
          <b>{day(p.day)}</b>
          {p.live ? " · live" : ""}
        </span>
        <span>
          {`${label} `}
          <b style={{ color }}>{usd(p.equity)}</b>
          {` ${pct(p.equity / start - 1)}`}
        </span>
        {p.spy !== null && (
          <span>
            {"SPY "}
            <b>{usd(p.spy)}</b>
            {` ${pct(p.spy / start - 1)}`}
          </span>
        )}
        {p.spy !== null && (
          <span>
            {"Gap "}
            <b style={{ color: p.equity >= p.spy ? "var(--pos)" : "var(--neg)" }}>{pct((p.equity - p.spy) / start)}</b>
          </span>
        )}
        {todays.length > 0 && <span className={m.readTrade}>{todays.map((t) => t.text).join(" · ")}</span>}
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className={m.bigSvg}
        role="img"
        aria-label={`${label} against SPY, ${points.length} days. Use the arrow keys to move the cursor.`}
        tabIndex={0}
        onPointerMove={move}
        onPointerDown={move}
        onKeyDown={key}
      >
        <line x1={PAD.l} x2={W - PAD.r} y1={y(start)} y2={y(start)} stroke="var(--rule)" strokeDasharray="4 6" />
        <text x={PAD.l - 8} y={y(start) + 4} textAnchor="end" fontSize={13} fill="var(--mute)">
          {usd(start)}
        </text>
        <text x={PAD.l - 8} y={y(hi) + 4} textAnchor="end" fontSize={13} fill="var(--mute)">
          {usd(hi)}
        </text>
        <text x={PAD.l - 8} y={y(lo) + 4} textAnchor="end" fontSize={13} fill="var(--mute)">
          {usd(lo)}
        </text>
        <path d={path((q) => q.spy)} fill="none" stroke="var(--ink2)" strokeWidth={2} strokeDasharray="6 6" opacity={0.7} />
        <path d={path((q) => q.equity)} fill="none" stroke={color} strokeWidth={3} strokeLinejoin="round" />
        {points.map((q, i) =>
          tradeDays.has(q.day) ? <line key={q.day} x1={x(i)} x2={x(i)} y1={H - PAD.b + 6} y2={H - PAD.b + 16} stroke="var(--accent)" strokeWidth={3} /> : null,
        )}
        {ticks.map((i) => (
          <text key={i} x={x(i)} y={H - 6} textAnchor={i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"} fontSize={13} fill="var(--mute)">
            {day(points[i].day)}
          </text>
        ))}
        <line x1={x(at)} x2={x(at)} y1={PAD.t} y2={H - PAD.b} stroke="var(--ink)" strokeWidth={1} opacity={0.5} />
        {p.spy !== null && <circle cx={x(at)} cy={y(p.spy)} r={5} fill="var(--ink2)" />}
        <circle cx={x(at)} cy={y(p.equity)} r={6} fill={color} stroke="var(--surface)" strokeWidth={2} />
      </svg>
      <div className={m.bigKey}>
        <span>
          <i style={{ background: color }} />
          {label}
        </span>
        <span>
          <i style={{ background: "var(--ink2)" }} />
          Same money in SPY
        </span>
        <span>
          <i style={{ background: "var(--accent)", width: 3 }} />
          Trade days
        </span>
      </div>
    </div>
  );
}
