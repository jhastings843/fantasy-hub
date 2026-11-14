import type { Satellite, SatelliteBet, SatelliteCalRow, SatelliteSignal, SatelliteSite } from "@/lib/money/types";
import { LineChart } from "./Chart";
import { DeskHero, Stats } from "./desks";
import s from "../picks/picks.module.css";
import m from "./money.module.css";

// The satellite desk (~/Projects/site-watch, added 2026-11-14): its own $1,000 paper book on
// Kalshi and Polymarket markets settled by satellite-measured numbers (monthly and yearly
// global temperature records, Polymarket's monthly temperature brackets, the Arctic sea ice
// max), plus a site watch on Sentinel-2 photos of construction sites. trade-bot passes
// site-watch's status.json through untouched as snapshot.satellite.

const usd = (n: number, signed = false) =>
  `${signed && n > 0 ? "+" : n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: Math.abs(n) < 100 ? 2 : 0, maximumFractionDigits: Math.abs(n) < 100 ? 2 : 0 })}`;
const whole = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const tone = (n: number) => (n > 0 ? s.pos : n < 0 ? s.neg : "");
const cents = (p: number) => `${Math.round(p * 100)}¢`;
const chance = (p: number) => `${Math.round(p * 100)}%`;
const pctChange = (x: number) => `${x > 0 ? "+" : x < 0 ? "-" : ""}${Math.abs(x * 100).toFixed(1)}%`;
const shortDay = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const t = (iso: string) => Date.parse(`${iso.slice(0, 10)}T16:00:00Z`);
const tidy = (x: string) => x.replace(/\s+/g, " ").trim();
const VENUE = { kalshi: "Kalshi", polymarket: "Polymarket" } as const;
const FAMILY: Record<SatelliteSignal["family"], { name: string; about: string }> = {
  "global-temp": { name: "Temperature", about: "Monthly and yearly global temperature records, read from ERA5 satellite reanalysis ahead of the NOAA and NASA releases that settle them." },
  "sea-ice": { name: "Sea ice", about: "The Arctic sea ice winter peak, from NSIDC's daily satellite extent." },
};

function satelliteChart(d: Satellite, height?: number, width?: number) {
  const pts = (d.curve ?? []).map((c) => ({ x: t(c.day), y: c.equity }));
  if (pts.length) pts.unshift({ x: pts[0].x - 86_400_000, y: d.bankroll });
  return (
    <LineChart
      series={[{ label: "Satellite desk", points: pts, tone: "auto" }]}
      baseline={d.bankroll}
      format={(y) => usd(y)}
      height={height}
      width={width}
      empty="The line starts after the first day of bets."
      ariaLabel="Satellite desk paper bankroll by day"
    />
  );
}

export function SatelliteHero({ d }: { d: Satellite }) {
  const pnl = d.equity - d.bankroll;
  const open = (d.bets ?? []).filter((b) => b.status === "open").length;
  return (
    <DeskHero
      eyebrow="Satellite desk · temperature and sea ice markets · paper"
      title={<>{"Satellite desk: "}<span className={pnl >= 0 ? s.up : s.down}>{usd(pnl, true)}</span></>}
      sub={`${d.wins}-${d.settled - d.wins} settled, ${open} open. Most of these markets settle weeks or months out, so the record fills in slowly.`}
    />
  );
}

/* What it sees: one table per family. A market's long title shows once, above its first row. */

