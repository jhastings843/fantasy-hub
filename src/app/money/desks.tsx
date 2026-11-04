import { Disclosure } from "@/components/hh/ui";
// The Money redesign (2026-10-21, from the mock): each desk judged against
// its own yardstick, not just its balance. One row per desk on the overview,
// a headline on each desk's tab, and one learner log across desks. Dollars and
// units never get added together; each desk keeps its own chart.
import Link from "next/link";
import type { ReactNode } from "react";
import type { getMoneyView } from "@/lib/money/store";
import type { Book, Phil, Weather } from "@/lib/money/types";
import { Hero, LearnerLog, Stats, type LogEntry, type Stat } from "../picks/board";
export { LearnerLog, Stats };
import s from "../picks/picks.module.css";
import m from "./money.module.css";

type View = Awaited<ReturnType<typeof getMoneyView>>;

/** Phil's own page calls fewer than this many settled bets too few to judge. */
const PHIL_MIN = 30;

const usd = (n: number, signed = false) =>
  `${signed && n > 0 ? "+" : n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: Math.abs(n) < 100 ? 2 : 0, maximumFractionDigits: Math.abs(n) < 100 ? 2 : 0 })}`;
const units = (n: number) => `${n > 0 ? "+" : ""}${n.toFixed(2)}u`;
const pct = (n: number) => `${n > 0 ? "+" : ""}${(n * 100).toFixed(1)}%`;
const toneOf = (n: number): "up" | "down" | undefined => (n > 0 ? "up" : n < 0 ? "down" : undefined);

export interface Desk {
  id: string;
  /** Paper dollars or units: the two never share a table (the Ledger redesign, 2026-10-22). */
  money: "usd" | "units";
  name: string;
  what: string;
  result: string;
  rec: string;
  tone?: "up" | "down";
  /** The desk's number and the yardstick's, as bars when both are comparable (lower or higher wins). */
  ours: string;
  yard: string;
  bars?: { ours: number; yard: number };
  read: string;
  readTone: "good" | "bad" | "neutral";
  href: string;
  /** When present, clicking the row opens this list under it instead of navigating (Props, by prop type). */
  breakdown?: { label: string; result: string; rec: string; tone?: "up" | "down" }[];
}

export function booksTotals(books: Book[]) {
  const live = books.filter((b) => !b.retired);
  const start = books.reduce((a, b) => a + b.start, 0);
  const now = books.reduce((a, b) => a + b.equity, 0);
  const spy = books.reduce((a, b) => a + (b.spyEquity ?? b.start), 0);
  const ahead = live.filter((b) => b.spyEquity !== null && b.equity > b.spyEquity).length;
  return { start, now, spy, ahead, live: live.length, all: books.length };
}

function philDesk(p: Phil, id: string, name: string, what: string, href: string): Desk {
  const decided = p.settled > 0;
  const brier = p.brierPhil !== null && p.brierMarket !== null;
  const read = !decided ? "No bets settled" : p.settled < PHIL_MIN ? "Too early" : brier && p.brierPhil! < p.brierMarket! ? "Beating the market" : "Trailing the market";
  return {
    money: "usd",
    id,
    name,
    what,
    result: decided ? usd(p.equity - p.bankroll, true) : usd(0),
    rec: decided ? `${p.wins}-${p.settled - p.wins}` : `${p.open.length} open, ${usd(p.cash)} cash`,
    tone: decided ? toneOf(p.equity - p.bankroll) : undefined,
    ours: brier ? `Brier ${p.brierPhil!.toFixed(3)}` : "No score yet",
    yard: brier ? `Market ${p.brierMarket!.toFixed(3)}` : "Market's Brier on the same bets",
    ...(brier ? { bars: { ours: p.brierPhil!, yard: p.brierMarket! } } : {}),
    read,
    readTone: read === "Beating the market" ? "good" : read === "Trailing the market" ? "bad" : "neutral",
    href,
  };
}

