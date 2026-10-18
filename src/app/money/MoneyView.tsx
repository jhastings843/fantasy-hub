import Link from "next/link";
import { getMoneyView } from "@/lib/money/store";
import type { MoneyBet } from "@/lib/money/bets";
import type { Book, Kalshi, KalshiRow, LearnEntry, Phil, PhilBet } from "@/lib/money/types";
import { LineChart } from "./Chart";
import s from "../picks/picks.module.css";
import m from "./money.module.css";

// The Money tab: Jack's own bets, Phil (the Polymarket paper agent) and the
// paper stock books, all paper or unit-based. Bets live in this app;
// Phil and the books are a snapshot posted from Jack's Mac after each run.
// Kalshi is Phil's shadow record on a second venue, shown on its own tab and
// never added into his Polymarket numbers.

export type MoneyTab = "overview" | "bets" | "phil" | "kalshi" | "books";
// My bets is hidden for now (Jack, 2026-10-15): the logged plays weren't
// actually bet. The code and the logged data stay; flip this to bring it back.
const SHOW_BETS = false;
const TABS: { id: MoneyTab; label: string }[] = [
  { id: "overview", label: "Overview" },
  ...(SHOW_BETS ? [{ id: "bets" as const, label: "My bets" }] : []),
  { id: "phil", label: "Phil" },
  { id: "kalshi", label: "Kalshi" },
  { id: "books", label: "Stock books" },
];
export const parseMoneyTab = (x: unknown): MoneyTab => (TABS.some((t) => t.id === x) ? (x as MoneyTab) : "overview"); // hidden tabs fall back to Overview
const href = (t: MoneyTab) => (t === "overview" ? "/money" : `/money?v=${t}`);

const usd = (n: number, signed = false) =>
  `${signed && n > 0 ? "+" : n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: Math.abs(n) < 100 ? 2 : 0, maximumFractionDigits: Math.abs(n) < 100 ? 2 : 0 })}`;
const units = (n: number) => `${n > 0 ? "+" : ""}${n.toFixed(2)}u`;
const pct = (n: number) => `${n > 0 ? "+" : ""}${(n * 100).toFixed(1)}%`;
const tone = (n: number) => (n > 0 ? s.pos : n < 0 ? s.neg : "");
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

function philChart(p: Phil, height?: number, width?: number) {
  return (
    <LineChart
      series={[{ label: "Phil", points: p.curve.map((c) => ({ x: t(c.ts), y: c.equity })), tone: "auto" }]}
      baseline={p.bankroll}
      format={(y) => usd(y)}
      height={height}
      width={width}
      ariaLabel="Phil's paper bankroll after each settled bet"
    />
  );
}

