// The redesign's shared pieces (2026-10-21): a headline that states the
// answer, the stat strip, the market-vs-models line, a learner log, the
// season curve, and the "tracked in the background" drawer. Picks and Props
// both build on these so the two tabs read the same.
import type { ReactNode } from "react";
import type { JournalLine } from "@/lib/learning/engine";
import { whenEt } from "./ui";
import s from "./picks.module.css";

/** The Ledger's page frame: a big mixed-case title, one line under it, and the as-of stamp on the right. */
export function PageHead({ title, sub, asof }: { title: ReactNode; sub?: ReactNode; asof?: ReactNode }) {
  return (
    <div className={s.pageHead}>
      <div>
        <h1 className={s.pageTitle}>{title}</h1>
        {sub && <p className={s.pageSub}>{sub}</p>}
      </div>
      {asof && <div className={s.pageAsof}>{asof}</div>}
    </div>
  );
}

/** A section heading: title left, a short note right, a 2px rule under both. */
export function SecHead({ title, aside, id }: { title: ReactNode; aside?: ReactNode; id?: string }) {
  return (
    <div className={s.secHead}>
      <h2 className={s.secTitle} id={id}>
        {title}
      </h2>
      {aside && <span className={s.secAside}>{aside}</span>}
    </div>
  );
}

