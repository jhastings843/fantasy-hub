import type { VwapRebound, VwapShadow } from "@/lib/money/types";
import { bp, reboundRead, reboundToday, shadowLanes } from "@/lib/money/rebound";
import s from "../picks/picks.module.css";
import m from "./money.module.css";
import { Term } from "./Term";

// Two add-ons to the Day Trader, both from trade-bot on 2026-11-14:
// the VWAP rebound paper book (QQQ, the one social-media setup of five that
// passed a 10-year backtest) and the VWAP/EMA9 shadow log (the Instagram reel,
// graded with no money because it failed).

const usd = (n: number, signed = false) =>
  `${signed && n > 0 ? "+" : n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
const tone = (n: number | null | undefined) => (n == null ? s.muted : n > 0 ? s.pos : n < 0 ? s.neg : "");
const shortDay = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const clock = (hm: string | null) => {
  if (!hm) return "";
  const [h, mm] = hm.split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${String(mm).padStart(2, "0")}${h < 12 ? "am" : "pm"}`;
};
const BP = "A basis point is 0.01%. +20bp on a $100,000 trade is $200. Results here are after trading costs.";
const T = "The t-score says how sure the average is not luck. Under 2 is noise; trade-bot wants 3 before a strategy gets paper money.";
const CHIP = { live: s.readLive, win: s.readW, loss: s.readL, quiet: s.readTrack } as const;

export function ReboundPanel({ d }: { d: VwapRebound }) {
  const today = d.recent?.[0];
  const now = reboundToday(today);
  const rec = d.record;
  const b = d.backtest;
  const pnl = d.equity - d.start;
  const trades = (d.recent ?? []).filter((r) => r.state === "closed");
  return (
    <div className={m.panel}>
      <div className={m.panelHead}>
        <h2 className={m.panelTitle}>{`VWAP rebound · ${d.symbols.join(", ")}`}</h2>
        <span className={`${s.readChip} ${CHIP[now.tone]}`}>{now.chip}</span>
      </div>
      <p className={m.sub}>
        {today ? `${shortDay(today.day)}: ` : ""}
        {now.text}
      </p>
      <div className={m.trackStrip}>
        <span><b className={`${s.num} ${tone(pnl)}`}>{usd(pnl, true)}</b>{`on ${usd(d.start)} paper`}</span>
        <span><b className={s.num}>{rec?.n ?? 0}</b>{rec?.n === 1 ? "trade" : "trades"}</span>
        <span><b className={`${s.num} ${tone(rec?.meanBp)}`}>{rec?.meanBp != null ? bp(rec.meanBp) : "·"}</b>average</span>
        <span><b className={s.num}>{rec?.hit != null ? `${Math.round(rec.hit * 100)}%` : "·"}</b>made money</span>
        <span><b className={s.num}>{d.setupDays}</b>{`setup ${d.setupDays === 1 ? "day" : "days"} of ${d.days}`}</span>
      </div>
      <p className={m.ixRead}>{reboundRead(d)}</p>
      {trades.length > 0 && (
        <div className={m.scroll}><table className={m.trades}>
          <tbody>
            {trades.map((r) => (
              <tr key={`${r.day}${r.symbol}`}>
                <td className={m.tday}>{shortDay(r.day)}</td>
                <td>
                  <b>{r.symbol}</b>
                  <span className={`${s.muted} ${m.hideSm}`}>{` ${clock(r.entry_time)} to ${clock(r.exit_time)}`}</span>
                </td>
                <td className={`${m.tnum} ${tone(r.bp)}`}>{r.bp != null ? bp(r.bp) : "·"}</td>
                <td className={`${m.tnum} ${tone(r.pnl)}`}>{r.pnl != null ? usd(r.pnl, true) : "·"}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
      <details className={m.inner}>
        <summary>The rule and the backtest</summary>
        <p className={m.sub}>{d.rules}</p>
        <div className={m.trackStrip}>
          <span><b className={s.num}>{b.n}</b>{`${b.symbol} trades, 2016 to 2026`}</span>
          <span><b className={s.num}>{`${Math.round(b.hit * 100)}%`}</b>made money</span>
          <span><b className={`${s.num} ${s.pos}`}>{bp(b.meanBp)}</b><Term label="a trade" def={BP} /></span>
          <span><b className={s.num}>{b.pf.toFixed(2)}</b>profit factor</span>
          <span><b className={s.num}>{b.t.toFixed(2)}</b><Term label="t-score" def={T} /></span>
          <span><b className={`${s.num} ${s.neg}`}>{bp(b.worstBp)}</b>worst trade</span>
        </div>
        <p className={s.thin}>
          {`Most of the edge came after mid-2021 (t ${b.secondHalfT.toFixed(2)}); 2016 to mid-2021 was weaker (t ${b.firstHalfT.toFixed(2)}). No stop, about 10 trades a year. SPY failed the same test, so it trades QQQ only. Source: @QuantifiedStrat on X.`}
        </p>
      </details>
    </div>
  );
}

export function ShadowPanel({ d }: { d: VwapShadow }) {
  const lanes = shadowLanes(d);
  const chip = d.verdict === "candidate" ? s.readW : d.verdict === "no edge" ? s.readL : s.readTrack;
  return (
    <details className={`${m.panel} ${m.fold}`}>
      <summary className={m.foldHead}>
        <h2 className={m.panelTitle}>VWAP/EMA9 cross, no money</h2>
        <span className={`${s.readChip} ${chip}`}>{d.verdict === "candidate" ? "Candidate" : d.verdict === "no edge" ? "No edge" : `Collecting, ${d.days} days`}</span>
      </summary>
      <p className={m.sub}>
        {`The Instagram reel's setup failed our backtests, so it trades nothing. Every cross is still graded at the close to get a forward answer: ${d.bar}.`}
      </p>
      <div className={m.scroll}><table className={m.trades}>
        <tbody>
          {lanes.map(({ key, name, st }) => (
            <tr key={key}>
              <td>{name}</td>
              <td className={m.tnum}>{`${st.n}`}</td>
              <td className={`${m.tnum} ${tone(st.meanBp)}`}>{st.meanBp != null ? bp(st.meanBp) : "·"}</td>
              <td className={`${m.tnum} ${m.hideSm}`}>{st.t != null ? `t ${st.t.toFixed(2)}` : "·"}</td>
            </tr>
          ))}
        </tbody>
      </table></div>
    </details>
  );
}