function weatherDesk(w: Weather): Desk {
  const stop = w.brake?.level === "stop";
  const slow = w.brake?.level === "slow";
  const d = w.brake?.desk ?? w.learned.desk;
  const mk = w.brake?.market ?? w.learned.market;
  return {
    money: "usd",
    id: "weather",
    name: "Weather",
    what: "Daily highs on Kalshi",
    result: usd(w.equity - w.start, true),
    rec: `${w.record.won}-${w.record.settled - w.record.won}`,
    tone: toneOf(w.equity - w.start),
    ours: d !== null ? `Brier ${d.toFixed(3)}` : "No score yet",
    yard: mk !== null ? `Market ${mk.toFixed(3)}` : "Market's Brier",
    ...(d !== null && mk !== null ? { bars: { ours: d, yard: mk } } : {}),
    read: stop ? "Brake on" : slow ? "Quarter stakes" : d !== null && mk !== null ? (d < mk ? "Beating the market" : "Trailing the market") : "Too early",
    readTone: stop || slow || (d !== null && mk !== null && d >= mk) ? "bad" : d !== null && mk !== null ? "good" : "neutral",
    href: "/money?v=weather",
  };
}

export function desks(v: View): Desk[] {
  const out: Desk[] = [];
  const snap = v.snapshot;
  const sp = v.sports;
  if (sp) {
    const p = sp.picks.reduce((a, x) => ({ u: a.u + x.units, w: a.w + x.w, l: a.l + x.l, pu: a.pu + x.p }), { u: 0, w: 0, l: 0, pu: 0 });
    out.push({
      id: "picks",
      money: "units",
      name: "Picks",
      what: "Issued spread bets, NFL and college",
      result: units(p.u),
      rec: `${p.w}-${p.l}${p.pu ? `-${p.pu}` : ""}`,
      tone: toneOf(p.u),
      ours: units(p.u),
      yard: "Break-even 0u",
      read: p.w + p.l ? (p.u >= 0 ? "Up" : "Down") : "No bets settled",
      readTone: p.w + p.l ? (p.u >= 0 ? "good" : "bad") : "neutral",
      href: "/picks?v=results",
    });
  }
  if (snap?.phil && !snap.phil.error) out.push(philDesk(snap.phil, "phil", "Phil", "Claude agent, Polymarket", "/money?v=phil"));
  if (snap?.weather) out.push(weatherDesk(snap.weather));
  if (snap?.books.length) {
    const b = booksTotals(snap.books);
    out.push({
      id: "books",
      money: "usd",
      name: "Stock books",
      what: `${b.live} books, ${usd(snap.books[0].start)} each`,
      result: pct(b.now / b.start - 1),
      rec: `${b.ahead} of ${b.live} ahead of SPY`,
      tone: toneOf(b.now - b.start),
      ours: `All books ${pct(b.now / b.start - 1)}`,
      yard: `SPY ${pct(b.spy / b.start - 1)} same days`,
      read: b.now > b.spy ? "Ahead of SPY" : b.now < b.spy ? "Behind SPY" : "Level with SPY",
      readTone: b.now > b.spy ? "good" : b.now < b.spy ? "bad" : "neutral",
      href: "/money?v=books",
    });
  }
  const tb = snap?.trends && !snap.trends.error ? snap.trends.book : null;
  if (tb) {
    const ret = tb.equity / tb.start - 1;
    const spy = tb.spyEquity !== null ? tb.spyEquity / tb.start - 1 : null;
    const r = snap!.trends!.record;
    out.push({
      id: "trends",
      money: "usd",
      name: "Trend themes",
      what: "Claude picks trending companies",
      result: pct(ret),
      rec: r?.n ? `${r.n} picks graded` : "No picks graded yet",
      tone: toneOf(ret),
      ours: `Book ${pct(ret)}`,
      yard: spy !== null ? `SPY ${pct(spy)} same days` : "SPY, same days",
      read: !r?.n || r.n < 30 ? "Too early" : spy !== null && ret > spy ? "Ahead of SPY" : "Behind SPY",
      readTone: !r?.n || r.n < 30 ? "neutral" : spy !== null && ret > spy ? "good" : "bad",
      href: "/money?v=trends",
    });
  }
  const ix = snap?.intraday && !snap.intraday.error ? snap.intraday : null;
  if (ix) {
    const start = ix.start ?? 100_000;
    const ret = (ix.equity ?? start) / start - 1;
    const spy = ix.spyEquity != null ? ix.spyEquity / start - 1 : null;
    const days = ix.record?.days ?? (ix.curve ?? []).length;
    const early = days < 20;
    out.push({
      id: "intraday",
      money: "usd",
      name: "Day Trader",
      what: "Opening-range breakouts, Time Machine filter",
      result: pct(ret),
      rec: days ? `${days} ${days === 1 ? "session" : "sessions"}, ${ix.record?.taken.n ?? 0} trades` : "Waiting for the first session",
      tone: toneOf(ret),
      ours: `Book ${pct(ret)}`,
      yard: spy !== null ? `SPY ${pct(spy)} open to close` : "SPY, open to close",
      read: early ? "Too early" : spy !== null && ret > spy ? "Ahead of SPY" : "Behind SPY",
      readTone: early ? "neutral" : spy !== null && ret > spy ? "good" : "bad",
      href: "/money?v=intraday",
    });
  }
  if (snap?.gus && !snap.gus.error) out.push(philDesk(snap.gus, "kalshi", "Gus", "Claude agent, Kalshi", "/money?v=kalshi"));
  // Props join only once something is staked (Jack, 2026-11-02: "tracked records shouldn't show up until we are putting stakes down").
  // Staked = bets from learner slices that went live (models/money.ts "system"); tracked edges stay on the Props pages.
  const staked = sp ? sp.props.reduce((a, x) => ({ u: a.u + x.system, n: a.n + x.systemBets }), { u: 0, n: 0 }) : { u: 0, n: 0 };
  if (sp && staked.n) {
    out.push({
      id: "props",
      money: "units",
      name: "Props",
      what: "Staked prop bets from our models",
      result: units(staked.u),
      rec: `${staked.n} graded`,
      tone: toneOf(staked.u),
      ours: units(staked.u),
      yard: "Break-even 0u",
      read: staked.u >= 0 ? "Up" : "Down",
      readTone: staked.u >= 0 ? "good" : "bad",
      href: "/props?v=results",
    });
  }
  return out;
}

