import type { OptionLane, OptionsDesk, ResearchSwitch } from "@/lib/money/types";
import { LineChart } from "./Chart";
import { DeskHero, Stats } from "./desks";
import s from "../picks/picks.module.css";
import m from "./money.module.css";
import { Term } from "./Term";
import { LEAN } from "./SwitchLean";

// The options book (trade-bot options-market, added 2026-11-07): calls and puts on any US
// stock or ETF the research names. Index lane = the /stocks lean on SPY, trend lane = the
// trend book's picks, idea lane = /stocks ideas once ready. No model calls.
// The TQQQ/SQQQ switch is a stock book and lives on Stock books (SwitchLean.tsx), not here
// (Jack, 2026-11-08: keep the two apart).

const usd = (n: number, signed = false) =>
  `${signed && n > 0 ? "+" : n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
const pct = (n: number, dp = 1) => `${n > 0 ? "+" : n < 0 ? "-" : ""}${Math.abs(n * 100).toFixed(dp)}%`;
const shortDay = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const t = (iso: string) => Date.parse(`${iso}T16:00:00Z`);
const tone = (n: number | null | undefined) => (n == null ? s.muted : n > 0 ? s.pos : n < 0 ? s.neg : "");


const LANE_NAME: Record<OptionLane, string> = { index: "Market lean", trend: "Trend picks", idea: "Stock ideas" };
const LANE_HOW: Record<OptionLane, string> = {
  index: "SPY call or put when the /stocks outlook leans, 30 to 45 days out. Out at +50% or -50%.",
  trend: "A call on each trend-book pick, expiring about three weeks past the pick's horizon. Out at +100%, -50%, or the horizon.",
  idea: "A call 60 to 90 days out when a /stocks idea hits its entry trigger. Out at +100%, -50%, or after 60 days.",
};

const TERM = {
  dte: "Days to expiry. The book buys 30 to 45 days out and sells with 7 days left, before time decay speeds up.",
  risk: "The most an option can lose is what it cost. Market-lean trades spend 4% of the book, trend and idea trades 2% (halved when VIX is 30 or higher). At most 8 open and 25% of the book at risk.",
};

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
      eyebrow="Options book · calls and puts on what the research names · paper"
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
        `${lean ? `Market lean today: ${lean.label.toLowerCase()} (${shortDay(today!.as_of)} close), which its SPY lane follows. ` : ""}`
        + (o?.curve?.length
          ? `Book ${usd(h.equity)} (${pct(h.ret, 2)}), SPY over the same days ${h.spyRet !== null ? pct(h.spyRet, 2) : "n/a"}. Far too early to judge.`
          : "It checks at 10:05am and 3:55pm Eastern on weekdays and buys calls or puts on whatever the research names: the market lean, trend picks, and ready stock ideas.")
      }
    />
  );
}

export function OptionsTab({ o }: { o?: OptionsDesk | null }) {
  const h = head(o);
  const curve = o?.curve ?? [];

  return (
    <section className={s.section}>
      <Stats
        label="Options book at a glance"
        items={[
          { k: "Options book", v: pct(h.ret, 2), sub: `${usd(h.equity)} of ${usd(h.start)}`, tone: h.ret > 0 ? "up" : h.ret < 0 ? "down" : undefined },
          { k: "SPY, same days", v: h.spyRet !== null ? pct(h.spyRet, 2) : "·", sub: "from the first mark" },
          { k: "Closed trades", v: `${(o?.lanes ?? []).reduce((a, l) => a + l.n, 0)}`, sub: "graded by lane below" },
          { k: "Open options", v: `${o?.positions.length ?? 0}`, sub: o?.positions.length ? [...new Set(o.positions.map((p) => p.underlying))].join(", ") : "none" },
        ]}
      />

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
                  <span className={s.play}>{`${p.underlying} ${p.strike} ${p.kind} · ${p.qty}x`}</span>
                  <span className={m.tag}>{LANE_NAME[p.lane] ?? p.lane}</span>
                  <span className={`${s.num} ${tone(chg)}`}>{pct(chg)}</span>
                  <span className={m.why}>
                    {`Bought ${shortDay(p.entry_day)} at $${p.entry_price.toFixed(2)}, now about $${now.toFixed(2)}. Expires ${shortDay(p.expiry)} (`}
                    <Term label={`${dte} DTE`} def={TERM.dte} />
                    {`). ${LANE_HOW[p.lane] ?? ""}`}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className={m.sub}>Nothing open. The book only buys when the research names something.</p>
        )}
      </div>

      <div className={m.panel}>
        <div className={m.panelHead}>
          <h2 className={m.panelTitle}>Which research earns its keep</h2>
          <span className={m.foldMeta}>closed trades, return on premium</span>
        </div>
        <div className={m.scroll}><table className={m.trades}>
          <tbody>
            {(o?.lanes ?? (["index", "trend", "idea"] as OptionLane[]).map((lane) => ({ lane, n: 0, mean: null, hit: null, t: null, benched: false, risk: 0 }))).map((l) => (
              <tr key={l.lane}>
                <td><b>{LANE_NAME[l.lane] ?? l.lane}</b><br /><span className={s.muted}>{LANE_HOW[l.lane]}</span></td>
                <td className={m.tnum}>{`${l.n} closed`}</td>
                <td className={`${m.tnum} ${tone(l.mean)}`}>{l.mean != null ? `${pct(l.mean)} avg` : "·"}</td>
                <td className={m.tnum}>{l.hit != null ? `${Math.round(l.hit * 100)}% won` : "·"}</td>
                <td>{l.benched ? <span className={`${s.readChip} ${s.readL}`}>Benched</span> : <span className={`${s.readChip} ${s.readTrack}`}>{l.n < 20 ? "Collecting" : "Active"}</span>}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
        {o?.bench && <p className={s.thin}>{o.bench}</p>}
      </div>

      {(o?.fills.length ?? 0) > 0 && (
        <details className={m.inner}>
          <summary>{`Recent fills (${o!.fills.length})`}</summary>
          <div className={m.scroll}><table className={m.trades}>
            <tbody>
              {o!.fills.map((f) => (
                <tr key={`${f.at}${f.contract}${f.side}`}>
                  <td>{shortDay(f.at)}</td>
                  <td>{`${f.side} ${f.qty}x ${f.contract}`}<br /><span className={s.muted}>{LANE_NAME[f.lane] ?? f.lane}</span></td>
                  <td className={m.tnum}>{`$${f.price.toFixed(2)}`}</td>
                  <td>{f.reason}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </details>
      )}

      <p className={s.thin}>
        {o?.about ?? "Buys calls and puts on what the research names."}
        {" Fills use Yahoo's delayed quotes: buys at the ask, sells at the bid, $0.65 a contract. The learner grades both books against SPY with the same rules as every stock book."}
      </p>
    </section>
  );
}
