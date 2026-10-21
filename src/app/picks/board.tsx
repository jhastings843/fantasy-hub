// The redesign's shared pieces (2026-10-21): a headline that states the
// answer, the stat strip, the market-vs-models line, a learner log, the
// season curve, and the "tracked in the background" drawer. Picks and Props
// both build on these so the two tabs read the same.
import type { ReactNode } from "react";
import type { JournalLine } from "@/lib/learning/engine";
import { whenEt } from "./ui";
import s from "./picks.module.css";

export function Hero({ eyebrow, title, sub }: { eyebrow: string; title: ReactNode; sub?: ReactNode }) {
  return (
    <div className={s.hero}>
      <span className={s.eyebrow}>{eyebrow}</span>
      <h2 className={s.heroH}>{title}</h2>
      {sub ? <p className={s.heroSub}>{sub}</p> : null}
    </div>
  );
}

export interface Stat {
  k: string;
  v: ReactNode;
  sub?: ReactNode;
  tone?: "up" | "down";
  small?: boolean;
}

export function Stats({ items, label }: { items: Stat[]; label: string }) {
  return (
    <dl className={s.stats} aria-label={label}>
      {items.map((x) => (
        <div key={x.k}>
          <dt>{x.k}</dt>
          <dd>
            <span className={`${s.statV} ${x.small ? s.statVs : ""} ${x.tone === "up" ? s.pos : x.tone === "down" ? s.neg : ""}`}>{x.v}</span>
            {x.sub ? <span className={s.statK}>{x.sub}</span> : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * The market against the models on one line, in the home side's spread (or
 * any one number): the market as a tick, each model as a dot. The scale
 * pads the spread of values so close numbers don't sit on top of each other.
 */
export function MarketLine({ market, sam, david, pem, fmt }: { market: number; sam?: number; david?: number; pem?: number; fmt: (x: number) => string }) {
  const xs = [market, sam, david, pem].filter((x): x is number => x !== undefined);
  const lo = Math.min(...xs);
  const hi = Math.max(...xs);
  const pad = Math.max(1.5, (hi - lo) * 0.2);
  const at = (x: number) => `${(((x - (lo - pad)) / (hi - lo + 2 * pad)) * 100).toFixed(1)}%`;
  return (
    <div className={s.mline}>
      <div className={s.mtrack} role="img" aria-label={[`Market ${fmt(market)}`, sam !== undefined ? `Sam ${fmt(sam)}` : "", david !== undefined ? `David ${fmt(david)}` : "", pem !== undefined ? `PEM ${fmt(pem)}` : ""].filter(Boolean).join(", ")}>
        <span className={s.mMarket} style={{ left: at(market) }} />
        {pem !== undefined && <span className={`${s.mDot} ${s.mPem}`} style={{ left: at(pem) }} />}
        {david !== undefined && <span className={`${s.mDot} ${s.mDavid}`} style={{ left: at(david) }} />}
        {sam !== undefined && <span className={`${s.mDot} ${s.mSam}`} style={{ left: at(sam) }} />}
      </div>
      <div className={s.mLabels}>
        <span>{`Market ${fmt(market)}`}</span>
        <span>
          {sam !== undefined && <span className={s.cSam}>{`Sam ${fmt(sam)}`}</span>}
          {sam !== undefined && david !== undefined ? " · " : ""}
          {david !== undefined && <span className={s.cDavid}>{`David ${fmt(david)}`}</span>}
          {pem !== undefined ? ` · PEM ${fmt(pem)}` : ""}
        </span>
      </div>
    </div>
  );
}

export function MarketKey({ pem = false }: { pem?: boolean }) {
  return (
    <div className={s.mKey}>
      <span>
        <i className="tick" style={{ width: 2, height: 12, borderRadius: 0, background: "var(--ink)" }} />
        Market (DraftKings)
      </span>
      <span>
        <i style={{ background: "var(--accent)" }} />
        Sam
      </span>
      <span>
        <i style={{ background: "var(--david)" }} />
        David
      </span>
      {pem && (
        <span>
          <i style={{ background: "var(--ink2)" }} />
          PEM
        </span>
      )}
    </div>
  );
}

/** Everything that is kept and graded but shouldn't compete with the bets. */
export function Background({ title = "Tracked in the background", children }: { title?: string; children: ReactNode }) {
  return (
    <details className={s.bg}>
      <summary>{title}</summary>
      <div className={s.bgBody}>{children}</div>
    </details>
  );
}

/** The running unit total after each graded week, as a line. */
export function Curve({ points, label }: { points: { x: string; v: number }[]; label: string }) {
  if (!points.length) return null;
  const ys = points.map((_, i) => points.slice(0, i + 1).reduce((a, p) => a + p.v, 0));
  const run = ys.at(-1) ?? 0;
  const lo = Math.min(0, ...ys);
  const hi = Math.max(0, ...ys);
  const W = 1000;
  const H = 200;
  const top = 30;
  const bottom = 170;
  const y = (v: number) => (hi === lo ? (top + bottom) / 2 : bottom - ((v - lo) / (hi - lo)) * (bottom - top));
  const x = (i: number) => (points.length === 1 ? W / 2 : 60 + (i * (W - 120)) / (points.length - 1));
  const fmt = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(2)}`;
  return (
    <svg className={s.curve} viewBox={`0 0 ${W} ${H + 20}`} role="img" aria-label={`${label}: ${points.map((p, i) => `${fmt(ys[i])} after ${p.x}`).join(", ")}`}>
      <line x1={40} y1={y(0)} x2={W - 20} y2={y(0)} stroke="var(--rule)" strokeWidth={2} />
      <text x={0} y={y(0) + 4} fill="var(--mute)" fontSize={13} fontFamily="var(--font-plex-mono)">0u</text>
      <polyline points={ys.map((v, i) => `${x(i)},${y(v)}`).join(" ")} fill="none" stroke={run >= 0 ? "var(--pos)" : "var(--neg)"} strokeWidth={4} strokeLinejoin="round" />
      {ys.map((v, i) => (
        <g key={i}>
          <circle cx={x(i)} cy={y(v)} r={6} fill={points[i].v >= 0 ? "var(--pos)" : "var(--neg)"} />
          <text x={x(i)} y={y(v) - 12} fill="var(--ink2)" fontSize={13} fontFamily="var(--font-plex-mono)" textAnchor="middle">
            {fmt(v)}
          </text>
          <text x={x(i)} y={H + 14} fill="var(--mute)" fontSize={12} textAnchor="middle">
            {points[i].x}
          </text>
        </g>
      ))}
    </svg>
  );
}

/** How an idea goes live, in four steps (the gate's numbers stay on the section's own page). */
export function GoLiveSteps({ games }: { games: string }) {
  return (
    <div className={s.steps}>
      <div className={s.step}>
        <b>1 · Tracked</b>
        <span>Registered at a review; only later games count.</span>
      </div>
      <div className={s.step}>
        <b>2 · Enough games</b>
        <span>{games}</span>
      </div>
      <div className={s.step}>
        <b>3 · Beats the price</b>
        <span>Up, and clear of break-even by more than luck.</span>
      </div>
      <div className={`${s.step} ${s.stepLive}`}>
        <b>4 · Live</b>
        <span>Bets for real. Rolled back if it starts losing.</span>
      </div>
    </div>
  );
}

export interface LogEntry {
  at: string;
  kind: "live" | "new" | "back" | "test" | "brake";
  title: string;
  detail?: string;
}

const KIND: { [k in LogEntry["kind"]]: [string, string] } = { live: ["Live", s.kLive], new: ["New", s.kNew], back: ["Rolled back", s.kBack], test: ["Testing", ""], brake: ["Brake on", s.kBack] };

export function LearnerLog({ entries, empty }: { entries: LogEntry[]; empty: string }) {
  if (!entries.length) return <p className={s.calm}>{empty}</p>;
  return (
    <ol className={s.log}>
      {entries.map((e, i) => (
        <li key={`${e.at}|${i}`} className={s.logRow}>
          <span className={s.logWhen}>{whenEt(e.at)}</span>
          <span className={`${s.logKind} ${KIND[e.kind][1]}`}>{KIND[e.kind][0]}</span>
          <span className={s.logText}>
            <b>{e.title}</b>
            {e.detail ? <span>{e.detail}</span> : null}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** A shared-engine journal line as a log entry (props, first TD, first basket). */
export function engineEntry(j: JournalLine, section: string): LogEntry {
  const kind: LogEntry["kind"] = j.kind === "activated" ? "live" : j.kind === "rolled back" ? "back" : j.kind === "registered" ? "new" : "test";
  return { at: j.at, kind, title: `${section}: ${j.text}` };
}