const READ_CLS = { good: s.readW, bad: s.readL, neutral: s.readTrack };

export function DeskTable({ list }: { list: Desk[] }) {
  return (
    <div className={s.gtable}>
      <div className={`${m.deskHead} ${m.deskGrid}`} aria-hidden>
        <span>Desk</span>
        <span>Result</span>
        <span>Yardstick</span>
        <span>Read</span>
        <span />
      </div>
      {list.map((d) => {
        const top = d.bars ? Math.max(d.bars.ours, d.bars.yard, 1e-9) : 1;
        const cells = (
          <>
            <span className={m.deskName}>
              <b>{d.name}</b>
              <span>{d.what}</span>
            </span>
            <span className={m.deskResult}>
              <b className={d.tone === "up" ? s.pos : d.tone === "down" ? s.neg : ""}>{d.result}</b>
              <span className={s.num}>{d.rec}</span>
            </span>
            <span className={s.bars}>
              <span>
                {d.bars && <i className={s.barOurs} style={{ width: `${(d.bars.ours / top) * 140}px` }} />}
                {d.ours}
              </span>
              <span style={{ color: "var(--ink2)" }}>
                {d.bars && <i className={s.barMkt} style={{ width: `${(d.bars.yard / top) * 140}px` }} />}
                {d.yard}
              </span>
            </span>
            <span className={`${s.readChip} ${READ_CLS[d.readTone]}`}>{d.read}</span>
          </>
        );
        if (d.breakdown?.length)
          return (
            <details key={d.id} className={m.deskDetails}>
              <summary className={`${m.deskRow} ${m.deskGrid}`}>
                {cells}
                <span className={`${s.chev} ${m.deskToggle}`} aria-hidden>
                  ›
                </span>
              </summary>
              <ul className={m.deskBreak}>
                {d.breakdown.map((b) => (
                  <li key={b.label}>
                    <span>{b.label}</span>
                    <span className={s.num}>{b.rec}</span>
                    <b className={`${s.num} ${b.tone === "up" ? s.pos : b.tone === "down" ? s.neg : ""}`}>{b.result}</b>
                  </li>
                ))}
                <li className={m.deskBreakLink}>
                  <Link href={d.href}>Open {d.name} results ›</Link>
                </li>
              </ul>
            </details>
          );
        return (
          <Link key={d.id} href={d.href} className={`${m.deskRow} ${m.deskGrid}`}>
            {cells}
            <span className={s.chev} aria-hidden>
              ›
            </span>
          </Link>
        );
      })}
    </div>
  );
}