/** A section's opening, drawn as the Ledger section heading: title left, its label right, the line under. */
export function Hero({ eyebrow, title, sub }: { eyebrow: string; title: ReactNode; sub?: ReactNode }) {
  return (
    <div className={s.pageFrame}>
      <SecHead title={title} aside={eyebrow} />
      {sub ? <p className={s.p}>{sub}</p> : null}
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
export function MarketLine({
  market,
  sam,
  david,
  pem,
  fmt,
  pk,
}: {
  market: number;
  sam?: number;
  david?: number;
  pem?: number;
  fmt: (x: number) => string;
  /** Spreads: mark pick'em (0) and name who is favored on each side of it. */
  pk?: { below: string; above: string };
}) {
  const xs = [market, sam, david, pem, ...(pk ? [0] : [])].filter((x): x is number => x !== undefined);
  const lo = Math.min(...xs);
  const hi = Math.max(...xs);
  const pad = Math.max(1.5, (hi - lo) * 0.2);
  const at = (x: number) => `${(((x - (lo - pad)) / (hi - lo + 2 * pad)) * 100).toFixed(1)}%`;
  return (
    <div className={s.mline}>
      <div className={s.mtrack} role="img" aria-label={[`Market ${fmt(market)}`, sam !== undefined ? `Sam ${fmt(sam)}` : "", david !== undefined ? `David ${fmt(david)}` : "", pem !== undefined ? `PEM ${fmt(pem)}` : ""].filter(Boolean).join(", ")}>
        {pk && <span className={s.mPk} style={{ left: at(0) }} aria-hidden />}
        {pk && (
          <span className={s.mPkLabel} style={{ left: at(0) }} aria-hidden>
            PK
          </span>
        )}
        <span className={s.mMarket} style={{ left: at(market) }} />
        {pem !== undefined && <span className={`${s.mDot} ${s.mPem}`} style={{ left: at(pem) }} />}
        {david !== undefined && <span className={`${s.mDot} ${s.mDavid}`} style={{ left: at(david) }} />}
        {sam !== undefined && <span className={`${s.mDot} ${s.mSam}`} style={{ left: at(sam) }} />}
      </div>
      {pk && (
        <div className={s.mSides} aria-hidden>
          <span>{`‹ ${pk.below} favored`}</span>
          <span>{`${pk.above} favored ›`}</span>
        </div>
      )}
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

/**
 * Who decides a section's bets (the Ledger redesign, 2026-10-22): the one model
 * that can move money stays in view, everything else folds into one line. Each
 * carries one status from a fixed set, so a page never implies an unconfirmed
 * model is driving a real bet.
 */
export type ModelStatus = "active" | "collecting" | "projections" | "input" | "unavailable";
export interface ModelRow {
  name: string;
  role: string;
  status: ModelStatus;
  note: string;
}
const MODEL_STATUS: { [k in ModelStatus]: [string, string] } = {
  active: ["Sets real stakes", s.msActive],
  collecting: ["Collecting evidence", s.msCollecting],
  projections: ["Projections only", s.msProjections],
  input: ["Input to a rule", s.msInput],
  unavailable: ["Unavailable", s.msUnavailable],
};
export const statusChip = (st: ModelStatus) => <span className={`${s.ms} ${MODEL_STATUS[st][1]}`}>{MODEL_STATUS[st][0]}</span>;

function ModelLine({ m }: { m: ModelRow }) {
  return (
    <div className={s.drv}>
      <div className={s.drvHead}>
        <div>
          <b>{m.name}</b>
          <div className={s.drvRole}>{m.role}</div>
        </div>
        {statusChip(m.status)}
      </div>
      <p className={s.drvNote}>{m.note}</p>
    </div>
  );
}

/** Every model at once, for the Today overview. */
export function ModelGrid({ models }: { models: ModelRow[] }) {
  return (
    <div className={s.lineupGrid}>
      {models.map((m) => (
        <ModelLine key={m.name} m={m} />
      ))}
    </div>
  );
}

export function ModelLineup({ title, aside, models }: { title: string; aside: string; models: ModelRow[] }) {
  const lead = models.find((m) => m.status === "active") ?? models[0];
  const rest = models.filter((m) => m !== lead);
  const kinds = [...new Set(rest.map((m) => MODEL_STATUS[m.status][0].toLowerCase()))].join(", ");
  return (
    <section className={s.lineup} aria-label={title}>
      <SecHead title={title} aside={aside} />
      {lead && <ModelLine m={lead} />}
      {rest.length > 0 && (
        <details className={s.lineupMore}>
          <summary>
            <span>{`${rest.length} more model${rest.length === 1 ? "" : "s"} and inputs`}</span>
            <span className={s.muted}>{rest.some((m) => m.status === "active") ? kinds : `none of these stakes on its own · ${kinds}`}</span>
          </summary>
          <div className={s.lineupGrid}>
            {rest.map((m) => (
              <ModelLine key={m.name} m={m} />
            ))}
          </div>
        </details>
      )}
    </section>
  );
}

/** 90% Wilson range for a win rate. */
function wilson(w: number, n: number, z = 1.645): [number, number] {
  if (!n) return [0, 0];
  const p = w / n;
  const d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const r = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [(c - r) / d, (c + r) / d];
}

export interface CutRow {
  label: string;
  w: number;
  l: number;
  p?: number;
  /** Break-even win rate at the price graded (0.524 at -110); omitted for mixed long prices. */
  be?: number;
  units?: number;
  note?: string;
}

/**
 * Cut comparisons, folded (the Ledger redesign): each cut's win rate on a 0-100% bar, its 90% range as
 * a band, and the break-even tick. A band wholly right of the tick is the evidence a cut needs.
 */
export function CutRanges({ title, aside, rows, open }: { title: string; aside?: string; rows: CutRow[]; open?: boolean }) {
  const pc = (x: number) => `${(x * 100).toFixed(1)}%`;
  return (
    <details className={s.lineupMore} open={open}>
      <summary>
        <span>{title}</span>
        <span className={s.muted}>{aside ?? (rows.length ? `${rows.length} cuts · win rate, 90% range, break-even` : "No graded games yet")}</span>
      </summary>
      {rows.length ? (
        <div className={s.cutList}>
          {rows.map((c) => {
            const n = c.w + c.l;
            const [lo, hi] = wilson(c.w, n);
            const rate = n ? c.w / n : 0;
            const tone = c.be === undefined ? "" : hi < c.be ? s.cutBad : lo > c.be ? s.cutGood : "";
            return (
              <div key={c.label} className={s.cutRow}>
                <div className={s.cutName}>
                  <b>{c.label}</b>
                  <small className={s.num}>{`${c.w}-${c.l}${c.p ? `-${c.p}` : ""}${n ? ` · range ${Math.round(lo * 100)}% to ${Math.round(hi * 100)}%` : ""}`}</small>
                </div>
                <div className={s.range} role="img" aria-label={`Win rate ${pc(rate)}, 90% range ${pc(lo)} to ${pc(hi)}${c.be !== undefined ? `, break-even ${pc(c.be)}` : ""}`}>
                  <span className={s.rangeAxis} />
                  {n > 0 && <span className={`${s.rangeBand} ${tone}`} style={{ left: pc(lo), width: pc(hi - lo) }} />}
                  {c.be !== undefined && <span className={s.rangeBe} style={{ left: pc(c.be) }} />}
                  {n > 0 && <span className={s.rangeDot} style={{ left: pc(rate) }} />}
                </div>
                <div className={s.cutStat}>
                  <span className={c.be === undefined ? "" : rate >= c.be ? s.pos : s.neg}>{n ? pc(rate) : "·"}</span>
                  <small>{c.units !== undefined ? `${c.units >= 0 ? "+" : "−"}${Math.abs(c.units).toFixed(1)}u` : c.be !== undefined ? `break-even ${pc(c.be)}` : ""}</small>
                </div>
              </div>
            );
          })}
          <p className={s.thin}>The bar runs 0 to 100%. The band is the 90% range for the true win rate, the dot is the record so far, the dashed tick is break-even. A band wholly right of the tick is the evidence a cut needs.</p>
        </div>
      ) : (
        <p className={s.calm}>Cut comparisons start once the first games are graded.</p>
      )}
    </details>
  );
}

/** One model or slice the learner is tracking, with how far it is toward its gate. */
export interface TrackRow {
  id: string;
  label: string;
  status: "testing" | "live" | "back" | "report";
  games: number;
  needGames: number;
  /** Omitted when the store hasn't recorded weeks yet. */
  weeks?: number;
  needWeeks: number;
  /** Results so far, in a few words ("+1.4u over 52 bets"). */
  result?: string;
  /** What it still needs, or why it stands where it does. */
  note?: string;
}

const TRACK_KIND: { [k in TrackRow["status"]]: [string, string] } = { testing: ["Testing", ""], live: ["Live", s.kLive], back: ["Rolled back", s.kBack], report: ["Report only", ""] };

function TrackBar({ label, have, need }: { label: string; have: number; need: number }) {
  const pct = need > 0 ? Math.min(1, have / need) : 1;
  return (
    <div className={s.tkBar}>
      <span className={s.tkBarLabel}>{label}</span>
      <span className={s.tkTrack} role="img" aria-label={`${label}: ${have} of ${need}`}>
        <span className={`${s.tkFill} ${pct >= 1 ? s.tkDone : ""}`} style={{ width: `${(pct * 100).toFixed(1)}%` }} />
      </span>
      <span className={s.tkNum}>{`${have} / ${need}`}</span>
    </div>
  );
}

/** "Tracking in the background": every model or slice still being measured, with progress bars toward its gate. */
export function TrackingProgress({ rows, sub, empty }: { rows: TrackRow[]; sub: string; empty: string }) {
  const frac = (r: TrackRow) => Math.min(1, r.games / Math.max(1, r.needGames)) + (r.weeks !== undefined ? Math.min(1, r.weeks / Math.max(1, r.needWeeks)) : 0);
  const order: TrackRow["status"][] = ["live", "testing", "report", "back"];
  const sorted = [...rows].sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status) || frac(b) - frac(a) || a.label.localeCompare(b.label));
  const testing = rows.filter((r) => r.status === "testing").length;
  return (
    <div className={s.section}>
      <div className={s.sectionHead}>
        <h3 className={s.h2}>Tracking in the background</h3>
        <p className={s.p}>{`${testing ? `${testing} ${testing === 1 ? "model" : "models"} collecting games, none of it bet. ` : ""}${sub}`}</p>
      </div>
      {sorted.length ? (
        <ul className={s.tkList}>
          {sorted.map((r) => (
            <li key={r.id} className={s.tkRow}>
              <div className={s.tkHead}>
                <b>{r.label}</b>
                <span className={`${s.logKind} ${TRACK_KIND[r.status][1]}`}>{TRACK_KIND[r.status][0]}</span>
              </div>
              <TrackBar label="Games" have={r.games} need={r.needGames} />
              {r.weeks !== undefined && <TrackBar label="Weeks" have={r.weeks} need={r.needWeeks} />}
              {(r.result || r.note) && <p className={s.tkNote}>{[r.result, r.note].filter(Boolean).join(" · ")}</p>}
            </li>
          ))}
        </ul>
      ) : (
        <p className={s.calm}>{empty}</p>
      )}
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
