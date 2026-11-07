import type { Book, OptionsDesk, ResearchSwitch } from "@/lib/money/types";
import { LineChart } from "./Chart";
import { DeskHero, Stats } from "./desks";
import s from "../picks/picks.module.css";
import m from "./money.module.css";
import { Term } from "./Term";

// Two paper books that trade on the /stocks research (trade-bot, added 2026-11-07):
//   research-switch  TQQQ when the outlook leans up, SQQQ when it leans down, T-bills otherwise
//                    (a stock book: it also shows on the Stock books tab and the learner grades it)
//   options-qqq      a QQQ call or put 30 to 45 days out on the same lean (this tab's own desk)
// Both read the outlook the 6pm /stocks run writes; neither calls a model.

const usd = (n: number, signed = false) =>
  `${signed && n > 0 ? "+" : n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
const pct = (n: number, dp = 1) => `${n > 0 ? "+" : n < 0 ? "-" : ""}${Math.abs(n * 100).toFixed(dp)}%`;
const shortDay = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const t = (iso: string) => Date.parse(`${iso}T16:00:00Z`);
const tone = (n: number | null | undefined) => (n == null ? s.muted : n > 0 ? s.pos : n < 0 ? s.neg : "");

const LEAN: Record<string, { label: string; cls: string }> = {
  TQQQ: { label: "Leans up", cls: s.readW },
  SQQQ: { label: "Leans down", cls: s.readL },
  BIL: { label: "No lean", cls: s.readTrack },
};

const TERM = {
  lean: "Read from the /stocks daily outlook. Weeks call up or down at medium or high confidence (with the days call not pointing the other way), or days and weeks agreeing, counts as a lean. Anything else is no lean.",
  dte: "Days to expiry. The book buys 30 to 45 days out and sells with 7 days left, before time decay speeds up.",
  risk: "The most an option can lose is what it cost. Each trade spends 5% of the book (2.5% when VIX is 30 or higher).",
};

/** The research-switch book from the snapshot's stock books, if it has started. */
export function switchBook(books: Book[]): Book | null {
  return books.find((b) => b.id === "research-switch") ?? null;
}

function head(o: OptionsDesk | null | undefined) {
  const start = 100_000;
  const curve = o?.curve ?? [];
  const last = curve.at(-1);
  const first = curve.find((c) => c.spy !== null);
  const equity = o?.equity ?? start;
  return {
    start, equity, ret: equity / start - 1,
    spyRet: last?.spy != null && first ? last.spy / start - 1 : null,
    asOf: last?.day ?? null,
  };
}

export function OptionsHero({ o, rs }: { o?: OptionsDesk | null; rs?: ResearchSwitch | null }) {
  const h = head(o);
  const today = rs?.log?.[0];
  const lean = today ? LEAN[today.hold] ?? LEAN.BIL : null;
  return (
    <DeskHero
      eyebrow="Research bots · TQQQ/SQQQ switch and QQQ options · paper"
      title={
        o?.curve?.length ? (
          <>
            {"Options book: "}
            <span className={h.ret >= 0 ? s.pos : s.neg}>{usd(h.equity - h.start, true)}</span>
          </>
        ) : (
          "Options book: waiting for its first run"
        )
      }
      sub={
        `${lean ? `Research today: ${lean.label.toLowerCase()} (${shortDay(today!.as_of)} close). ` : ""}`
        + (o?.curve?.length
          ? `Book ${usd(h.equity)} (${pct(h.ret, 2)}), SPY over the same days ${h.spyRet !== null ? pct(h.spyRet, 2) : "n/a"}. Far too early to judge.`
          : "It checks the market at 10:05am and 3:55pm Eastern on weekdays and only buys when the research leans.")
      }
    />
  );
}

export function OptionsTab({ o, rs, books }: { o?: OptionsDesk | null; rs?: ResearchSwitch | null; books: Book[] }) {
  const h = head(o);
  const curve = o?.curve ?? [];
  const sw = switchBook(books);
  const swRet = sw ? sw.equity / sw.start - 1 : null;
  const swSpy = sw?.spyEquity != null ? sw.spyEquity / sw.start - 1 : null;
  const swHold = sw?.positions.find((p) => p.symbol !== "BIL")?.symbol ?? (sw ? "BIL" : null);
  const log = rs?.log ?? [];

  return (
    <section className={s.section}>
      <Stats
        label="Research bots at a glance"
        items={[
          { k: "Options book", v: pct(h.ret, 2), sub: `${usd(h.equity)} of ${usd(h.start)}`, tone: h.ret > 0 ? "up" : h.ret < 0 ? "down" : undefined },
          { k: "SPY, same days", v: h.spyRet !== null ? pct(h.spyRet, 2) : "·", sub: "from the first mark" },
          { k: "TQQQ/SQQQ switch", v: swRet !== null ? pct(swRet, 2) : "·", sub: sw ? `holds ${swHold}, SPY ${swSpy !== null ? pct(swSpy, 2) : "n/a"}` : "starts with the next 6:30am run", tone: swRet && swRet > 0 ? "up" : swRet && swRet < 0 ? "down" : undefined },
          { k: "Open options", v: `${o?.positions.length ?? 0}`, sub: o?.positions[0] ? o.positions[0].kind : "none" },
        ]}
      />

      <div className={m.panel}>
        <div className={m.panelHead}>
          <h2 className={m.panelTitle}><Term label="Research lean" def={TERM.lean} /></h2>
          <span className={m.foldMeta}>from the 6pm /stocks outlook</span>
        </div>
        {log.length ? (
          <ul className={m.grades}>
            {log.slice(0, 10).map((r) => {
              const l = LEAN[r.hold] ?? LEAN.BIL;
              return (
                <li key={r.as_of} className={m.grade}>
                  <span className={s.play}>{shortDay(r.as_of)}</span>
                  <span className={`${s.readChip} ${l.cls}`}>{`${l.label} · ${r.hold}`}</span>
                  <span className={m.why}>{r.why}</span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className={m.sub}>No reads yet. The switch book logs one each morning at 6:30am, Tuesday to Saturday.</p>
        )}
        {rs?.rule && <p className={s.thin}>{`Rule: ${rs.rule}`}</p>}
      </div>

      {curve.length >= 2 ? (
        <div className={m.panel}>
          <div className={m.panelHead}>
            <h2 className={m.panelTitle}>Options book against SPY</h2>
            <span className={m.foldMeta}>{`${curve.length} sessions`}</span>
          </div>
          <LineChart
            series={[
              { label: "Options book", points: curve.map((c) => ({ x: t(c.day), y: c.equity })), tone: "auto" },
              { label: "SPY", points: curve.filter((c) => c.spy !== null).map((c) => ({ x: t(c.day), y: c.spy! })) },
            ]}
            baseline={h.start}
            format={(y) => `$${(y / 1000).toFixed(1)}k`}
            height={240}
            width={900}
            ariaLabel="The options book against SPY"
          />
        </div>
      ) : (
        <p className={s.thin}>The chart starts after the second session.</p>
      )}

      <div className={m.panel}>
        <div className={m.panelHead}>
          <h2 className={m.panelTitle}>Open options</h2>
          <span className={m.foldMeta}><Term label="Risk per trade" def={TERM.risk} /></span>
        </div>
        {o?.positions.length ? (
          <ul className={m.grades}>
            {o.positions.map((p) => {
              const now = p.last_mid ?? p.entry_price;
              const chg = now / p.entry_price - 1;
              // Counted from the book's last mark, not the viewer's clock, so the page renders the same everywhere.
              const dte = Math.round((Date.parse(`${p.expiry}T12:00:00Z`) - Date.parse(`${h.asOf ?? p.entry_day}T12:00:00Z`)) / 86_400_000);
              return (
                <li key={p.contract} className={m.grade}>
                  <span className={s.play}>{`QQQ ${p.strike} ${p.kind} · ${p.qty}x`}</span>
                  <span className={`${s.num} ${tone(chg)}`}>{pct(chg)}</span>
                  <span className={m.why}>
                    {`Bought ${shortDay(p.entry_day)} at $${p.entry_price.toFixed(2)}, now about $${now.toFixed(2)}. Expires ${shortDay(p.expiry)} (`}
                    <Term label={`${dte} DTE`} def={TERM.dte} />
                    {`). Out at +50%, -50%, 7 days left, or a flip.`}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className={m.sub}>Nothing open. The book only buys when the research leans up or down.</p>
        )}
      </div>

      {(o?.fills.length ?? 0) > 0 && (
        <details className={m.inner}>
          <summary>{`Recent fills (${o!.fills.length})`}</summary>
          <div className={m.scroll}><table className={m.trades}>
            <tbody>
              {o!.fills.map((f) => (
                <tr key={`${f.at}${f.contract}${f.side}`}>
                  <td>{shortDay(f.at)}</td>
                  <td>{`${f.side} ${f.qty}x ${f.contract}`}</td>
                  <td className={m.tnum}>{`$${f.price.toFixed(2)}`}</td>
                  <td>{f.reason}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </details>
      )}

      <p className={s.thin}>
        {o?.about ?? "Buys a QQQ call or put when the research leans."}
        {" Fills use Yahoo's delayed quotes: buys at the ask, sells at the bid, $0.65 a contract. The learner grades both books against SPY with the same rules as every stock book."}
      </p>
    </section>
  );
}