/** Every desk's latest learning, newest first: Phil's retros, the stock learner's decisions, the weather brake and re-fit. */
export function moneyLog(v: View): LogEntry[] {
  const snap = v.snapshot;
  const out: LogEntry[] = [];
  const w = snap?.weather;
  if (w?.brake && w.brake.level !== "off" && w.brake.desk !== null && w.brake.market !== null)
    out.push({
      at: w.generatedAt,
      kind: "brake",
      title: `Weather desk: ${w.brake.level === "stop" ? "stopped betting" : "cut to quarter stakes"}`,
      detail: `Over the last week the market scored ${w.brake.market.toFixed(3)} to the desk's ${w.brake.desk.toFixed(3)} across ${w.brake.n} city-days. It bets again once its week beats the market's.`,
    });
  if (w) out.push({ at: w.generatedAt, kind: "test", title: `Weather desk trusts its own forecast ${Math.round(w.trust.w * 100)}%`, detail: `Blended with the market for the rest, re-fit from ${w.trust.days} settled days.` });
  for (const [p, who] of [
    [snap?.phil, "Phil"],
    [snap?.gus, "Gus"],
  ] as const) {
    for (const r of (p?.learner ?? []).slice(0, 3)) if (r.ts) out.push({ at: r.ts, kind: r.changes.length ? "new" : "test", title: `${who}: ${r.headline}`, detail: [...r.changes, ...r.lessons].slice(0, 2).join(" ") || undefined });
  }
  for (const e of (snap?.learnLog ?? []).slice(0, 4)) {
    const at = `${e.day}T21:00:00Z`;
    if (!e.decisions.length) out.push({ at, kind: "test", title: "Stock books: reviewed, no changes", detail: e.lessons ?? undefined });
    for (const d of e.decisions) out.push({ at, kind: /retire|close|drop/i.test(d.action) ? "back" : /open|add|promot/i.test(d.action) ? "new" : "test", title: `Stock books: ${d.action} ${d.book}`, detail: d.why });
  }
  return out.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 14);
}

export function MoneyHero({ list }: { list: Desk[] }) {
  const brake = list.filter((d) => d.read === "Brake on" || d.read === "Quarter stakes").length;
  const stats: Stat[] = list.slice(0, 4).map((d) => ({ k: d.name, v: d.result, sub: d.rec, tone: d.tone }));
  return (
    <>
      <Hero
        eyebrow="Paper money and betting units"
        title={`${list.length} desk${list.length === 1 ? "" : "s"} running${brake ? `, ${brake === 1 ? "one" : brake} on the brake` : ""}`}
        sub="Each desk is judged against its own yardstick, not just its balance. Open a desk for its bets, holdings and log."
      />
      <Stats items={stats} label="Each desk's result" />
    </>
  );
}

