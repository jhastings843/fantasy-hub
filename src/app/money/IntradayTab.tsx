import type { Intraday, IntradayRow, IntradayStats } from "@/lib/money/types";
import { decidedOdds, filterRead, intradayHead, openTrades, todayRows } from "@/lib/money/intraday";
import { LineChart } from "./Chart";
import { DeskHero, Stats } from "./desks";
import s from "../picks/picks.module.css";
import m from "./money.module.css";
import { Term } from "./Term";

// The intraday desk (trade-bot tradebot/intraday.py, added 2026-10-28): opening-range
// breakouts on 5-minute bars, each one run past the Time Machine (10,000 replays of
// the rest of the day plus the same rule on the last 60 days of real sessions).
// Taken breakouts are paper-traded; turned-down ones are replayed on the real bars
// at the close, so the page can say whether the filter earns its keep. Its own
// $100,000 paper book, graded against SPY's open-to-close each day.

const usd = (n: number, signed = false) =>
  `${signed && n > 0 ? "+" : n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
const pct = (n: number, dp = 1) => `${n > 0 ? "+" : n < 0 ? "-" : ""}${Math.abs(n * 100).toFixed(dp)}%`;
const rr = (n: number) => `${n > 0 ? "+" : n < 0 ? "-" : ""}${Math.abs(n).toFixed(2)}R`;
const tone = (n: number | null | undefined) => (n == null ? s.muted : n > 0 ? s.pos : n < 0 ? s.neg : "");
const shortDay = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const t = (iso: string) => Date.parse(`${iso}T16:00:00Z`);
/** "13:10" on the exchange clock as "1:10pm". */
const clock = (hm: string | null) => {
  if (!hm) return "";
  const [h, mm] = hm.split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${String(mm).padStart(2, "0")}${h < 12 ? "am" : "pm"}`;
};

const TERM = {
  r: "R is the result measured in planned risk. Each trade sets its stop so a loss is 1R (at most $500 here); hitting the 2R target makes twice that. -1.00R means stopped out at the planned loss.",
  shadow: "Turned down: the filter said no, so nothing was bought. At the close the desk replays the trade on the real 5-minute bars anyway, as if it had been taken. That shadow record is what the taken trades are compared with.",
  tm: "The Time Machine replays the rest of the day 10,000 times from the breakout. This is the share of replays that reached the target before the stop, counting only replays that reached one of them. At a 2R target, break-even is 33%.",
  hit: "Share of graded trades that made money (finished above 0R).",
};

const OUTCOME: Record<string, string> = { target: "Hit target", stop: "Stopped", flat: "Flat at close" };

function Result({ r }: { r: IntradayRow }) {
  if (r.outcome === null) return <span className={`${m.outcome} ${m.oOpen}`}>{r.decision === "taken" ? "Open" : "Grades at close"}</span>;
  const cls = (r.r ?? 0) > 0 ? m.oW : (r.r ?? 0) < 0 ? m.oL : m.oOpen;
  return (
    <span className={m.ixResult}>
      <span className={`${m.outcome} ${cls}`}>{`${OUTCOME[r.outcome] ?? r.outcome}${r.r !== null ? ` ${rr(r.r)}` : ""}`}</span>
      {r.pnl !== null && <span className={`${s.num} ${tone(r.pnl)}`}>{usd(r.pnl, true)}</span>}
    </span>
  );
}

function BreakoutRow({ r }: { r: IntradayRow }) {
  const odds = decidedOdds(r);
  return (
    <li className={m.ixRow}>
      <span className={m.ixWho}>
        <b>{r.symbol}</b>
        <span className={`${s.num} ${s.muted}`}>{clock(r.trigger_time)}</span>
        <span className={`${m.tag} ${r.decision === "taken" ? m.tagOpen : ""}`}>{r.decision === "taken" ? "taken" : "turned down"}</span>
      </span>
      <Result r={r} />
      <span className={m.why}>
        {r.reason}
        {/* A turned-down reason already quotes the odds; say them only when it doesn't. */}
        {odds !== null && !/target first/i.test(r.reason ?? "") && ` · Time Machine: target first ${Math.round(odds * 100)}%`}
        {r.hist_n != null && r.hist_r != null && ` · last 60 days: fired ${r.hist_n}x, ${rr(r.hist_r)} avg`}
      </span>
    </li>
  );
}