function PhilRow({ b }: { b: PhilBet }) {
  return (
    <tr>
      <td>
        <div>{b.slug ? <a href={`https://polymarket.com/event/${b.slug}`} target="_blank" rel="noreferrer">{b.question}</a> : b.question}</div>
        <div className={m.why}>
          {b.outcome} at {b.entry !== null ? `${Math.round(b.entry * 100)}¢` : "?"} · Phil said {b.est !== null ? `${Math.round(b.est * 100)}%` : "?"}
          {b.category ? ` · ${b.category}` : ""}
        </div>
      </td>
      <td className={s.num}>{b.stake !== null ? usd(b.stake) : ""}</td>
      <td><Outcome o={b.status} /></td>
      <td className={`${s.num} ${b.pnl !== null ? tone(b.pnl) : s.muted}`}>{b.pnl !== null ? usd(b.pnl, true) : b.endDate ? `ends ${when(b.endDate)}` : ""}</td>
    </tr>
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
        {p.lastCycle ? `, last cycle ${when(p.lastCycle)}.` : "."}{" "}Phil is a Claude agent paper-trading short Polymarket markets. Its yardstick is the
        market itself: a Brier score below the market&apos;s on the same bets means its probabilities beat the prices it paid.
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
      {p.tracks.length > 0 && (
        <div className={m.panel}>
          <h2 className={m.panelTitle}>Pilot tracks</h2>
          <p className={s.notice}>Shadow tracks: Phil's bets since the pilot started, replayed at a capped stake per bet on paper entry prices. Fills and liquidity at larger sizes are not modeled.</p>
          <div className={m.scroll}>
            <table className={s.table}>
              <thead><tr><th>Track</th><th>Max stake</th><th>Bets</th><th>P&amp;L</th></tr></thead>
              <tbody>
                {p.tracks.map((k) => (
                  <tr key={k.name}>
                    <td>{k.name}</td>
                    <td className={s.num}>{usd(k.maxStake)}</td>
                    <td className={s.num}>{k.bets}</td>
                    <td className={`${s.num} ${tone(k.realizedPnl)}`}>{usd(k.realizedPnl, true)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------ books ---- */

function bookChart(b: Book, height?: number, width?: number) {
  return (
    <LineChart
      series={[
        { label: b.label, points: b.curve.map((c) => ({ x: t(c.day), y: c.equity })), tone: "auto" },
        { label: "SPY held", points: b.curve.filter((c) => c.spy !== null).map((c) => ({ x: t(c.day), y: c.spy! })) },
      ]}
      baseline={b.start}
      format={(y) => `$${(y / 1000).toFixed(1)}k`}
      height={height}
      width={width}
      ariaLabel={`${b.label} against SPY`}
    />
  );
}

function BookPanel({ b }: { b: Book }) {
  const ret = b.equity / b.start - 1;
  const spy = b.spyEquity !== null ? b.spyEquity / b.start - 1 : null;
  return (
    <div className={m.panel}>
      <div className={m.panelHead}>
        <h2 className={m.panelTitle}>{b.label}{b.retired ? <span className={s.muted}>{` retired ${b.retired}`}</span> : null}</h2>
        <span className={`${s.num} ${tone(ret)}`}>{pct(ret)}{spy !== null ? <span className={s.muted}>{` vs SPY ${pct(spy)}`}</span> : null}</span>
      </div>
      <p className={m.sub}>{b.about}</p>
      {bookChart(b, 220, 480)}
      {b.positions.length > 0 && (
        <details className={m.holdings}>
          <summary>{`${b.positions.length} ${b.positions.length === 1 ? "holding" : "holdings"}`}</summary>
          <ul className={m.holdList}>
            {[...b.positions]
              .map((p) => ({ p, g: p.last !== null ? p.last / p.entryPrice - 1 : null }))
              .sort((x, y) => (y.g ?? -9) - (x.g ?? -9))
              .map(({ p, g }) => (
                <li key={p.symbol} className={m.hold}>
                  <span className={s.play}>{p.symbol}</span>
                  <span className={`${s.num} ${g !== null ? tone(g) : s.muted}`}>{g !== null ? pct(g) : "n/a"}</span>
                  <span className={m.why}>
                    {`${p.shares} sh at ${p.entryPrice.toFixed(2)}${p.last !== null ? `, now ${p.last.toFixed(2)}` : ""}. ${p.reason}`}
                  </span>
                </li>
              ))}
          </ul>
        </details>
      )}
      <p className={m.why}>{`Cash ${usd(b.cash)}. Started ${b.started}, marked through ${b.asOf ?? "n/a"}.`}</p>
    </div>
  );
}

const TAG: Record<string, string> = { open: m.tagOpen, retire: m.tagRetire, fix: m.tagFix, watch: m.tagWatch };

function Tag({ k }: { k: string }) {
  return <span className={`${m.tag} ${TAG[k] ?? ""}`}>{k}</span>;
}

function LearnLog({ log }: { log: LearnEntry[] }) {
  return (
    <div className={m.panel}>
      <div className={m.panelHead}><h2 className={m.panelTitle}>Learn log</h2><span className={m.sub}>Saturdays, newest first</span></div>
      <p className={m.sub}>
        What the weekly learner decided, what got fixed, and what Claude&apos;s retro is watching. The keep, retire and open rules are fixed; only Jack changes them.
      </p>
      {log.map((e) => (
        <div key={e.day} className={m.week}>
          <div className={m.weekHead}>
            <span>{`Week of ${e.day}`}</span>
            {e.tested !== null && <span className={s.muted}>{`${e.tested.toLocaleString("en-US")} tested, ${e.candidates} candidates, ${e.proven} proven`}</span>}
          </div>
          <ul className={m.logList}>
            {e.decisions.map((d, i) => (
              <li key={`d${i}`}><Tag k={d.action} /><b>{d.book}</b><span className={m.why}>{d.why}</span></li>
            ))}
            {e.watch.map((w, i) => <li key={`w${i}`}><Tag k="watch" />{w}</li>)}
            {e.lessons && <li className={m.lesson}>{e.lessons}</li>}
            {e.fixes.map((f, i) => <li key={`f${i}`}><Tag k="fix" />{f}</li>)}
            {!e.decisions.length && !e.watch.length && !e.lessons && !e.fixes.length && <li className={s.muted}>No decisions. Every book kept.</li>}
          </ul>
        </div>
      ))}
    </div>
  );
}

function BooksTab({ books, log }: { books: Book[]; log: LearnEntry[] }) {
  return (
    <section className={s.section}>
      <p className={s.notice}>
        {`${books.length} paper books, $100,000 each, traded by the trade bot at 6:30am Tuesday to Saturday on the previous close. The dashed line is the same `}
        $100,000 put in SPY on day one and left alone: a book only earns its keep by staying above it. Books named Lab were picked by the strategy lab and
        are kept or retired by the weekly learner.
      </p>
      {log.length > 0 && <LearnLog log={log} />}
      <div className={m.books}>{books.map((b) => <BookPanel key={b.id} b={b} />)}</div>
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
      {settled ? (
        <td className={`${s.num} ${money !== null ? tone(money) : ""}`}>
          <Outcome o={r.status} />{" "}
          {money !== null && r.status !== "void" ? (r.decision === "bet" ? usd(money, true) : <span className={s.muted}>{`would be ${usd(money, true)}`}</span>) : ""}
        </td>
      ) : (
        <td className={`${s.num} ${s.muted}`}>{r.closes ? `settles ${when(r.closes)}` : ""}</td>
      )}
    </tr>
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
    </section>
  );
}

/* --------------------------------------------------------- overview ---- */

function Overview({ v }: { v: Awaited<ReturnType<typeof getMoneyView>> }) {
  const p = v.snapshot?.phil;
  const k = v.snapshot?.kalshi;
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
        <div className={`${s.tile} ${bookNow > bookStart ? s.good : bookNow < bookStart ? s.bad : ""}`}>
          <span className={s.tileV}>{books.length ? pct(bookNow / bookStart - 1) : "n/a"}</span>
          <span className={s.tileK}>{`stock books, all ${books.length}`}</span>
        </div>
        <div className={s.tile}>
          <span className={s.tileV}>{books.length ? pct(spyNow / bookStart - 1) : "n/a"}</span>
          <span className={s.tileK}>SPY over the same days</span>
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
        {k && !k.error && (
          <div className={m.panel}>
            <div className={m.panelHead}><h2 className={m.panelTitle}>Kalshi, shadow</h2><Link className={m.panelLink} href={href("kalshi")}>What it&apos;s tracking</Link></div>
            <span className={m.big}>{k.open}</span>
            <span className={m.sub}>{`open calls, ${k.settled} settled${k.settledBets ? `, shadow P&L ${usd(k.pnl, true)}` : ""}. Nothing placed; kept apart from Phil's Polymarket record.`}</span>
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
                {`Phil and books updated ${when(snap.generatedAt)}`}
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
        {v && tab === "kalshi" && snap && (snap.kalshi
          ? (snap.kalshi.error ? <p className={s.error}>{snap.kalshi.error}</p> : <KalshiTab k={snap.kalshi} />)
          : <p className={s.calm}>Kalshi has not reported yet. It posts with Phil after his next cycle.</p>)}
        {v && tab === "books" && snap && <BooksTab books={snap.books} log={snap.learnLog ?? []} />}

        <footer className={s.footer}>
          <span>
            Phil and the stock books run on the Mac (trade-bot) and post a snapshot here after each run. Bets grade from ESPN. Everything here is paper
            money or betting units, a record and not advice.
          </span>
        </footer>
      </div>
    </main>
  );
}