export function MoneyLogSection({ entries }: { entries: LogEntry[] }) {
  return (
    <Disclosure summary="Learner log, every desk"><div className={s.section}>
      <h3 className={s.h2}>Learner log, every desk</h3>
      <LearnerLog entries={entries} empty="Nothing logged yet. Each desk posts its learning with its next run." />
      <p className={s.thin}>
        Picks and props keep their own logs: <Link href="/picks?v=log">Picks learner log</Link>, <Link href="/props?v=log">Props learner log</Link>.
      </p>
    </div></Disclosure>
  );
}

/** A desk tab's headline: the result in one line and the yardstick under it. */
export function DeskHero({ eyebrow, title, sub }: { eyebrow: string; title: ReactNode; sub?: ReactNode }) {
  return <Hero eyebrow={eyebrow} title={title} sub={sub} />;
}

export function WeatherBrake({ w }: { w: Weather }) {
  const d = w.brake?.desk ?? w.learned.desk;
  const mk = w.brake?.market ?? w.learned.market;
  if (d === null || mk === null) return null;
  return (
    <BrierGauge
      title={w.brake?.level === "stop" ? "What turns the brake off" : "Desk against the market"}
      ours={d}
      ourLabel="Desk"
      mkt={mk}
      mktLabel="Market"
      note={`Brier score over the last ${w.brake?.n ?? w.learned.scored} city-days; the shorter bar wins.${w.brake?.level === "stop" ? " The desk bets again once its bar is shorter than the market's." : ""}`}
    />
  );
}

/** Two Brier bars, desk against its yardstick: the shorter bar wins. */
export function BrierGauge({ title, ours, ourLabel, mkt, mktLabel, note }: { title: string; ours: number; ourLabel: string; mkt: number; mktLabel: string; note: string }) {
  const top = Math.max(ours, mkt, 1e-9);
  return (
    <div className={m.gauge}>
      <h3 className={s.h3} style={{ margin: 0 }}>
        {title}
      </h3>
      {(
        [
          [ourLabel, ours, s.barOurs],
          [mktLabel, mkt, s.barMkt],
        ] as const
      ).map(([label, x, cls]) => (
        <div key={label} className={m.gaugeRow}>
          <b>{label}</b>
          <span className={m.gaugeTrack}>
            <i className={cls} style={{ width: `${(x / top) * 100}%` }} />
          </span>
          <span className={s.num}>{x.toFixed(3)}</span>
        </div>
      ))}
      <p className={s.thin}>{note}</p>
    </div>
  );
}

/** A Claude agent's retros as learner-log lines: the headline, then its changes or lessons. */
export function retroLog(log: { ts: string | null; headline: string; changes: string[]; lessons: string[] }[]): LogEntry[] {
  return log.flatMap((r) => (r.ts ? [{ at: r.ts, kind: r.changes.length ? ("new" as const) : ("test" as const), title: r.headline, detail: [...r.changes, ...r.lessons].slice(0, 2).join(" ") || undefined }] : []));
}

/** The stock learner's weekly entries as log lines. */
/** 5am Eastern on a YYYY-MM-DD day, as ISO: when launchd runs the weekly learner (Saturday 5:00). */
export function fiveAmEt(day: string): string {
  // EDT is UTC-4, EST is UTC-5; take the offset whose Eastern hour reads 5.
  for (const off of ["-04:00", "-05:00"]) {
    const d = new Date(`${day}T05:00:00${off}`);
    if (Number(d.toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false })) === 5) return d.toISOString();
  }
  return new Date(`${day}T10:00:00Z`).toISOString();
}

export function booksLog(log: { day: string; decisions: { action: string; book: string; why: string }[]; lessons: string | null }[]): LogEntry[] {
  return log.flatMap((e): LogEntry[] => {
    const at = fiveAmEt(e.day);
    if (!e.decisions.length) return [{ at, kind: "test" as const, title: "Reviewed every book, no changes", detail: e.lessons ?? undefined }];
    return e.decisions.map((d) => ({ at, kind: (/retire|close|drop/i.test(d.action) ? "back" : /open|add|promot/i.test(d.action) ? "new" : "test") as LogEntry["kind"], title: `${d.action} ${d.book}`, detail: d.why }));
  });
}