function SideCard({ label, def, st, cls }: { label: string; def?: string; st?: IntradayStats | null; cls: string }) {
  return (
    <div className={`${m.ixSide} ${cls}`}>
      <span className={m.ixSideHead}>{def ? <Term label={label} def={def} /> : <span className={m.tag}>{label}</span>}</span>
      <span className={`${m.ixBig} ${tone(st?.meanR)}`}>{st?.meanR != null ? rr(st.meanR) : "·"}</span>
      <span className={m.ixSideSub}>average per trade</span>
      <span className={m.ixSideNums}>
        <span><b className={s.num}>{st?.n ?? 0}</b> graded</span>
        <span><b className={s.num}>{st?.hit != null ? `${Math.round(st.hit * 100)}%` : "·"}</b> made money</span>
      </span>
    </div>
  );
}

const TAG_NAME: Record<string, string> = {
  "quality:yes": "Passed the quality screen", "quality:no": "Failed the quality screen",
  "berkshire:yes": "Berkshire holds it", "berkshire:no": "Berkshire doesn't hold it",
};

export function IntradayHero({ d }: { d: Intraday }) {
  const h = intradayHead(d);
  const days = d.record?.days ?? (d.curve ?? []).length;
  return (
    <DeskHero
      eyebrow="Intraday · opening-range breakouts · paper"
      title={
        h.waiting ? (
          "Intraday: waiting for the first session"
        ) : h.edge !== null ? (
          <>
            {"Intraday: "}
            <span className={h.edge >= 0 ? s.pos : s.neg}>{`${pct(h.edge, 2)} vs SPY`}</span>
          </>
        ) : (
          <>
            {"Intraday: "}
            <span className={h.ret >= 0 ? s.pos : s.neg}>{usd(h.equity - h.start, true)}</span>
          </>
        )
      }
      sub={
        h.waiting
          ? `A $${(h.start / 1000).toFixed(0)}k paper book that trades breakouts from the first half hour, only when the Time Machine says the odds are good. ${d.status && !/waiting for the first session/i.test(d.status) ? `Status: ${d.status}.` : ""}`
          : `Through ${h.asOf ? shortDay(h.asOf) : "the last session"}: the book is ${usd(h.equity)} (${pct(h.ret, 2)}), the same money in SPY open-to-close ${h.spyRet !== null ? pct(h.spyRet, 2) : "n/a"}. ${days} ${days === 1 ? "session" : "sessions"} graded${days < 20 ? ", far too few to judge" : ""}.`
      }
    />
  );
}

