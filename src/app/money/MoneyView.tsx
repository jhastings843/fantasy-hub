import Link from "next/link";
import { getMoneyView } from "@/lib/money/store";
import type { MoneyBet } from "@/lib/money/bets";
import type { Book, Grades, Kalshi, KalshiRow, LearnEntry, Phil, PhilBet, PhilLearn, Weather, WeatherBet, WeatherCity, WeatherDay } from "@/lib/money/types";
import { LineChart } from "./Chart";
import s from "../picks/picks.module.css";
import m from "./money.module.css";

// The Money tab: Jack's own bets, Phil (the Polymarket paper agent) and the
// paper stock books, all paper or unit-based. Bets live in this app;
// Phil and the books are a snapshot posted from Jack's Mac after each run.
// The Kalshi tab holds Kalshi Phil (a separate agent paper-trading Kalshi,
// same shape as Phil) and Phil's own Kalshi shadow record. Neither is ever
// added into Phil's Polymarket numbers.

export type MoneyTab = "overview" | "bets" | "phil" | "kalshi" | "books" | "weather";
// My bets is hidden for now (Jack, 2026-10-15): the logged plays weren't
// actually bet. The code and the logged data stay; flip this to bring it back.
const SHOW_BETS = false;
const TABS: { id: MoneyTab; label: string }[] = [
  { id: "overview", label: "Overview" },
  ...(SHOW_BETS ? [{ id: "bets" as const, label: "My bets" }] : []),
  { id: "phil", label: "Phil" },
  { id: "kalshi", label: "Kalshi" },
  { id: "books", label: "Stock books" },
  { id: "weather", label: "Weather" },
];
export const parseMoneyTab = (x: unknown): MoneyTab => (TABS.some((t) => t.id === x) ? (x as MoneyTab) : "overview"); // hidden tabs fall back to Overview
const href = (t: MoneyTab) => (t === "overview" ? "/money" : `/money?v=${t}`);

const usd = (n: number, signed = false) =>
  `${signed && n > 0 ? "+" : n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: Math.abs(n) < 100 ? 2 : 0, maximumFractionDigits: Math.abs(n) < 100 ? 2 : 0 })}`;
const units = (n: number) => `${n > 0 ? "+" : ""}${n.toFixed(2)}u`;
const pct = (n: number) => `${n > 0 ? "+" : ""}${(n * 100).toFixed(1)}%`;
const tone = (n: number) => (n > 0 ? s.pos : n < 0 ? s.neg : "");
const clockEt = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }).replace(" AM", "am").replace(" PM", "pm");
const shortDay = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const t = (iso: string) => Date.parse(iso.length === 10 ? `${iso}T16:00:00Z` : iso);
const when = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });
const price = (p: number) => (p > 0 ? `+${p}` : `${p}`);

function Outcome({ o }: { o: string }) {
  const label = o === "W" ? "Won" : o === "L" ? "Lost" : o === "P" ? "Push" : o === "void" ? "Void" : o === "won" ? "Won" : o === "lost" ? "Lost" : "Open";
  const cls = o === "W" || o === "won" ? m.oW : o === "L" || o === "lost" ? m.oL : m.oOpen;
  return <span className={`${m.outcome} ${cls}`}>{label}</span>;
}

/* ------------------------------------------------------------- bets ---- */

function betChart(bets: Awaited<ReturnType<typeof getMoneyView>>["summary"], height?: number, width?: number) {
  const pts = bets.curve.map((c) => ({ x: t(c.at), y: c.net }));
  if (pts.length) pts.unshift({ x: pts[0].x - 3600_000, y: 0 });
  const empty = bets.pending
    ? `${bets.pending} ${bets.pending === 1 ? "bet" : "bets"} open. The line starts once the first one is graded.`
    : "No bets logged yet.";
  return <LineChart series={[{ label: "Net units", points: pts, tone: "auto" }]} baseline={0} format={units} height={height} width={width} empty={empty} ariaLabel="Net units over time" />;
}