function SignalTable({ rows }: { rows: SatelliteSignal[] }) {
  // Sea ice titles differ only in the threshold, so compare with the numbers taken out.
  const key = (x: SatelliteSignal) => tidy(x.title).replace(/[\d.]+/g, "#");
  return (
    <div className={m.scroll}><table className={s.table}>
      <thead>
        <tr><th>Market</th><th>Model</th><th>Price (yes)</th><th>Best edge</th><th>Action</th></tr>
      </thead>
      <tbody>
        {rows.map((r, i) => {
          const head = i === 0 || key(rows[i - 1]) !== key(r);
          const bid = r.yesBid != null ? cents(r.yesBid) : "·";
          const ask = r.yesAsk != null ? cents(r.yesAsk) : "·";
          return (
            <tr key={r.id}>
              <td>
                {head && <span className={m.satTitle}>{`${tidy(r.title)} (${VENUE[r.venue]})`}</span>}
                <a className={m.satLink} href={r.url} target="_blank" rel="noreferrer">{r.label}</a>
              </td>
              <td className={s.num}>{chance(r.p)}</td>
              <td className={`${s.num} ${s.muted}`}>{`${bid} to ${ask}`}</td>
              <td className={`${s.num} ${r.best ? tone(r.best.edge) : s.muted}`}>
                {r.best ? `${r.best.side === "yes" ? "Yes" : "No"} at ${cents(r.best.ask)}, ${r.best.edge >= 0 ? "+" : "-"}${Math.abs(r.best.edge * 100).toFixed(1)}¢` : "·"}
              </td>
              <td title={r.why}>
                {r.action === "bet" ? <span className={`${m.tag} ${m.tagOpen}`}>Bet</span>
                  : r.action === "already holding" ? <span className={m.tag}>Holding</span>
                  : <span className={s.muted}>{r.action}</span>}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table></div>
  );
}

function Signals({ d }: { d: Satellite }) {
  const sig = d.signals ?? [];
  const families = (["global-temp", "sea-ice"] as const).filter((f) => sig.some((x) => x.family === f));
  const bets = sig.filter((x) => x.action === "bet").length;
  return (
    <details className={`${m.panel} ${m.fold}`} open>
      <summary className={m.foldHead}>
        <h2 className={m.panelTitle}>What it sees</h2>
        <span className={m.foldMeta}>{`${sig.length} markets, ${bets} worth a bet`}</span>
      </summary>
      <p className={m.sub}>
        {`Model is the desk's chance the market settles yes. Price is what yes sells for now (bid to ask). Best edge is the cheaper side to buy and how far the desk's chance beats its price. It bets at ${cents(d.rules.minEdge)} or more.`}
        {d.notes?.length ? ` Data: ${d.notes.join(", ")}.` : ""}
      </p>
      {families.length ? families.map((f) => (
        <div key={f} className={m.satGroup}>
          <h3 className={m.subHead}>{FAMILY[f].name}</h3>
          <p className={m.sub}>{FAMILY[f].about}</p>
          <SignalTable rows={sig.filter((x) => x.family === f)} />
        </div>
      )) : <p className={m.sub}>No markets priced on the last run.</p>}
    </details>
  );
}

/* Bets */

function BetTable({ rows }: { rows: SatelliteBet[] }) {
  return (
    <div className={m.scroll}><table className={s.table}>
      <thead>
        <tr><th>Bet</th><th>Price</th><th>Contracts</th><th>Cost</th><th>Chance</th><th>Edge</th><th>Result</th></tr>
      </thead>
      <tbody>
        {rows.map((b) => (
          <tr key={b.id}>
            <td>
              <a className={m.satLink} href={b.url} target="_blank" rel="noreferrer">{`${b.side === "yes" ? "Yes" : "No"}: ${b.label}`}</a>
              <span className={m.satWhy}>{`${tidy(b.title)} (${VENUE[b.venue]}). ${b.why}`}</span>
            </td>
            <td className={s.num}>{cents(b.price)}</td>
            <td className={s.num}>{b.contracts.toLocaleString("en-US")}</td>
            <td className={s.num}>{usd(b.cost + b.fee)}</td>
            <td className={s.num}>{chance(b.p)}</td>
            <td className={`${s.num} ${tone(b.edge)}`}>{`${b.edge >= 0 ? "+" : "-"}${Math.abs(b.edge * 100).toFixed(1)}¢`}</td>
            <td className={s.num}>
              {b.status === "open"
                ? <span className={m.tag}>Open</span>
                : <span className={tone(b.pnl ?? 0)}>{`${b.status === "won" ? "Won" : "Lost"} ${b.pnl !== undefined ? usd(b.pnl, true) : ""}`.trim()}</span>}
            </td>
          </tr>
        ))}
      </tbody>
    </table></div>
  );
}

function Bets({ d }: { d: Satellite }) {
  const all = d.bets ?? [];
  const open = all.filter((b) => b.status === "open");
  const done = all.filter((b) => b.status !== "open");
  return (
    <>
      <details className={`${m.panel} ${m.fold}`} open>
        <summary className={m.foldHead}>
          <h2 className={m.panelTitle}>Open bets</h2>
          <span className={m.foldMeta}>{`${open.length}, ${usd(d.openCost)} staked`}</span>
        </summary>
        {open.length ? (
          <>
            <p className={m.sub}>Cost includes the exchange fee. Chance is the desk&apos;s chance this side wins; edge is that chance minus the price paid.</p>
            <BetTable rows={open} />
          </>
        ) : <p className={m.sub}>Nothing open. It bets when a market clears the edge bar.</p>}
      </details>
      {done.length > 0 && (
        <details className={`${m.panel} ${m.fold}`}>
          <summary className={m.foldHead}>
            <h2 className={m.panelTitle}>Settled</h2>
            <span className={m.foldMeta}>{`${d.wins}-${d.settled - d.wins}, ${usd(d.realizedPnl, true)}`}</span>
          </summary>
          <BetTable rows={done} />
        </details>
      )}
    </>
  );
}

/* Site watch: Sentinel-2 photos of construction sites, compared to the first clear photo. */

function SiteCard({ x }: { x: SatelliteSite }) {
  const changing = x.verdict ? /^chang/i.test(x.verdict) : false;
  return (
    <article className={m.satSite}>
      <div className={m.cardHead}>
        <h3 className={m.satSiteName}>{x.name}</h3>
        {x.ticker && <span className={m.tag}>{x.ticker}</span>}
      </div>
      {x.located ? (
        <>
          {x.verdict && <p className={m.satVerdict}><span className={`${m.tag} ${changing ? m.tagLive : ""}`}>{changing ? "Changing" : "Watching"}</span>{x.verdict.replace(/^[^:]*:\s*/, "").replace(/\d{4}-\d{2}-\d{2}/g, shortDay)}</p>}
          <div className={m.satPhotos}>
            {(
              [
                ["Before", x.photoBaseline, x.baseline],
                ["Latest", x.photoLatest, x.latest],
              ] as const
            ).map(([k, src, day]) => (
              <figure key={k} className={m.satPhoto}>
                {src
                  ? // External Sentinel-2 PNGs (planetarycomputer.microsoft.com), not set up for next/image.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={src} alt={`Satellite photo of ${x.name}${day ? ` on ${shortDay(day)}` : ""}`} loading="lazy" width={800} height={800} />
                  : <span className={m.satNoPhoto}>No clear photo yet</span>}
                <figcaption>{`${k}${day ? `, ${shortDay(day)}` : ""}`}</figcaption>
              </figure>
            ))}
          </div>
          <dl className={m.facts}>
            {x.ndviChange != null && (
              <>
                <dt>Change</dt>
                <dd>
                  {"Greenness "}<b className={`${s.num} ${tone(x.ndviChange)}`}>{pctChange(x.ndviChange)}</b>
                  {x.brightChange != null && <>{`, brightness `}<b className={`${s.num} ${tone(x.brightChange)}`}>{pctChange(x.brightChange)}</b></>}
                  {x.vsDay ? ` since ${shortDay(x.vsDay)}` : ""}
                </dd>
              </>
            )}
            <dt>Promise</dt>
            <dd>{x.promise}</dd>
            <dt>Watch for</dt>
            <dd>{x.watch_for}</dd>
          </dl>
        </>
      ) : (
        <>
          <p className={m.note}>{x.note ?? "Not located yet."}</p>
          <dl className={m.facts}>
            <dt>Promise</dt>
            <dd>{x.promise}</dd>
          </dl>
        </>
      )}
    </article>
  );
}

function Sites({ d }: { d: Satellite }) {
  const sites = d.sites ?? [];
  if (!sites.length) return null;
  return (
    <details className={`${m.panel} ${m.fold}`} open>
      <summary className={m.foldHead}>
        <h2 className={m.panelTitle}>Site watch</h2>
        <span className={m.foldMeta}>{`${sites.length} ${sites.length === 1 ? "site" : "sites"}, ${sites.filter((x) => x.located).length} located`}</span>
      </summary>
      <p className={m.sub}>
        Free Sentinel-2 satellite photos of sites where a company has promised to build. Greenness falling and brightness rising usually means cleared ground, pads or roofs going in. No bets ride on these; they check the company&apos;s timeline against the ground.
      </p>
      <div className={m.satSites}>{sites.map((x) => <SiteCard key={x.id} x={x} />)}</div>
    </details>
  );
}

/* How it is graded: the backtest's predicted chance against what happened, by range. */

function Grading({ d }: { d: Satellite }) {
  const c = d.calibration;
  const cols = [
    { name: "Temperature", t: c?.temp },
    { name: "Sea ice (trend)", t: c?.ice?.regression },
    { name: "Sea ice (past years)", t: c?.ice?.analog },
  ].filter((x): x is { name: string; t: { cases: number; brier: number; calibration: SatelliteCalRow[] } } => !!x.t?.calibration?.length);
  const ranges = [...new Set(cols.flatMap((x) => x.t.calibration.map((r) => r.range)))];
  const r = d.rules;
  return (
    <details className={`${m.panel} ${m.fold}`}>
      <summary className={m.foldHead}>
        <h2 className={m.panelTitle}>How it is graded</h2>
        <span className={m.foldMeta}>{c?.ran ? `backtest ${shortDay(c.ran)}` : "no backtest yet"}</span>
      </summary>
      <p className={m.sub}>
        {`It bets only when its chance beats the price by ${cents(r.minEdge)} or more, sizes each bet at ${r.kelly === 0.25 ? "a quarter" : `${Math.round(r.kelly * 100)}%`} of the full Kelly stake (a cautious size for the edge), puts at most ${whole(r.maxPerMarket)} on one market and ${whole(r.maxPerEvent)} on one event, and never has more than ${Math.round(r.maxOpenShare * 100)}% of the bankroll in open bets.`}
      </p>
      {cols.length > 0 && (
        <>
          <p className={m.sub}>
            Past seasons replayed: when the model said a chance in each range, how often it actually happened. Close numbers mean its odds can be trusted. Each cell reads model / actual.
          </p>
          <div className={m.scroll}><table className={s.table}>
            <thead>
              <tr><th>Model said</th>{cols.map((x) => <th key={x.name}>{x.name}</th>)}</tr>
            </thead>
            <tbody>
              {ranges.map((rg) => (
                <tr key={rg}>
                  <td className={s.num}>{rg.split("-").map((v) => chance(Number(v))).join(" to ")}</td>
                  {cols.map((x) => {
                    const row = x.t.calibration.find((y) => y.range === rg);
                    return <td key={x.name} className={s.num}>{row ? `${chance(row.predicted)} / ${chance(row.actual)}` : "·"}<span className={m.satN}>{row ? ` (${row.n})` : ""}</span></td>;
                  })}
                </tr>
              ))}
              <tr>
                <td className={s.muted}>Brier, cases</td>
                {cols.map((x) => <td key={x.name} className={`${s.num} ${s.muted}`}>{`${x.t.brier.toFixed(3)}, ${x.t.cases.toLocaleString("en-US")}`}</td>)}
              </tr>
            </tbody>
          </table></div>
          <p className={s.thin}>Brier score: lower is better; 0.25 is a coin flip. The number in brackets is how many past cases fell in that range.</p>
        </>
      )}
    </details>
  );
}

function Ideas({ d }: { d: Satellite }) {
  const ideas = d.ideas ?? [];
  if (!ideas.length) return null;
  return (
    <details className={`${m.panel} ${m.fold}`}>
      <summary className={m.foldHead}>
        <h2 className={m.panelTitle}>Ideas</h2>
        <span className={m.foldMeta}>{`${ideas.length} on the list`}</span>
      </summary>
      <ul className={m.grades}>
        {ideas.map((x) => (
          <li key={x.name} className={m.grade}>
            <span className={s.play}><span className={`${m.tag} ${m.tagIdea}`}>{x.status}</span>{x.name}</span>
            <span className={`${s.num} ${s.muted}`}>{x.cadence}</span>
            <span className={m.why}>{x.why}{x.data ? ` Data: ${x.data}.` : ""}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

export function SatelliteTab({ d }: { d: Satellite }) {
  const pnl = d.equity - d.bankroll;
  const open = (d.bets ?? []).filter((b) => b.status === "open").length;
  return (
    <section className={s.section}>
      <Stats
        label="Satellite desk at a glance"
        items={[
          { k: "Bankroll", v: usd(d.equity), sub: `${usd(pnl, true)} from ${usd(d.bankroll)}`, tone: pnl > 0 ? "up" : pnl < 0 ? "down" : undefined },
          { k: "Record", v: `${d.wins}-${d.settled - d.wins}`, sub: d.settled ? `${usd(d.realizedPnl, true)} settled` : "nothing settled yet" },
          { k: "Open", v: usd(d.openCost), sub: `${open} ${open === 1 ? "bet" : "bets"}, ${usd(d.cash)} cash` },
          { k: "Fees paid", v: usd(d.fees), sub: "exchange fees, in the cost above" },
        ]}
      />
      <div className={m.panel}>
        <h2 className={m.panelTitle}>Bankroll</h2>
        {satelliteChart(d, 220, 640)}
      </div>
      <Signals d={d} />
      <Bets d={d} />
      <Sites d={d} />
      <Grading d={d} />
      <Ideas d={d} />
    </section>
  );
}