export function IntradayTab({ d }: { d: Intraday }) {
  const h = intradayHead(d);
  const curve = d.curve ?? [];
  const rec = d.record ?? null;
  const read = filterRead(rec?.taken, rec?.shadow);
  const open = openTrades(d);
  const rows = todayRows(d);
  const taken = rows.filter((r) => r.decision === "taken");
  const down = rows.filter((r) => r.decision !== "taken");
  const SHOWN = 6;
  const day = curve.at(-1)?.day ?? d.asOf ?? rows[0]?.day ?? null;
  const recent = (d.recent ?? []).filter((r) => r.outcome !== null);
  const tags = Object.entries(rec?.tags ?? {});
  const rules = d.rules;
  const tax = d.tax ?? null;
  const readCls = read.kind === "helping" ? s.readW : read.kind === "hurting" ? s.readL : s.readTrack;

  return (
    <section className={s.section}>
      <Stats
        label="Intraday at a glance"
        items={[
          { k: "Book", v: pct(h.ret, 2), sub: `${usd(h.equity)} of ${usd(h.start)}`, tone: h.ret > 0 ? "up" : h.ret < 0 ? "down" : undefined },
          { k: "SPY, same days", v: h.spyRet !== null ? pct(h.spyRet, 2) : "·", sub: "open to close each day" },
          { k: "Taken", v: `${rec?.taken.n ?? 0}`, sub: rec?.taken.meanR != null ? `${rr(rec.taken.meanR)} average` : "none graded yet" },
          { k: "Turned down", v: `${rec?.shadow.n ?? 0}`, sub: rec?.shadow.meanR != null ? `${rr(rec.shadow.meanR)} if taken` : "none graded yet" },
        ]}
      />
      {curve.length >= 2 ? (
        <div className={m.panel}>
          <div className={m.panelHead}>
            <h2 className={m.panelTitle}>Book against SPY</h2>
            <span className={m.foldMeta}>{`${curve.length} sessions`}</span>
          </div>
          <LineChart
            series={[
              { label: "Intraday book", points: curve.map((c) => ({ x: t(c.day), y: c.equity })), tone: "auto" },
              { label: "SPY, open to close", points: curve.filter((c) => c.spy !== null).map((c) => ({ x: t(c.day), y: c.spy! })) },
            ]}
            baseline={h.start}
            format={(y) => `$${(y / 1000).toFixed(1)}k`}
            height={240}
            width={900}
            ariaLabel="The intraday book against SPY"
          />
        </div>
      ) : (
        !h.waiting && <p className={s.thin}>The chart starts after the second session.</p>
      )}

      <div className={m.panel}>
        <div className={m.panelHead}>
          <h2 className={m.panelTitle}>Is the filter helping?</h2>
          <span className={`${s.readChip} ${readCls}`}>{read.kind === "early" || read.kind === "empty" ? "Too early" : read.kind === "helping" ? "Helping" : read.kind === "hurting" ? "Hurting" : "No clear gap"}</span>
        </div>
        <p className={m.sub}>
          Every breakout is recorded. The ones the filter took were paper-traded; the ones it turned down were replayed on the real bars at the close. If the filter is worth having, the
          taken side should average more <Term label="R" def={TERM.r} /> than the turned-down side.
        </p>
        <div className={m.ixSides}>
          <SideCard label="taken" st={rec?.taken} cls={m.ixTaken} />
          <SideCard label="turned down" def={TERM.shadow} st={rec?.shadow} cls="" />
        </div>
        <p className={m.ixRead}>{read.text}</p>
        {tags.length > 0 && (
          <details className={m.inner}>
            <summary>{`Split by context tag (${tags.length})`}</summary>
            <table className={m.trades}>
              <tbody>
                {tags.map(([k, st]) => (
                  <tr key={k}>
                    <td>{TAG_NAME[k] ?? k}</td>
                    <td className={m.tnum}>{`${st.n} graded`}</td>
                    <td className={`${m.tnum} ${tone(st.meanR)}`}>{st.meanR != null ? rr(st.meanR) : "·"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        )}
      </div>

      <div className={m.panel}>
        <div className={m.panelHead}>
          <h2 className={m.panelTitle}>{day ? `Breakouts on ${shortDay(day)}` : "Today's breakouts"}</h2>
          <span className={m.foldMeta}>{rows.length ? `${taken.length} taken, ${down.length} turned down` : ""}</span>
        </div>
        {open.length > 0 && (
          <div>
            <h3 className={m.subHead}>{`Open now (${open.length})`}</h3>
            <ul className={m.grades}>
              {open.map((r) => (
                <li key={`${r.symbol}${r.trigger_time}`} className={m.grade}>
                  <span className={s.play}>{`${r.symbol} · ${r.shares ?? "?"} sh`}</span>
                  <span className={`${s.num} ${s.muted}`}>{clock(r.trigger_time)}</span>
                  <span className={m.why}>
                    {`In at ${r.entry?.toFixed(2) ?? "?"}, stop ${r.stop?.toFixed(2) ?? "?"}, target ${r.target?.toFixed(2) ?? "?"}. Out by ${clock(rules?.flat_by ?? "15:55")} at the latest.`}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {!rows.length && (
          <span className={m.sub}>
            {h.waiting ? "No session yet. Breakouts show here from about 10am Eastern once the desk runs." : "No breakouts that day."}
          </span>
        )}
        {rows.length > 0 && (
          <p className={s.thin}>
            <Term label="Time Machine odds" def={TERM.tm} />
            {" are the share of replays that hit the target first. Turned-down trades show what they would have done."}
          </p>
        )}
        {rows.length > 0 && (
          <ul className={m.ixList}>
            {[...taken, ...down.slice(0, SHOWN)].map((r) => <BreakoutRow key={`${r.symbol}${r.trigger_time}${r.decision}`} r={r} />)}
          </ul>
        )}
        {down.length > SHOWN && (
          <details className={m.inner}>
            <summary>{`${down.length - SHOWN} more turned down`}</summary>
            <ul className={m.ixList}>
              {down.slice(SHOWN).map((r) => <BreakoutRow key={`${r.symbol}${r.trigger_time}${r.decision}`} r={r} />)}
            </ul>
          </details>
        )}
        {(d.staleToday ?? 0) > 0 && (
          <p className={s.thin}>{`${d.staleToday} more ${d.staleToday === 1 ? "breakout was" : "breakouts were"} seen too late to act on.`}</p>
        )}
      </div>

      {recent.length > 0 && (
        <details className={`${m.panel} ${m.fold}`}>
          <summary className={m.foldHead}>
            <h2 className={m.panelTitle}>Recent taken trades</h2>
            <span className={m.foldMeta}>{`latest ${recent.length}`}</span>
          </summary>
          <table className={m.trades}>
            <tbody>
              {recent.map((r) => (
                <tr key={`${r.day}${r.symbol}${r.trigger_time}`}>
                  <td className={m.tday}>{shortDay(r.day)}</td>
                  <td>
                    <b>{r.symbol}</b>
                    <span className={`${s.muted} ${m.hideSm}`}>{` ${clock(r.trigger_time)} to ${clock(r.exit_time)}`}</span>
                  </td>
                  <td className={`${s.muted} ${m.hideSm}`}>{r.outcome ? OUTCOME[r.outcome] ?? r.outcome : ""}</td>
                  <td className={`${m.tnum} ${tone(r.r)}`}>{r.r !== null ? rr(r.r) : "·"}</td>
                  <td className={`${m.tnum} ${tone(r.pnl)}`}>{r.pnl !== null ? usd(r.pnl, true) : "·"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}

      <div className={m.panel}>
        <div className={m.panelHead}>
          <h2 className={m.panelTitle}>The rule</h2>
          <span className={m.foldMeta}>fixed, paper only</span>
        </div>
        <p className={m.sub}>
          {`A breakout is a 5-minute close above the first half hour's high. The stop sits at the middle of that range and the target is twice the risk (2R). `}
          {d.filter ?? ""}
        </p>
        {rules && (
          <div className={m.trackStrip}>
            <span><b className={s.num}>{usd(rules.max_loss_per_trade_usd)}</b>max loss a trade</span>
            <span><b className={s.num}>{usd(rules.max_daily_loss_usd)}</b>max loss a day</span>
            <span><b className={s.num}>{rules.max_trades_per_day}</b>trades a day at most</span>
            <span><b className={s.num}>{clock(rules.no_entries_after)}</b>no new trades after</span>
            <span><b className={s.num}>{clock(rules.flat_by)}</b>everything sold by</span>
          </div>
        )}
      </div>

      {(d.skills ?? []).length > 0 && (
        <details className={`${m.panel} ${m.fold}`}>
          <summary className={m.foldHead}>
            <h2 className={m.panelTitle}>How each skill is used</h2>
            <span className={m.foldMeta}>{`${d.skills!.length} skills`}</span>
          </summary>
          <ul className={m.grades}>
            {d.skills!.map((x) => (
              <li key={x.skill} className={m.ixSkill}>
                <span className={`${s.num} ${m.ixSkillName}`}>{x.skill.replace(/^trader-/, "")}</span>
                <span className={m.ixSkillRole}>{x.role}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {(tax || (d.log ?? []).length > 0) && (
        <details className={`${m.panel} ${m.fold}`}>
          <summary className={m.foldHead}>
            <h2 className={m.panelTitle}>Taxes and log</h2>
            <span className={m.foldMeta}>{tax ? `${usd(tax.short, true)} if real` : `${d.log!.length} entries`}</span>
          </summary>
          {tax && (
            <>
              <h3 className={m.subHead}>If this were real money</h3>
              <div className={m.trackStrip}>
                <span><b className={`${s.num} ${tone(tax.short)}`}>{usd(tax.short, true)}</b>short-term realized</span>
                {tax.long !== 0 && <span><b className={`${s.num} ${tone(tax.long)}`}>{usd(tax.long, true)}</b>long-term</span>}
                <span><b className={s.num}>{usd(tax.disallowed)}</b>loss disallowed (wash sale)</span>
                <span><b className={s.num}>{tax.count}</b>{tax.count === 1 ? "lot closed" : "lots closed"}</span>
              </div>
              <p className={s.thin}>
                Every trade here is a short-term gain or loss. A loss is disallowed for now when the same stock is bought again within 30 days (a wash sale); it is added to the new
                lot instead of lost.
              </p>
            </>
          )}
          {(d.log ?? []).length > 0 && (
            <>
              <h3 className={m.subHead}>Desk log</h3>
              <ul className={m.grades}>
                {d.log!.map((l, i) => (
                  <li key={`${l.at}${i}`} className={m.grade}>
                    <span><span className={`${m.tag} ${l.kind === "taken" ? m.tagOpen : l.kind === "exit" ? m.tagWatch : ""}`}>{l.kind}</span>{l.text}</span>
                    <span className={`${s.num} ${s.muted}`}>{l.at.slice(11, 16)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </details>
      )}
    </section>
  );
}