function BetRow({ b }: { b: MoneyBet }) {
  return (
    <tr>
      <td>
        <div className={s.play}>{b.label}</div>
        <div className={m.why}>
          {b.away} at {b.home} · {new Date(`${b.date}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
          {b.source ? ` · ${b.source}` : ""}
          {b.result?.actual ? ` · ${b.result.actual}` : ""}
        </div>
      </td>
      <td className={s.num}>{b.units}u</td>
      <td className={s.num}>{price(b.price)}</td>
      <td>{b.result ? <Outcome o={b.result.outcome} /> : <Outcome o="open" />}</td>
      <td className={`${s.num} ${b.result ? tone(b.result.net) : s.muted}`}>{b.result ? units(b.result.net) : "pending"}</td>
    </tr>
  );
}

function BetsTab({ v }: { v: Awaited<ReturnType<typeof getMoneyView>> }) {
  const { summary: sm, bets } = v;
  const pending = bets.filter((b) => !b.result);
  const graded = bets.filter((b) => b.result);
  return (
    <section className={s.section}>
      <div className={s.tiles}>
        <div className={`${s.tile} ${sm.net > 0 ? s.good : sm.net < 0 ? s.bad : ""}`}>
          <span className={s.tileV}>{units(sm.net)}</span>
          <span className={s.tileK}>net, all graded bets</span>
        </div>
        <div className={s.tile}>
          <span className={s.tileV}>{`${sm.wins}-${sm.losses}${sm.pushes ? `-${sm.pushes}` : ""}`}</span>
          <span className={s.tileK}>record</span>
        </div>
        <div className={s.tile}>
          <span className={s.tileV}>{sm.roi === null ? "n/a" : pct(sm.roi)}</span>
          <span className={s.tileK}>return on units risked</span>
        </div>
        <div className={s.tile}>
          <span className={s.tileV}>{sm.pending}</span>
          <span className={s.tileK}>waiting on a final</span>
        </div>
      </div>
      <div className={m.panel}>{betChart(sm)}</div>
      {pending.length > 0 && (
        <div className={m.panel}>
          <h2 className={m.panelTitle}>Open</h2>
          <div className={m.scroll}>
            <table className={s.table}>
              <thead><tr><th>Bet</th><th>Risk</th><th>Price</th><th>Status</th><th>Net</th></tr></thead>
              <tbody>{pending.map((b) => <BetRow key={b.id} b={b} />)}</tbody>
            </table>
          </div>
        </div>
      )}
      <div className={m.panel}>
        <h2 className={m.panelTitle}>Graded</h2>
        {graded.length ? (
          <div className={m.scroll}>
            <table className={s.table}>
              <thead><tr><th>Bet</th><th>Risk</th><th>Price</th><th>Result</th><th>Net</th></tr></thead>
              <tbody>{graded.map((b) => <BetRow key={b.id} b={b} />)}</tbody>
            </table>
          </div>
        ) : (
          <p className={s.calm}>Nothing graded yet. Bets grade themselves from ESPN once the game is final.</p>
        )}
      </div>
      <p className={s.notice}>
        These are your own cards, logged when we size them. Units are risked, and a win pays at the logged price. Sides, totals and first-half
        bets grade from ESPN&apos;s final and halftime scores, player props from the box score (a player who didn&apos;t play is void).
        The bets the picks email sends are tracked on <Link href="/picks?v=results">Picks</Link>.
      </p>
    </section>
  );
}

/* ------------------------------------------------------------- phil ---- */

const who = (p: Phil) => (p.venue === "kalshi" ? "Kalshi Phil" : "Phil");

function philChart(p: Phil, height?: number, width?: number) {
  return (
    <LineChart
      series={[{ label: who(p), points: p.curve.map((c) => ({ x: t(c.ts), y: c.equity })), tone: "auto" }]}
      baseline={p.bankroll}
      format={(y) => usd(y)}
      height={height}
      width={width}
      ariaLabel={`${who(p)}'s paper bankroll after each settled bet`}
    />
  );
}

function PhilRow({ b }: { b: PhilBet }) {
  const kalshi = b.venue === "kalshi";
  const link = kalshi
    ? (b.series ? `https://kalshi.com/markets/${b.series.toLowerCase()}` : null)
    : (b.slug ? `https://polymarket.com/event/${b.slug}` : null);
  return (
    <tr>
      <td>
        <div>{link ? <a href={link} target="_blank" rel="noreferrer">{b.question}</a> : b.question}</div>
        <div className={m.why}>
          {b.outcome} at {b.entry !== null ? `${(b.entry * 100).toFixed(kalshi ? 1 : 0)}¢${kalshi ? " all in" : ""}` : "?"} · {kalshi ? "Kalshi Phil" : "Phil"} said {b.est !== null ? `${Math.round(b.est * 100)}%` : "?"}
          {kalshi && b.contracts ? ` · ${b.contracts} contracts` : ""}
          {b.category ? ` · ${b.category}` : ""}
        </div>
      </td>
      <td className={s.num}>{b.stake !== null ? usd(b.stake) : ""}</td>
      <td><Outcome o={b.status} /></td>
      <td className={`${s.num} ${b.pnl !== null ? tone(b.pnl) : s.muted}`}>{b.pnl !== null ? usd(b.pnl, true) : b.endDate ? `ends ${when(b.endDate)}` : ""}</td>
    </tr>
  );
}

function PhilRetro({ e }: { e: PhilLearn }) {
  return (
    <ul className={m.logList}>
      {e.lessons.map((x, i) => <li key={`l${i}`}><Tag k="lesson" />{x}</li>)}
      {e.changes.map((x, i) => <li key={`c${i}`}><Tag k="changed" />{x}</li>)}
      {e.noted.map((x, i) => <li key={`n${i}`}><Tag k="noted" /><span className={m.why}>{x}</span></li>)}
      {e.review && <li><Tag k="review" /><span className={m.why}>{e.review}</span></li>}
      {!e.lessons.length && !e.changes.length && !e.noted.length && !e.review && <li className={s.muted}>Nothing recorded beyond the headline.</li>}
    </ul>
  );
}

/** A retro log, folded shut: the header says how recent and how much is inside. */
function PhilLearnLog({ log, title, about }: { log: PhilLearn[]; title: string; about: string }) {
  const [latest, ...older] = log;
  const lessons = log.reduce((n, e) => n + e.lessons.length, 0);
  const changes = log.reduce((n, e) => n + e.changes.length, 0);
  const stamp = (e: PhilLearn) => (e.ts ? when(e.ts) : e.file);
  return (
    <details className={`${m.panel} ${m.fold}`}>
      <summary className={m.foldHead}>
        <h2 className={m.panelTitle}>{title}</h2>
        <span className={m.foldMeta}>{`${log.length} ${log.length === 1 ? "retro" : "retros"} · ${lessons} ${lessons === 1 ? "lesson" : "lessons"} · ${changes} ${changes === 1 ? "change" : "changes"}`}</span>
      </summary>
      <p className={m.sub}>{about}</p>
      <div className={m.week}>
        <div className={m.weekHead}>
          <span>{stamp(latest)}</span>
        </div>
        <p className={m.retroHead}>{latest.headline}</p>
        <PhilRetro e={latest} />
      </div>
      {older.map((e) => (
        <details key={e.file} className={m.row}>
          <summary className={m.rowHead}>
            <span className={m.rowTitle}>{e.headline}</span>
            <span className={m.rowMeta}>{stamp(e)}</span>
          </summary>
          <div className={m.rowBody}><PhilRetro e={e} /></div>
        </details>
      ))}
    </details>
  );
}

function PhilTab({ p }: { p: Phil }) {
  const edge = p.brierPhil !== null && p.brierMarket !== null ? p.brierMarket - p.brierPhil : null;
  const maxAbs = Math.max(1, ...p.categories.map((c) => Math.abs(c.pnl)));
  return (
    <section className={s.section}>
      <div className={s.tiles}>
        <div className={`${s.tile} ${p.equity > p.bankroll ? s.good : p.equity < p.bankroll ? s.bad : ""}`}>
          <span className={s.tileV}>{usd(p.equity)}</span>
          <span className={s.tileK}>{`of a ${usd(p.bankroll)} paper bankroll`}</span>
        </div>
        <div className={s.tile}>
          <span className={s.tileV}>{`${p.wins}-${p.settled - p.wins}`}</span>
          <span className={s.tileK}>{`settled bets${p.voids ? `, ${p.voids} void` : ""}`}</span>
        </div>
        <div className={`${s.tile} ${edge !== null && edge > 0 ? s.good : edge !== null && edge < 0 ? s.bad : ""}`}>
          <span className={s.tileV}>{p.brierPhil !== null ? p.brierPhil.toFixed(3) : "n/a"}</span>
          <span className={s.tileK}>{p.brierMarket !== null ? `Brier, market ${p.brierMarket.toFixed(3)} (lower wins)` : "Brier score"}</span>
        </div>
        <div className={s.tile}>
          <span className={s.tileV}>{usd(p.exposure)}</span>
          <span className={s.tileK}>{`in ${p.open.length} open ${p.open.length === 1 ? "bet" : "bets"}`}</span>
        </div>
      </div>
      <div className={m.panel}>{philChart(p)}</div>
      <p className={s.notice}>
        <span className={p.healthOk ? "" : m.stale}>{p.health}</span>
        {p.lastCycle ? `, last cycle ${when(p.lastCycle)}.` : "."}{" "}
        {p.venue === "kalshi"
          ? `Kalshi Phil is a copy of Phil that paper-trades Kalshi instead: same loop and limits, every fill priced on Kalshi's live book with its taker fee${p.fees ? ` (${usd(p.fees)} paid so far, already counted)` : ""}. Its yardstick is Kalshi's price before fees: a lower Brier score on the same bets means its probabilities beat the market.`
          : "Phil is a Claude agent paper-trading short Polymarket markets. Its yardstick is the market itself: a Brier score below the market's on the same bets means its probabilities beat the prices it paid."}
        {p.settled < 30 ? ` ${p.settled} settled bets is too few to call either way.` : ""}
      </p>
      {p.open.length > 0 && (
        <div className={m.panel}>
          <h2 className={m.panelTitle}>Open</h2>
          <div className={m.scroll}>
            <table className={s.table}>
              <thead><tr><th>Market</th><th>Stake</th><th>Status</th><th></th></tr></thead>
              <tbody>{p.open.map((b) => <PhilRow key={b.id} b={b} />)}</tbody>
            </table>
          </div>
        </div>
      )}
      {p.categories.length > 0 && (
        <div className={m.panel}>
          <h2 className={m.panelTitle}>By category</h2>
          <div className={m.meters}>
            {p.categories.map((c) => (
              <div key={c.category} className={m.meter}>
                <span>{c.category} <span className={s.muted}>({c.bets})</span></span>
                <span className={m.meterBar}>
                  <span className={m.meterFill} style={{ display: "block", width: `${(Math.abs(c.pnl) / maxAbs) * 100}%`, background: c.pnl >= 0 ? "var(--pos)" : "var(--neg)" }} />
                </span>
                <span className={`${s.num} ${tone(c.pnl)}`}>{usd(c.pnl, true)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <details className={`${m.panel} ${m.fold}`}>
        <summary className={m.foldHead}>
          <h2 className={m.panelTitle}>Settled</h2>
          <span className={m.foldMeta}>{`${p.settledBets.length} bets`}</span>
        </summary>
        <div className={m.scroll}>
          <table className={s.table}>
            <thead><tr><th>Market</th><th>Stake</th><th>Result</th><th>P&amp;L</th></tr></thead>
            <tbody>{p.settledBets.map((b) => <PhilRow key={b.id} b={b} />)}</tbody>
          </table>
        </div>
      </details>
      {p.learner && p.learner.length > 0 && (
        <PhilLearnLog
          log={p.learner}
          title="Learner log"
          about={
            p.venue === "kalshi"
              ? "What Kalshi Phil noted, learned and changed in its own playbook after its Kalshi bets and forecasts settled, newest first. Its own words, trimmed."
              : "What Phil noted, learned and changed in its own playbook after Polymarket bets and forecasts settled, newest first. Polymarket only: its Kalshi shadow notes are on the Kalshi tab. Its own words, trimmed."
          }
        />
      )}
    </section>
  );
}

/* ------------------------------------------------------------ books ---- */

// Charts first, everything else folded: the tab opens on the 9 charts and three
// closed sections (holdings, grades, learn log) that each say in their header
// what is inside, so most visits need no scrolling at all.

function BookCard({ b }: { b: Book }) {
  const ret = b.equity / b.start - 1;
  const spy = b.spyEquity !== null ? b.spyEquity / b.start - 1 : null;
  const edge = spy !== null ? ret - spy : null;
  return (
    <div className={`${m.card} ${b.retired ? m.cardRetired : ""}`}>
      <div className={m.cardHead}>
        <h3 className={m.cardTitle} title={b.about}>{b.label}</h3>
        {b.retired ? <span className={m.tag}>retired</span> : null}
      </div>
      <div className={m.cardNums}>
        <span className={`${m.cardRet} ${tone(ret)}`}>{pct(ret)}</span>
        {edge !== null && <span className={`${s.num} ${tone(edge)}`}>{`${pct(edge)} vs SPY`}</span>}
      </div>
      <LineChart
        series={[
          { label: b.label, points: b.curve.map((c) => ({ x: t(c.day), y: c.equity })), tone: "auto" },
          { label: "SPY held", points: b.curve.filter((c) => c.spy !== null).map((c) => ({ x: t(c.day), y: c.spy! })) },
        ]}
        baseline={b.start}
        format={(y) => `$${(y / 1000).toFixed(1)}k`}
        height={130}
        width={300}
        compact
        ariaLabel={`${b.label} against SPY`}
      />
    </div>
  );
}

function BookHoldings({ b }: { b: Book }) {
  const held = [...b.positions]
    .map((p) => ({ p, g: p.last !== null ? p.last / p.entryPrice - 1 : null }))
    .sort((x, y) => (y.g ?? -9) - (x.g ?? -9));
  return (
    <details className={m.row}>
      <summary className={m.rowHead}>
        <span className={m.rowTitle}>{b.label}</span>
        <span className={m.rowMeta}>
          {b.retired ? `retired ${b.retired}` : `${held.length} ${held.length === 1 ? "holding" : "holdings"}, ${usd(b.cash)} cash`}
        </span>
      </summary>
      <div className={m.rowBody}>
        {b.strategy ? (
          <div className={m.strat}>
            <span className={m.stratWhat}>{b.strategy.what}</span>
            <span className={m.stratHow}>{b.strategy.how}</span>
            {b.strategy.record && <span className={m.stratRec}>{b.strategy.record}</span>}
          </div>
        ) : (
          <p className={m.sub}>{b.about}</p>
        )}
        {held.length > 0 && (
          <ul className={m.holdList}>
            {held.map(({ p, g }) => (
              <li key={p.symbol} className={m.hold}>
                <span className={s.play}>{p.symbol}</span>
                <span className={`${s.num} ${g !== null ? tone(g) : s.muted}`}>{g !== null ? pct(g) : "n/a"}</span>
                <span className={m.why}>{`${p.shares} sh at ${p.entryPrice.toFixed(2)}${p.last !== null ? `, now ${p.last.toFixed(2)}` : ""}. ${p.reason}`}</span>
              </li>
            ))}
          </ul>
        )}
        {b.fills.length > 0 && (
          <details className={m.inner}>
            <summary>{`Last ${Math.min(b.fills.length, 10)} trades`}</summary>
            <ul className={m.holdList}>
              {b.fills.slice(0, 10).map((f, i) => (
                <li key={i} className={m.hold}>
                  <span className={s.play}>{`${f.side === "buy" ? "Bought" : "Sold"} ${f.symbol}`}</span>
                  <span className={`${s.num} ${s.muted}`}>{f.day}</span>
                  <span className={m.why}>{`${f.shares} sh at ${f.price.toFixed(2)}. ${f.reason}`}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
        <p className={m.why}>
          {b.liveAt
            ? `Valued at ${clockEt(b.liveAt)} ET prices; the official close is marked at 6:30am. Started ${b.started}.`
            : `Marked through ${b.asOf ?? "n/a"}. Started ${b.started}.`}
        </p>
      </div>
    </details>
  );
}

const TAG: Record<string, string> = {
  open: m.tagOpen, retire: m.tagRetire, fix: m.tagFix, watch: m.tagWatch, idea: m.tagIdea,
  lesson: m.tagIdea, changed: m.tagFix, review: m.tagWatch,
};

function Tag({ k }: { k: string }) {
  return <span className={`${m.tag} ${TAG[k] ?? ""}`}>{k}</span>;
}

function LearnWeek({ e }: { e: LearnEntry }) {
  return (
    <ul className={m.logList}>
      {e.decisions.map((d, i) => (
        <li key={`d${i}`}><Tag k={d.action} /><b>{d.book}</b><span className={m.why}>{d.why}</span></li>
      ))}
      {e.watch.map((w, i) => <li key={`w${i}`}><Tag k="watch" />{w}</li>)}
      {e.lessons && <li className={m.lesson}>{e.lessons}</li>}
      {e.fixes.map((f, i) => <li key={`f${i}`}><Tag k="fix" />{f}</li>)}
      {!e.decisions.length && !e.watch.length && !e.lessons && !e.fixes.length && <li className={s.muted}>No decisions. Every book kept.</li>}
    </ul>
  );
}

function CheckRows({ g, books }: { g: Grades; books: Book[] }) {
  const label = (id: string) => books.find((b) => b.id === id)?.label ?? id;
  const rows = [...g.books].sort((a, b) => (a.action === "retire" ? 0 : 1) - (b.action === "retire" ? 0 : 1) || (b.excess ?? -9) - (a.excess ?? -9));
  return (
    <ul className={m.grades}>
      {rows.map((r) => (
        <li key={r.book} className={m.grade}>
          <span className={s.play}>{r.action === "retire" ? <Tag k="retire" /> : null}{label(r.book)}</span>
          <span className={`${s.num} ${r.excess !== null ? tone(r.excess) : s.muted}`}>{r.excess !== null ? `${pct(r.excess)} vs SPY` : "n/a"}</span>
          <span className={m.why}>
            {`${r.sessions} sessions${r.t !== null ? `, t ${r.t.toFixed(2)}` : ""}${
              r.passes === null ? "" : r.passes ? ", strategy still passes the lab filter" : ", strategy fails the lab filter"
            }.${r.action === "retire" ? ` ${r.why}` : ""}`}
          </span>
        </li>
      ))}
    </ul>
  );
}

// One fold for everything the learner does: the hourly check on top (the
// Saturday rules run on live prices, changing nothing), then each Saturday's
// moves. It opens itself when a book would retire, so that never hides.
function LearnLog({ log, grades, books }: { log: LearnEntry[]; grades: Grades | null; books: Book[] }) {
  const [latest, ...older] = log;
  const atRisk = grades ? grades.books.filter((b) => b.action === "retire").length : 0;
  const when = grades ? (grades.checked ? `${shortDay(grades.day)} ${clockEt(grades.checked)}` : shortDay(grades.day)) : null;
  const meta = grades
    ? `Checked ${when}: ${atRisk ? `${atRisk} would retire` : "all kept"}`
    : latest
      ? `${shortDay(latest.day)}: ${latest.decisions.length ? `${latest.decisions.length} ${latest.decisions.length === 1 ? "move" : "moves"}` : "no moves"}`
      : "";
  return (
    <details className={`${m.panel} ${m.fold}`} open={atRisk > 0}>
      <summary className={m.foldHead}>
        <h2 className={m.panelTitle}>Learn log</h2>
        <span className={`${m.foldMeta} ${atRisk ? s.neg : ""}`}>{meta}</span>
      </summary>
      <p className={m.sub}>
        Every hour the learner grades each book with Saturday&apos;s rules at live prices and changes nothing. On Saturday it acts: retires books, opens new ones, and Claude&apos;s retro writes what to watch and what to test next. The rules are fixed; only Jack changes them.
      </p>
      {grades && grades.books.length > 0 && (
        <div className={m.week}>
          <div className={m.checkHead}>
            <span>{`Latest check, ${when}${grades.liveAt ? ` (prices ${clockEt(grades.liveAt)})` : ""}`}</span>
            <span className={atRisk ? s.neg : s.muted}>{atRisk ? `${atRisk} ${atRisk === 1 ? "book would" : "books would"} retire Saturday` : "no rule would fire"}</span>
          </div>
          <CheckRows g={grades} books={books} />
          <p className={m.why}>{`Lab results through ${grades.through}; they move once a day.`}</p>
        </div>
      )}
      {latest && (
        <div className={m.week}>
          <div className={m.weekHead}>
            <span>{`Week of ${latest.day}`}</span>
            {latest.tested !== null && <span className={s.muted}>{`${latest.tested.toLocaleString("en-US")} tested, ${latest.candidates} candidates, ${latest.proven} proven`}</span>}
          </div>
          <LearnWeek e={latest} />
        </div>
      )}
      {older.map((e) => (
        <details key={e.day} className={m.row}>
          <summary className={m.rowHead}>
            <span className={m.rowTitle}>{`Week of ${e.day}`}</span>
            <span className={m.rowMeta}>{e.decisions.length ? `${e.decisions.length} ${e.decisions.length === 1 ? "move" : "moves"}` : "no moves"}</span>
          </summary>
          <div className={m.rowBody}><LearnWeek e={e} /></div>
        </details>
      ))}
    </details>
  );
}

function BooksTab({ books, log, grades }: { books: Book[]; log: LearnEntry[]; grades: Grades | null }) {
  const active = books.filter((b) => !b.retired);
  const ahead = active.filter((b) => b.spyEquity !== null && b.equity > b.spyEquity).length;
  const live = books.find((b) => b.liveAt)?.liveAt;
  return (
    <section className={s.section}>
      <div className={m.booksHead}>
        <p className={m.sub}>
          {`${ahead} of ${active.length} books ahead of SPY. $100,000 each, traded at 6:30am on the previous close; the dashed line is the same money left in SPY.${
            live ? ` Charts are live at ${clockEt(live)} ET.` : ""
          }`}
        </p>
      </div>
      <div className={m.cards}>{[...active, ...books.filter((b) => b.retired)].map((b) => <BookCard key={b.id} b={b} />)}</div>
      <details className={`${m.panel} ${m.fold}`}>
        <summary className={m.foldHead}>
          <h2 className={m.panelTitle}>Holdings and trades</h2>
          <span className={m.foldMeta}>{`${books.reduce((a, b) => a + (b.retired ? 0 : b.positions.length), 0)} positions`}</span>
        </summary>
        <div className={m.rows}>{books.map((b) => <BookHoldings key={b.id} b={b} />)}</div>
      </details>
      {(log.length > 0 || (grades && grades.books.length > 0)) && <LearnLog log={log} grades={grades} books={books} />}
    </section>
  );
}

/* ----------------------------------------------------------- kalshi ---- */

const cents = (p: number | null) => (p === null ? "?" : `${Math.round(p * 100)}¢`);
const kalshiUrl = (ticker: string) => `https://kalshi.com/markets/${ticker.split("-")[0].toLowerCase()}`;

function Decision({ r }: { r: KalshiRow }) {
  return <span className={`${m.outcome} ${r.decision === "bet" ? m.oBet : m.oOpen}`}>{r.decision === "bet" ? "Shadow bet" : "Passed"}</span>;
}

function KalshiRowView({ r, settled }: { r: KalshiRow; settled?: boolean }) {
  const side = r.side ? r.side.toUpperCase() : "";
  const money = r.decision === "bet" ? r.pnl : r.hypoPnl;
  return (
    <tr>
      <td>
        <div><a href={kalshiUrl(r.ticker)} target="_blank" rel="noreferrer">{r.title ?? r.ticker}</a></div>
        <div className={m.why}>
          {[r.pick && !(r.title ?? "").includes(r.pick) ? r.pick : null, `${side} at ${cents(r.effPrice ?? r.ask)} after fee`, `Phil said ${r.est !== null ? Math.round(r.est * 100) + "%" : "?"}`,
            r.origin === "kalshi_only" ? "Kalshi only" : "also on Polymarket", r.category].filter(Boolean).join(" · ")}
        </div>
        {r.decision === "skip" && r.skipReason && <div className={m.why}>{`Passed: ${r.skipReason}`}</div>}
      </td>
      <td><Decision r={r} /></td>
      <td className={s.num}>{r.stake ? usd(r.stake) : ""}</td>
      {settled ? <SettledCell r={r} money={money} /> : (
        <td className={`${s.num} ${s.muted}`}>{r.closes ? `settles ${when(r.closes)}` : ""}</td>
      )}
    </tr>
  );
}

// A settled row says three separate things, so none of them hides the others:
// what Kalshi settled, what the call did with money (a bet's P&L, or what a
// pass avoided or missed), and whether Phil's probability pointed the right
// way. "status" is whether the named side won, which for a pass is not a loss.
function SettledCell({ r, money }: { r: KalshiRow; money: number | null }) {
  if (r.status === "void") return <td className={s.num}><Outcome o="void" /></td>;
  const sideWon = r.status === "won";
  const kalshiSaid = r.side ? (sideWon ? r.side : r.side === "yes" ? "no" : "yes").toUpperCase() : null;
  const readRight = r.est !== null ? (r.est >= 0.5) === sideWon : null;
  const bet = r.decision === "bet";
  return (
    <td className={s.num}>
      <span className={`${m.outcome} ${bet ? (sideWon ? m.oW : m.oL) : m.oOpen}`}>
        {bet ? (sideWon ? "Won" : "Lost") : kalshiSaid ? `Settled ${kalshiSaid}` : "Settled"}
      </span>
      {money !== null && (
        <div className={tone(bet ? money : -money)}>
          {bet ? usd(money, true) : money < 0 ? `pass avoided ${usd(-money)}` : `pass missed ${usd(money, true)}`}
        </div>
      )}
      {readRight !== null && (
        <div className={`${m.why} ${readRight ? "" : s.neg}`}>{readRight ? "Phil's read was right" : "Phil's read was wrong"}</div>
      )}
    </td>
  );
}

function Goal({ label, have, need, why }: { label: string; have: number; need: number; why: string }) {
  const done = have >= need;
  return (
    <div className={m.goal}>
      <div className={m.goalHead}><strong>{label}</strong><span className={`${s.num} ${done ? s.pos : s.muted}`}>{`${Math.min(have, need)} of ${need}`}</span></div>
      <span className={m.meterBar}>
        <span className={m.meterFill} style={{ display: "block", width: `${Math.min(1, have / need) * 100}%`, background: done ? "var(--pos)" : "var(--accent)" }} />
      </span>
      <span className={m.why}>{why}</span>
    </div>
  );
}

function KalshiTab({ k }: { k: Kalshi }) {
  const vs = k.vsMarket;
  const beat = vs ? -vs.brier_delta : null;
  const near = k.lastScan?.picks.filter((p) => p.bucket === "near") ?? [];
  const far = k.lastScan?.picks.filter((p) => p.bucket === "far") ?? [];
  const passes = k.watching.filter((r) => r.decision === "skip").length;
  const origin = (o: "matched" | "kalshi_only", label: string) => {
    const x = k.byOrigin[o];
    return (
      <tr key={o}>
        <td>{label}</td>
        <td className={s.num}>{x.decisions}</td>
        <td className={s.num}>{x.bets}</td>
        <td className={s.num}>{x.settled}</td>
        <td className={`${s.num} ${tone(x.pnl)}`}>{x.settled ? usd(x.pnl, true) : ""}</td>
      </tr>
    );
  };
  const radar = (list: typeof near) => (
    <ul className={m.radar}>
      {list.map((p) => (
        <li key={p.ticker}>
          <a href={kalshiUrl(p.ticker)} target="_blank" rel="noreferrer">{p.title ?? p.ticker}</a>
          <span className={s.num}>{p.mid !== undefined ? cents(p.mid) : ""}</span>
          <span className={m.why}>{[p.event && p.event !== p.title ? p.event : null, p.yes_sub_title && !(p.title ?? "").includes(p.yes_sub_title) ? p.yes_sub_title : null, p.category, p.settles_by ? `settles ${when(p.settles_by)}` : null].filter(Boolean).join(" · ")}</span>
        </li>
      ))}
    </ul>
  );
  return (
    <section className={s.section}>
      <div className={s.tiles}>
        <div className={`${s.tile} ${k.pnl > 0 ? s.good : k.pnl < 0 ? s.bad : ""}`}>
          <span className={s.tileV}>{usd(k.pnl, true)}</span>
          <span className={s.tileK}>{`shadow P&L after ${usd(k.fees)} in fees`}</span>
        </div>
        <div className={s.tile}>
          <span className={s.tileV}>{`${k.wins}-${k.settledBets - k.wins}`}</span>
          <span className={s.tileK}>settled shadow bets</span>
        </div>
        <div className={`${s.tile} ${beat !== null && beat > 0 ? s.good : beat !== null && beat < 0 ? s.bad : ""}`}>
          <span className={s.tileV}>{vs ? vs.brier_phil.toFixed(3) : "n/a"}</span>
          <span className={s.tileK}>{vs ? `Brier, Kalshi price ${vs.brier_kalshi.toFixed(3)} (lower wins)` : "Brier vs Kalshi's price"}</span>
        </div>
        <div className={s.tile}>
          <span className={s.tileV}>{k.open}</span>
          <span className={s.tileK}>{`open: ${k.open - passes} ${k.open - passes === 1 ? "bet" : "bets"}, ${passes} ${passes === 1 ? "pass" : "passes"}`}</span>
        </div>
      </div>
      <p className={s.notice}>
        Shadow only. Phil researches Kalshi markets and writes down what he would do, priced against Kalshi&apos;s live order book with its fee.
        Nothing is placed, and none of this is in his Polymarket numbers. Passes are tracked too, so the edge rule can be tested on what he turned down.
      </p>

      <div className={m.panel}>
        <h2 className={m.panelTitle}>What it&apos;s learning</h2>
        <div className={m.goals}>
          <Goal label="Is Phil sharper than Kalshi's price?" have={k.settled} need={30}
            why={vs ? `On ${vs.n} settled decisions Phil's Brier is ${vs.brier_phil.toFixed(3)} against the price's ${vs.brier_kalshi.toFixed(3)}. Under 30 is too few to call.` : "Scores once decisions settle, bets and passes alike."} />
          <Goal label="Does the Polymarket edge rule fit Kalshi?" have={k.thresholds.usable} need={k.thresholds.needed * 2}
            why={`Picks a threshold on the first half of settled decisions, then checks it on the second half. ${k.thresholds.testN >= k.thresholds.needed ? "Ready for review." : "Until then the Polymarket rule stays as is."}`} />
          <Goal label="Same skill on both venues?" have={k.pooling.pairs} need={k.pooling.needed}
            why="Needs markets Phil priced on both venues and that have settled. Even if they match, the records stay separate until a review says otherwise." />
        </div>
        <div className={m.scroll}>
          <table className={s.table}>
            <thead><tr><th>Where it came from</th><th>Decisions</th><th>Bets</th><th>Settled</th><th>P&amp;L</th></tr></thead>
            <tbody>{origin("matched", "Also on Polymarket")}{origin("kalshi_only", "Kalshi only")}</tbody>
          </table>
        </div>
        {k.comparisons.total > 0 && (
          <p className={s.notice}>{`${k.comparisons.total} Polymarket markets checked against Kalshi: ${k.comparisons.equivalent ?? 0} the same bet, ${(k.comparisons.rejected ?? 0) + (k.comparisons.flagged ?? 0)} turned away for different wording, dates or rules.`}</p>
        )}
      </div>

      <div className={m.panel}>
        <h2 className={m.panelTitle}>Watching</h2>
        {k.watching.length ? (
          <div className={m.scroll}>
            <table className={s.table}>
              <thead><tr><th>Market</th><th>Call</th><th>Stake</th><th></th></tr></thead>
              <tbody>{k.watching.map((r) => <KalshiRowView key={r.id} r={r} />)}</tbody>
            </table>
          </div>
        ) : (
          <p className={s.calm}>Nothing open yet. Phil looks at up to three Kalshi markets each full cycle and records a bet or a pass here.</p>
        )}
      </div>

      {k.lastScan && (
        <div className={m.panel}>
          <div className={m.panelHead}><h2 className={m.panelTitle}>On the radar</h2><span className={s.muted}>{`scan ${when(k.lastScan.ts)}`}</span></div>
          <p className={s.notice}>The most tradable Kalshi markets from the last scan, across every category. Phil researches a few of these each cycle. Prices are from the scan and can be hours old.</p>
          {near.length > 0 && <><p className={m.bucket}>Settles within two weeks</p>{radar(near)}</>}
          {far.length > 0 && <><p className={m.bucket}>Longer dated</p>{radar(far)}</>}
        </div>
      )}

      {k.recent.length > 0 && (
        <div className={m.panel}>
          <h2 className={m.panelTitle}>Settled</h2>
          <div className={m.scroll}>
            <table className={s.table}>
              <thead><tr><th>Market</th><th>Call</th><th>Stake</th><th>Result</th></tr></thead>
              <tbody>{k.recent.map((r) => <KalshiRowView key={r.id} r={r} settled />)}</tbody>
            </table>
          </div>
        </div>
      )}
      {k.learner && k.learner.length > 0 && (
        <PhilLearnLog
          log={k.learner}
          title="Shadow learner log"
          about="What Phil's retros said about his Kalshi shadow picks once they settled, and the Kalshi review's verdict. Kalshi only, kept apart from his Polymarket record. Retros where nothing on Kalshi settled are left out."
        />
      )}
    </section>
  );
}

/* ---------------------------------------------------------- weather ---- */

// The weather desk: its own paper book on Kalshi's daily-high markets, kept
// apart from both Phils. Everything here comes from weather-desk's status.json.

const wc = (p: number) => `${Math.round(p * 100)}¢`;
const deg = (x: number) => `${x.toFixed(0)}°`;

function weatherChart(w: Weather, height?: number, width?: number) {
  const pts = w.curve.map((c) => ({ x: t(c.day), y: c.equity }));
  if (pts.length) pts.unshift({ x: pts[0].x - 86_400_000, y: w.start });
  return (
    <LineChart
      series={[{ label: "Weather desk", points: pts, tone: "auto" }]}
      baseline={w.start}
      format={(y) => usd(y)}
      height={height}
      width={width}
      empty={`${w.open.length} ${w.open.length === 1 ? "bet" : "bets"} open. The line starts when the first one settles, the morning after its day.`}
      ariaLabel="Weather desk paper bankroll after each settled day"
    />
  );
}

function WeatherBetRow({ b }: { b: WeatherBet }) {
  const own = b.desk ?? b.p;
  return (
    <li className={m.hold}>
      <span className={s.play}>{`${b.side === "yes" ? "Yes" : "No"} ${b.label}, ${b.name}`}</span>
      <span className={`${s.num} ${b.pnl !== undefined ? tone(b.pnl) : s.muted}`}>
        {b.pnl !== undefined ? usd(b.pnl, true) : usd(b.cost + b.fee)}
      </span>
      <span className={m.why}>
        {`${shortDay(b.day)} high. ${b.contracts} at ${wc(b.price)}. Forecast ${deg(b.mu)} ±${b.sigma.toFixed(1)}°; desk ${Math.round(own * 100)}%, blended with the market ${Math.round(b.p * 100)}%, edge ${wc(b.edge)}.`}
        {b.status !== "open" ? ` ${b.status === "won" ? "Won" : "Lost"}.` : ""}
      </span>
    </li>
  );
}

function WeatherDayRow({ d, benched }: { d: WeatherDay; benched: boolean }) {
  return (
    <li className={m.grade}>
      <span className={s.play}>{d.name}</span>
      <span className={`${s.num} ${s.muted}`}>{`${deg(d.mu)} ±${d.sigma.toFixed(1)}°`}</span>
      <span className={m.why}>
        {`Most likely ${d.favorite}: desk ${Math.round(d.favoriteP * 100)}%, market ${d.favoriteMid !== null ? wc(d.favoriteMid) : "n/a"}. `}
        {benched ? "Benched: the market has out-forecast the desk here." : d.pick ? `Edge: ${d.pick} (${wc(d.edge ?? 0)}).` : "No edge."}
      </span>
    </li>
  );
}

function WeatherCityRow({ c }: { c: WeatherCity }) {
  const ahead = c.desk !== null && c.market !== null ? c.desk < c.market : null;
  return (
    <li className={m.grade}>
      <span className={s.play}>{c.benched ? <Tag k="retire" /> : null}{c.name}</span>
      <span className={`${s.num} ${ahead === null ? s.muted : ahead ? s.pos : s.neg}`}>
        {ahead === null ? "not scored yet" : ahead ? "desk ahead" : "market ahead"}
      </span>
      <span className={m.why}>
        {`Forecasts run ${c.bias !== null ? `${c.bias > 0 ? "+" : ""}${c.bias.toFixed(1)}°` : "?"} off here (corrected), usual miss ${c.sigma !== null ? c.sigma.toFixed(1) : "?"}°, from ${c.misses} days.`}
        {c.scored ? ` Scored ${c.scored} days: desk ${c.desk!.toFixed(3)}, market ${c.market!.toFixed(3)} (lower is better).` : ""}
      </span>
    </li>
  );
}

function WeatherTab({ w }: { w: Weather }) {
  const r = w.record;
  const benched = new Set(w.cities.filter((c) => c.benched).map((c) => c.key));
  const days = [...new Set(w.upcoming.map((u) => u.day))].sort();
  const next = days[0];
  const lost = r.settled - r.won;
  return (
    <section className={s.section}>
      <div className={s.tiles}>
        <div className={`${s.tile} ${w.equity > w.start ? s.good : w.equity < w.start ? s.bad : ""}`}>
          <span className={s.tileV}>{usd(w.equity - w.start, true)}</span>
          <span className={s.tileK}>{`paper, from ${usd(w.start)}`}</span>
        </div>
        <div className={s.tile}>
          <span className={s.tileV}>{r.settled ? `${r.won}-${lost}` : "0-0"}</span>
          <span className={s.tileK}>{`settled, ${w.open.length} open`}</span>
        </div>
        <div className={s.tile}>
          <span className={s.tileV}>{`${Math.round(w.trust.w * 100)}%`}</span>
          <span className={s.tileK}>trust in its own forecast</span>
        </div>
      </div>
      <div className={m.panel}>
        <h2 className={m.panelTitle}>Bankroll</h2>
        {weatherChart(w, 220, 640)}
        <p className={m.sub}>
          {`Bets on tomorrow's high in ${w.cities.length} cities on Kalshi. Each forecast averages five weather models with the National Weather Service forecast, correcting each by what it has learned about the station and weighting whichever has missed by less. The desk's odds are blended with the market's: ${Math.round(w.trust.w * 100)}% desk, ${100 - Math.round(w.trust.w * 100)}% market${
            w.trust.days ? `, re-fit from ${w.trust.days} settled days` : ", until 20 days have settled"
          }. It bets only when the blend beats the price by ${wc(w.rules.min_edge)} after fees, no more than ${usd(w.rules.max_stake)} a bet, and never after ${w.rules.cutoff_hour}am on the day.`}
        </p>
        {w.brake && w.brake.level !== "off" && w.brake.desk !== null && w.brake.market !== null ? (
          <p className={`${m.sub} ${s.neg}`}>
            {`Brake ${w.brake.level === "stop" ? "on: no new bets" : "on: quarter stakes"}. Over the last week the market scored ${w.brake.market.toFixed(3)} to the desk's ${w.brake.desk.toFixed(3)} across ${w.brake.n} city-days (lower is better). It keeps forecasting and scoring, and bets again once its week beats the market's.`}
          </p>
        ) : null}
      </div>
      {w.open.length > 0 && (
        <details className={`${m.panel} ${m.fold}`} open>
          <summary className={m.foldHead}>
            <h2 className={m.panelTitle}>Open bets</h2>
            <span className={m.foldMeta}>{`${w.open.length}, ${usd(w.openCost)} staked`}</span>
          </summary>
          <ul className={m.holdList}>{w.open.map((b) => <WeatherBetRow key={b.id} b={b} />)}</ul>
        </details>
      )}
      {next && (
        <details className={`${m.panel} ${m.fold}`}>
          <summary className={m.foldHead}>
            <h2 className={m.panelTitle}>{`The board, ${shortDay(next)}`}</h2>
            <span className={m.foldMeta}>{`${w.upcoming.filter((u) => u.day === next && u.pick).length} edges, updated ${clockEt(w.generatedAt)}`}</span>
          </summary>
          <ul className={m.grades}>
            {w.upcoming.filter((u) => u.day === next).map((d) => <WeatherDayRow key={d.city} d={d} benched={benched.has(d.city)} />)}
          </ul>
        </details>
      )}
      <details className={`${m.panel} ${m.fold}`} open={benched.size > 0}>
        <summary className={m.foldHead}>
          <h2 className={m.panelTitle}>What it has learned</h2>
          <span className={m.foldMeta}>
            {w.learned.scored ? `${w.learned.scored} days scored${benched.size ? `, ${benched.size} benched` : ""}` : `${w.learned.days.toLocaleString("en-US")} city-days of history`}
          </span>
        </summary>
        <p className={m.sub}>
          {`Every settled day, in every city, bet or not, teaches it two things: how far the models run off at that station, and whether its odds beat the market's (Brier score, lower is better). A city where the market keeps winning after ${w.rules.bench_min} scored days gets benched until the desk catches up.${
            w.learned.desk !== null && w.learned.market !== null ? ` Overall so far: desk ${w.learned.desk.toFixed(3)}, market ${w.learned.market.toFixed(3)}.` : ""
          }`}
        </p>
        <ul className={m.grades}>{w.cities.map((c) => <WeatherCityRow key={c.key} c={c} />)}</ul>
      </details>
      {w.settled.length > 0 && (
        <details className={`${m.panel} ${m.fold}`}>
          <summary className={m.foldHead}>
            <h2 className={m.panelTitle}>Settled</h2>
            <span className={m.foldMeta}>{`${r.won}-${lost}, ${usd(r.pnl, true)}`}</span>
          </summary>
          <ul className={m.holdList}>{w.settled.map((b) => <WeatherBetRow key={b.id} b={b} />)}</ul>
        </details>
      )}
    </section>
  );
}

/* ----------------------------------------------------------- sports ---- */

// Picks and props on the overview: cumulative units by week, from the same
// records the Picks and Props pages total (lib/money/sports.ts).

type Sports = NonNullable<Awaited<ReturnType<typeof getMoneyView>>["sports"]>;

function cumulative(rows: { at: string | null; v: number }[]) {
  const pts: { x: number; y: number }[] = [];
  let run = 0;
  for (const r of rows) {
    if (!r.at) continue;
    run += r.v;
    pts.push({ x: t(r.at), y: Math.round(run * 100) / 100 });
  }
  if (pts.length) pts.unshift({ x: pts[0].x - 7 * 86_400_000, y: 0 });
  return pts;
}

function PicksPanel({ sp }: { sp: Sports }) {
  const leagues = (["nfl", "cfb"] as const).map((l) => {
    const rows = sp.picks.filter((p) => p.league === l);
    return { l, units: rows.reduce((a, r) => a + r.units, 0), w: rows.reduce((a, r) => a + r.w, 0), l_: rows.reduce((a, r) => a + r.l, 0), p: rows.reduce((a, r) => a + r.p, 0), n: rows.length };
  });
  const name = { nfl: "NFL", cfb: "College" };
  return (
    <div className={m.panel}>
      <div className={m.panelHead}><h2 className={m.panelTitle}>Picks, all sports</h2><Link className={m.panelLink} href="/picks">Picks</Link></div>
      <LineChart
        series={[{ label: "All sports", points: cumulative(sp.picks.map((p) => ({ at: p.at, v: p.units }))), tone: "auto" }]}
        baseline={0}
        format={units}
        height={230}
        width={360}
        empty="No graded picks yet this season."
        ariaLabel="Net units on every staked pick, all sports, by week"
      />
      <span className={m.sub}>
        {leagues.filter((x) => x.n).map((x) => `${name[x.l]} ${units(Math.round(x.units * 100) / 100)} (${x.w}-${x.l_}${x.p ? `-${x.p}` : ""})`).join(" · ") || "Nothing settled yet."}
        {" "}Staked bets as the emails sent them. NBA joins once it keeps a record.
      </span>
    </div>
  );
}

function PropsPanel({ sp }: { sp: Sports }) {
  const sys = sp.props.reduce((a, w) => a + w.system, 0);
  const sam = sp.props.reduce((a, w) => a + w.sam, 0);
  const nSys = sp.props.reduce((a, w) => a + w.systemBets, 0);
  const nSam = sp.props.reduce((a, w) => a + w.samBets, 0);
  return (
    <div className={m.panel}>
      <div className={m.panelHead}><h2 className={m.panelTitle}>Props</h2><Link className={m.panelLink} href="/props">Props</Link></div>
      <LineChart
        series={
          // The system line leads once it has bets; until then it would be a flat zero.
          nSys
            ? [
                { label: "System bets", points: cumulative(sp.props.map((w) => ({ at: w.at, v: w.system }))), tone: "auto" },
                { label: "Every Sam play", points: cumulative(sp.props.map((w) => ({ at: w.at, v: w.sam }))) },
              ]
            : [{ label: "Every Sam play", points: cumulative(sp.props.map((w) => ({ at: w.at, v: w.sam }))), tone: "auto" }]
        }
        baseline={0}
        format={units}
        height={230}
        width={360}
        empty="No graded props yet this season."
        ariaLabel="Net units on prop bets by week: the system's bets and every play Sam's model made"
      />
      <span className={m.sub}>
        {`Every play Sam's model made: ${units(Math.round(sam * 100) / 100)} on ${nSam}. ${
          nSys ? `The system's bets: ${units(Math.round(sys * 100) / 100)} on ${nSys}.` : "No system bets settled yet."
        } 1 unit risked per bet, at the book's price.`}
      </span>
    </div>
  );
}

/* --------------------------------------------------------- overview ---- */

function Overview({ v }: { v: Awaited<ReturnType<typeof getMoneyView>> }) {
  const p = v.snapshot?.phil;
  const kp = v.snapshot?.kalshiPhil;
  const wx = v.snapshot?.weather;
  const books = v.snapshot?.books ?? [];
  const bookStart = books.reduce((a, b) => a + b.start, 0);
  const bookNow = books.reduce((a, b) => a + b.equity, 0);
  const spyNow = books.reduce((a, b) => a + (b.spyEquity ?? b.start), 0);
  // All the books on one line: summed by day.
  const days = [...new Set(books.flatMap((b) => b.curve.map((c) => c.day)))].sort();
  const combined = days.map((d) => ({
    x: t(d),
    y: books.reduce((a, b) => a + ([...b.curve].reverse().find((c) => c.day <= d)?.equity ?? b.start), 0),
  }));
  const combinedSpy = days.map((d) => ({
    x: t(d),
    y: books.reduce((a, b) => a + ([...b.curve].reverse().find((c) => c.day <= d && c.spy !== null)?.spy ?? b.start), 0),
  }));
  return (
    <section className={s.section}>
      <div className={s.tiles}>
        {SHOW_BETS && (
          <div className={`${s.tile} ${v.summary.net > 0 ? s.good : v.summary.net < 0 ? s.bad : ""}`}>
            <span className={s.tileV}>{units(v.summary.net)}</span>
            <span className={s.tileK}>{`my bets, ${v.summary.wins}-${v.summary.losses}`}</span>
          </div>
        )}
        <div className={`${s.tile} ${p && p.equity > p.bankroll ? s.good : p && p.equity < p.bankroll ? s.bad : ""}`}>
          <span className={s.tileV}>{p && !p.error ? usd(p.equity - p.bankroll, true) : "n/a"}</span>
          <span className={s.tileK}>Phil, paper</span>
        </div>
        {kp && !kp.error && (
          <div className={`${s.tile} ${kp.equity > kp.bankroll ? s.good : kp.equity < kp.bankroll ? s.bad : ""}`}>
            <span className={s.tileV}>{usd(kp.equity - kp.bankroll, true)}</span>
            <span className={s.tileK}>Kalshi Phil, paper</span>
          </div>
        )}
        {wx && (
          <div className={`${s.tile} ${wx.equity > wx.start ? s.good : wx.equity < wx.start ? s.bad : ""}`}>
            <span className={s.tileV}>{usd(wx.equity - wx.start, true)}</span>
            <span className={s.tileK}>Weather desk, paper</span>
          </div>
        )}
        <div className={`${s.tile} ${bookNow > bookStart ? s.good : bookNow < bookStart ? s.bad : ""}`}>
          <span className={s.tileV}>{books.length ? pct(bookNow / bookStart - 1) : "n/a"}</span>
          <span className={s.tileK}>{books.length ? `stock books, all ${books.length} · SPY ${pct(spyNow / bookStart - 1)} same days` : "stock books"}</span>
        </div>
      </div>
      <div className={m.panels}>
        {SHOW_BETS && (
          <div className={m.panel}>
            <div className={m.panelHead}><h2 className={m.panelTitle}>My bets</h2><Link className={m.panelLink} href={href("bets")}>All bets</Link></div>
            {betChart(v.summary, 230, 360)}
          </div>
        )}
        {p && !p.error && (
          <div className={m.panel}>
            <div className={m.panelHead}><h2 className={m.panelTitle}>Phil</h2><Link className={m.panelLink} href={href("phil")}>Ledger</Link></div>
            {philChart(p, 230, 360)}
          </div>
        )}
        {kp && !kp.error && (
          <div className={m.panel}>
            <div className={m.panelHead}><h2 className={m.panelTitle}>Kalshi Phil</h2><Link className={m.panelLink} href={href("kalshi")}>Ledger</Link></div>
            {kp.settled > 0
              ? philChart(kp, 230, 360)
              : <span className={m.sub}>{`No settled bets yet. ${kp.open.length} open, ${usd(kp.cash)} cash. ${kp.health}.`}</span>}
          </div>
        )}
        {v.sports && <PicksPanel sp={v.sports} />}
        {v.sports && <PropsPanel sp={v.sports} />}
        {wx && (
          <div className={m.panel}>
            <div className={m.panelHead}><h2 className={m.panelTitle}>Weather desk</h2><Link className={m.panelLink} href={href("weather")}>Bets and board</Link></div>
            {wx.record.settled > 0
              ? weatherChart(wx, 230, 360)
              : <span className={m.sub}>{`No settled bets yet. ${wx.open.length} open on tomorrow's highs, ${usd(wx.cash)} cash. Trusts its own forecast ${Math.round(wx.trust.w * 100)}%, the market the rest.`}</span>}
          </div>
        )}
        {books.length > 0 && (
          <div className={m.panel}>
            <div className={m.panelHead}><h2 className={m.panelTitle}>Stock books</h2><Link className={m.panelLink} href={href("books")}>Each book</Link></div>
            <LineChart
              series={[{ label: "All books", points: combined, tone: "auto" }, { label: "SPY held", points: combinedSpy }]}
              baseline={bookStart}
              format={(y) => `$${(y / 1000).toFixed(0)}k`}
              height={230}
              width={360}
              ariaLabel="All the stock books combined against SPY"
            />
          </div>
        )}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------- page ---- */

export default async function MoneyView({ tab }: { tab: MoneyTab }) {
  let v: Awaited<ReturnType<typeof getMoneyView>> | null = null;
  let error: string | null = null;
  try {
    v = await getMoneyView();
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  const snap = v?.snapshot;
  const age = snap ? (Date.now() - Date.parse(snap.generatedAt)) / 3600_000 : null;
  return (
    <main className={s.page}>
      <div className={s.wrap}>
        <header className={s.header}>
          <div className={s.headRow}>
            <span className={s.eyebrow}>Paper and units, no real balances</span>
            {snap && (
              <span className={`${s.eyebrow} ${age !== null && age > 3 ? m.stale : ""}`}>
                {`Phil, Kalshi Phil and books updated ${when(snap.generatedAt)}`}
              </span>
            )}
          </div>
          <h1 className={s.h1}>Money</h1>
          <nav className={s.tabs} aria-label="Money">
            {TABS.map((x) => (
              <Link key={x.id} href={href(x.id)} aria-current={x.id === tab ? "page" : undefined} className={s.tab}>
                {x.label}
              </Link>
            ))}
          </nav>
        </header>

        {error && <p className={s.error}>{`The Money page could not load: ${error}`}</p>}
        {SHOW_BETS && v && v.problems.length > 0 && <p className={s.error}>{`Some bets could not be checked against ESPN: ${v.problems.join("; ")}`}</p>}
        {v && !snap && tab !== "bets" && (
          <p className={s.calm}>Phil and the stock books have not reported yet. They post here from the Mac after their next run.</p>
        )}

        {v && tab === "overview" && <Overview v={v} />}
        {SHOW_BETS && v && tab === "bets" && <BetsTab v={v} />}
        {v && tab === "phil" && snap?.phil && (snap.phil.error ? <p className={s.error}>{snap.phil.error}</p> : <PhilTab p={snap.phil} />)}
        {v && tab === "kalshi" && snap && (
          <>
            <div className={m.venueHead}>
              <h2 className={s.h2}>Kalshi Phil</h2>
              <span className={m.foldMeta}>Its own agent and paper book on Kalshi</span>
            </div>
            {snap.kalshiPhil
              ? (snap.kalshiPhil.error ? <p className={s.error}>{snap.kalshiPhil.error}</p> : <PhilTab p={snap.kalshiPhil} />)
              : <p className={s.calm}>Kalshi Phil has not reported yet. It posts with Phil after the next hourly cycle.</p>}
            <div className={m.venueHead}>
              <h2 className={s.h2}>Phil&apos;s shadow check</h2>
              <span className={m.foldMeta}>Phil&apos;s Polymarket picks, priced on Kalshi. Nothing placed</span>
            </div>
            {snap.kalshi
              ? (snap.kalshi.error ? <p className={s.error}>{snap.kalshi.error}</p> : <KalshiTab k={snap.kalshi} />)
              : <p className={s.calm}>The shadow check has not reported yet. It posts with Phil after his next cycle.</p>}
          </>
        )}
        {v && tab === "weather" && (snap?.weather ? <WeatherTab w={snap.weather} /> : <p className={s.calm}>The weather desk hasn&apos;t posted yet.</p>)}
        {v && tab === "books" && snap && <BooksTab books={snap.books} log={snap.learnLog ?? []} grades={snap.grades ?? null} />}

        <footer className={s.footer}>
          <span>
            Phil, Kalshi Phil and the stock books run on the Mac and post a snapshot here after each run. Bets grade from ESPN. Everything here is paper
            money or betting units, a record and not advice.
          </span>
        </footer>
      </div>
    </main>
  );
}
