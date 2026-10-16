import Link from "next/link";
import { getMoneyView } from "@/lib/money/store";
import type { MoneyBet } from "@/lib/money/bets";
import type { Book, Phil, PhilBet } from "@/lib/money/types";
import { LineChart } from "./Chart";
import s from "../picks/picks.module.css";
import m from "./money.module.css";

// The Money tab: Jack's own bets, Phil (the Polymarket paper agent) and the
// four paper stock books, all paper or unit-based. Bets live in this app;
// Phil and the books are a snapshot posted from Jack's Mac after each run.

export type MoneyTab = "overview" | "bets" | "phil" | "books";
const TABS: { id: MoneyTab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "bets", label: "My bets" },
  { id: "phil", label: "Phil" },
  { id: "books", label: "Stock books" },
];
export const parseMoneyTab = (x: unknown): MoneyTab => (TABS.some((t) => t.id === x) ? (x as MoneyTab) : "overview");
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
      <div className={m.panel}>
        <h2 className={m.panelTitle}>Settled</h2>
        <div className={m.scroll}>
          <table className={s.table}>
            <thead><tr><th>Market</th><th>Stake</th><th>Result</th><th>P&amp;L</th></tr></thead>
            <tbody>{p.settledBets.map((b) => <PhilRow key={b.id} b={b} />)}</tbody>
          </table>
        </div>
      </div>
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
        <h2 className={m.panelTitle}>{b.label}</h2>
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

function BooksTab({ books }: { books: Book[] }) {
  return (
    <section className={s.section}>
      <p className={s.notice}>
        Four paper books, $100,000 each, traded by the trade bot at 6:30am Tuesday to Saturday on the previous close. The dashed line is the same
        $100,000 put in SPY on day one and left alone: a book only earns its keep by staying above it.
      </p>
      <div className={m.books}>{books.map((b) => <BookPanel key={b.id} b={b} />)}</div>
    </section>
  );
}

/* --------------------------------------------------------- overview ---- */

function Overview({ v }: { v: Awaited<ReturnType<typeof getMoneyView>> }) {
  const p = v.snapshot?.phil;
  const books = v.snapshot?.books ?? [];
  const bookStart = books.reduce((a, b) => a + b.start, 0);
  const bookNow = books.reduce((a, b) => a + b.equity, 0);
  const spyNow = books.reduce((a, b) => a + (b.spyEquity ?? b.start), 0);
  // The four books on one line: summed by day.
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
        <div className={`${s.tile} ${v.summary.net > 0 ? s.good : v.summary.net < 0 ? s.bad : ""}`}>
          <span className={s.tileV}>{units(v.summary.net)}</span>
          <span className={s.tileK}>{`my bets, ${v.summary.wins}-${v.summary.losses}`}</span>
        </div>
        <div className={`${s.tile} ${p && p.equity > p.bankroll ? s.good : p && p.equity < p.bankroll ? s.bad : ""}`}>
          <span className={s.tileV}>{p && !p.error ? usd(p.equity - p.bankroll, true) : "n/a"}</span>
          <span className={s.tileK}>Phil, paper</span>
        </div>
        <div className={`${s.tile} ${bookNow > bookStart ? s.good : bookNow < bookStart ? s.bad : ""}`}>
          <span className={s.tileV}>{books.length ? pct(bookNow / bookStart - 1) : "n/a"}</span>
          <span className={s.tileK}>stock books, all four</span>
        </div>
        <div className={s.tile}>
          <span className={s.tileV}>{books.length ? pct(spyNow / bookStart - 1) : "n/a"}</span>
          <span className={s.tileK}>SPY over the same days</span>
        </div>
      </div>
      <div className={m.panels}>
        <div className={m.panel}>
          <div className={m.panelHead}><h2 className={m.panelTitle}>My bets</h2><Link className={m.panelLink} href={href("bets")}>All bets</Link></div>
          {betChart(v.summary, 230, 360)}
        </div>
        {p && !p.error && (
          <div className={m.panel}>
            <div className={m.panelHead}><h2 className={m.panelTitle}>Phil</h2><Link className={m.panelLink} href={href("phil")}>Ledger</Link></div>
            {philChart(p, 230, 360)}
          </div>
        )}
        {books.length > 0 && (
          <div className={m.panel}>
            <div className={m.panelHead}><h2 className={m.panelTitle}>Stock books</h2><Link className={m.panelLink} href={href("books")}>Each book</Link></div>
            <LineChart
              series={[{ label: "All four books", points: combined, tone: "auto" }, { label: "SPY held", points: combinedSpy }]}
              baseline={bookStart}
              format={(y) => `$${(y / 1000).toFixed(0)}k`}
              height={230}
              width={360}
              ariaLabel="The four stock books combined against SPY"
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
        {v && v.problems.length > 0 && <p className={s.error}>{`Some bets could not be checked against ESPN: ${v.problems.join("; ")}`}</p>}
        {v && !snap && tab !== "bets" && (
          <p className={s.calm}>Phil and the stock books have not reported yet. They post here from the Mac after their next run.</p>
        )}

        {v && tab === "overview" && <Overview v={v} />}
        {v && tab === "bets" && <BetsTab v={v} />}
        {v && tab === "phil" && snap?.phil && (snap.phil.error ? <p className={s.error}>{snap.phil.error}</p> : <PhilTab p={snap.phil} />)}
        {v && tab === "books" && snap && <BooksTab books={snap.books} />}

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
