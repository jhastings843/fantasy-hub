import type { Metadata } from "next";
import Link from "next/link";
import { getMoneyView } from "@/lib/money/store";
import type { Book } from "@/lib/money/types";
import BookChart from "../../BookChart";
import { Hero, LearnerLog, Stats } from "../../../picks/board";
import { booksLog } from "../../desks";
import s from "../../../picks/picks.module.css";
import m from "../../money.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Stock book · Money · Hobby Hub",
  description: "One paper stock book: its chart against SPY, the strategy in plain English, what it holds and every trade.",
};

// /money/book/[id]: one stock book, opened from its chart on the Stock books
// tab. Built from the snapshot alone, so every book the trade-bot adds later
// gets this page with no change here.

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const pct = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(n * 100).toFixed(2)}%`;
const day = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/** The deepest fall from a running high, as a share of that high. */
function worstDrop(b: Book): number {
  let peak = b.start;
  let worst = 0;
  for (const c of b.curve) {
    peak = Math.max(peak, c.equity);
    worst = Math.max(worst, (peak - c.equity) / peak);
  }
  return worst;
}

export default async function BookPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const v = await getMoneyView().catch(() => null);
  const snap = v?.snapshot;
  const b = snap?.books.find((x) => x.id === id);
  if (!snap || !b) {
    return (
      <main className={s.page}>
        <div className={s.wrap}>
          <Link href="/money?v=books" className={s.linkA}>
            ‹ Stock books
          </Link>
          <p className={s.calm}>That book isn&apos;t in the latest snapshot.</p>
        </div>
      </main>
    );
  }
  const ret = b.equity / b.start - 1;
  const spy = b.spyEquity !== null ? b.spyEquity / b.start - 1 : null;
  const grade = snap.grades?.books.find((g) => g.book === b.id);
  const log = booksLog((snap.learnLog ?? []).map((e) => ({ ...e, decisions: e.decisions.filter((d) => d.book === b.id || d.book === b.label) }))).filter((e) => !/no changes/.test(e.title));
  const invested = b.positions.reduce((a, p) => a + p.shares * (p.last ?? p.entryPrice), 0);
  const days = b.curve.length;
  const trades = b.fills.map((f) => ({ day: f.day, text: `${f.side === "buy" || /buy/i.test(f.side) ? "Bought" : "Sold"} ${f.symbol}` }));
  return (
    <main className={s.page}>
      <div className={s.wrap}>
        <Link href="/money?v=books" className={s.linkA} style={{ fontSize: 14 }}>
          ‹ Stock books
        </Link>
        <section className={s.section} aria-labelledby="book">
          <Hero
            eyebrow={`Stock book · paper · started ${day(b.started)}${b.retired ? ` · retired ${day(b.retired)}` : ""}`}
            title={
              <span id="book">
                {`${b.label}: `}
                <span className={ret >= 0 ? s.up : s.down}>{pct(ret)}</span>
              </span>
            }
            sub={spy !== null ? `${ret >= spy ? "Ahead of" : "Behind"} the same money in SPY by ${pct(Math.abs(ret - spy)).replace(/^[+−]/, "")} (SPY ${pct(spy)} over the same days).` : b.about}
          />
          <Stats
            label={`${b.label} at a glance`}
            items={[
              { k: "Value", v: usd(b.equity), sub: `from ${usd(b.start)}`, tone: ret > 0 ? "up" : ret < 0 ? "down" : undefined },
              { k: "Against SPY", v: spy !== null ? pct(ret - spy) : "·", sub: spy !== null ? `SPY ${pct(spy)}` : "no SPY mark yet", tone: spy !== null ? (ret >= spy ? "up" : "down") : undefined },
              { k: "Worst drop", v: pct(-worstDrop(b)), sub: "from its highest point" },
              { k: "Running", v: `${days} trading day${days === 1 ? "" : "s"}`, small: true, sub: `${b.fills.length} trade${b.fills.length === 1 ? "" : "s"}, ${b.positions.length} holding${b.positions.length === 1 ? "" : "s"}` },
            ]}
          />
          <div className={s.curveBox}>
            <BookChart points={b.curve} start={b.start} trades={trades} label={b.label} />
          </div>

          <div className={s.curveBox}>
            <h2 className={s.h2}>The strategy, in plain English</h2>
            <p className={s.p} style={{ fontSize: 16 }}>{b.strategy?.what ?? b.about}</p>
            {b.strategy?.how && (
              <>
                <h3 className={s.h3} style={{ margin: 0 }}>The exact rule</h3>
                <p className={s.p}>{b.strategy.how}</p>
              </>
            )}
            {b.strategy?.record && (
              <>
                <h3 className={s.h3} style={{ margin: 0 }}>Why it was opened</h3>
                <p className={s.p}>{b.strategy.record}</p>
              </>
            )}
            {!b.strategy && b.about && <p className={s.thin}>{b.about}</p>}
          </div>

          <div className={s.section}>
            <div className={s.sectionHead}>
              <h2 className={s.h2}>What it holds and why</h2>
              <p className={s.p}>{`${usd(invested)} in ${b.positions.length} position${b.positions.length === 1 ? "" : "s"}, ${usd(b.cash)} cash. Each line says what the strategy saw when it bought.`}</p>
            </div>
            {b.positions.length ? (
              <div className={s.gtable}>
                {b.positions.map((p) => {
                  const g = p.last !== null ? p.last / p.entryPrice - 1 : null;
                  return (
                    <div key={`${p.symbol}|${p.entryDay}`} className={m.holdRow}>
                      <b>{p.symbol}</b>
                      <span className={s.num}>{`${p.shares} sh at ${p.entryPrice.toFixed(2)}${p.last !== null ? `, now ${p.last.toFixed(2)}` : ""}`}</span>
                      <span className={`${s.num} ${g === null ? "" : g >= 0 ? s.pos : s.neg}`}>{g !== null ? pct(g) : "·"}</span>
                      <span className={m.holdWhy}>{`${p.reason} · since ${day(p.entryDay)}`}</span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className={s.calm}>All cash right now.</p>
            )}
          </div>

          {grade && (
            <div className={s.curveBox}>
              <h2 className={s.h2}>This week&apos;s grade</h2>
              <p className={s.p}>
                {`${grade.action === "retire" ? "Would be retired" : "Keeps running"}: ${grade.sessions} sessions, ${grade.excess !== null ? `${pct(grade.excess)} against SPY` : "no SPY comparison"}${grade.t !== null ? `, t ${grade.t.toFixed(2)}` : ""}${
                  grade.passes === null ? "" : grade.passes ? ", strategy still passes the lab's filter" : ", strategy fails the lab's filter"
                }. ${grade.why}`}
              </p>
            </div>
          )}

          {log.length > 0 && (
            <div className={s.section}>
              <h2 className={s.h2}>Learner log</h2>
              <LearnerLog entries={log.slice(0, 10)} empty="" />
            </div>
          )}

          <details className={s.bg}>
            <summary>{`Every trade (${b.fills.length})`}</summary>
            <div className={s.bgBody}>
              <ul className={s.log}>
                {[...b.fills].reverse().map((f, i) => (
                  <li key={`${f.day}|${f.symbol}|${i}`} className={s.logRow}>
                    <span className={s.logWhen}>{day(f.day)}</span>
                    <span className={s.logKind}>{/buy/i.test(f.side) ? "Bought" : "Sold"}</span>
                    <span className={s.logText}>
                      <b>{`${f.shares} ${f.symbol} at ${f.price.toFixed(2)}`}</b>
                      <span>{f.reason}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </details>
        </section>
      </div>
    </main>
  );
}
