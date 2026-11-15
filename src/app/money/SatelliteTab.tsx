import type { Satellite, SatelliteBet, SatelliteCalRow, SatelliteEvent, SatelliteLogLine, SatelliteSignal, SatelliteSite, Weather } from "@/lib/money/types";
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

/** Weather's headline (2026-11-14): the satellite desk and the daily-high desk as one number, each shown apart below it. */
export function WeatherTotalHero({ d, w }: { d: Satellite; w: Weather | null | undefined }) {
  const sat = d.equity - d.bankroll;
  const daily = w ? w.equity - w.start : 0;
  const total = sat + daily;
  const openValue = d.openValue ?? d.openCost;
  return (
    <>
      <DeskHero
        eyebrow="Weather · two paper books · satellite markets and daily highs"
        title={<>{"Weather: "}<span className={total >= 0 ? s.up : s.down}>{usd(total, true)}</span></>}
        sub={`Satellite desk ${usd(sat, true)}, daily highs ${w ? usd(daily, true) : "not posted"}. Open satellite bets count at what they cost until they settle or the desk sells them, so the satellite number moves with results and fees, not with daily price wiggles.`}
      />
      <Stats
        label="Weather at a glance"
        items={[
          { k: "Satellite desk", v: usd(sat, true), sub: d.settled ? `${d.wins}-${d.settled - d.wins} settled, ${usd(d.realizedPnl, true)}` : "nothing settled yet", tone: sat > 0 ? "up" : sat < 0 ? "down" : undefined },
          { k: "Open satellite bets", v: usd(d.openCost), sub: `at cost; ${usd(openValue)} if sold right now. ${usd(d.fees)} fees paid` },
          ...(w ? [{ k: "Daily highs", v: usd(daily, true), sub: `${w.record.won}-${w.record.settled - w.record.won} settled`, tone: (daily > 0 ? "up" : daily < 0 ? "down" : undefined) as "up" | "down" | undefined }] : []),
        ]}
      />
    </>
  );
}

/** Kept for the one-day-old Satellite tab tests; Weather uses WeatherTotalHero. */
export function SatelliteHero({ d }: { d: Satellite }) {
  const pnl = d.equity - d.bankroll;
  const open = (d.bets ?? []).filter((b) => b.status === "open").length;
  return (
    <DeskHero
      eyebrow="Weather · satellite desk · global temperature and sea ice · paper"
      title={<>{"Weather, satellite desk: "}<span className={pnl >= 0 ? s.up : s.down}>{usd(pnl, true)}</span></>}
      sub={`${d.wins}-${d.settled - d.wins} settled, ${open} open. Most of these markets settle weeks or months out, so the record fills in slowly.`}
    />
  );
}

/* Markets: one short line per question; click for the reasoning, the satellite evidence and every level. */

const xOf = (k: string, monthly?: boolean) => Date.parse(monthly ? `${k}-15T12:00:00Z` : `${k}T12:00:00Z`);

function EvidenceChart({ e }: { e: SatelliteEvent }) {
  if (!e.series?.length || !e.series[0].points.length) return null;
  const ice = e.family === "sea-ice";
  const line = e.lines?.[0];
  return (
    <figure className={m.satFigure}>
      <LineChart
        series={e.series.map((x, i) => ({ label: x.label, points: x.points.map(([k, v]) => ({ x: xOf(k, x.monthly), y: v })), tone: i === 0 ? (line ? "auto" : "pos") : "mute" }))}
        baseline={line?.value}
        format={(y) => (ice ? `${y.toFixed(1)}M` : `${y >= 0 ? "+" : ""}${y.toFixed(2)}`)}
        height={180}
        width={560}
        ariaLabel={e.series[0].label}
      />
      <figcaption>
        {ice
          ? `Arctic sea ice extent since Sep 1, million km2: this year (solid) against the last three years (dashed).`
          : `${e.series[0].label}${line ? `. Dotted line: ${line.label.charAt(0).toLowerCase()}${line.label.slice(1)}` : ""}.`}
      </figcaption>
    </figure>
  );
}

function worthNow(b: SatelliteBet, sig: SatelliteSignal | undefined) {
  if (!sig) return null;
  const bid = b.side === "yes" ? sig.yesBid : sig.yesAsk != null ? 1 - sig.yesAsk : null;
  return bid != null ? b.contracts * bid : null;
}

function Story({ e }: { e: SatelliteEvent }) {
  const st = e.story!;
  return (
    <div className={m.satStory}>
      <p className={m.satEyebrow}>What the satellites show</p>
      {st.lead.map((l) => <p key={l} className={m.satLead}>{l}</p>)}
      {st.picture && (
        <figure className={m.satPic}>
          {/* External NOAA / NSIDC satellite maps, not set up for next/image. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <a href={st.picture.url} target="_blank" rel="noreferrer"><img src={st.picture.url} alt={st.picture.caption} loading="lazy" /></a>
          <figcaption>{st.picture.caption}</figcaption>
        </figure>
      )}
      {st.bets.length > 0 && (
        <>
          <p className={m.satEyebrow}>Why we bet</p>
          <div className={m.satBets}>
            {st.bets.map((b) => (
              <div key={b.bet} className={`${m.satBet} ${b.now?.includes("against us") ? m.satBetBad : ""}`}>
                <span className={m.satBetHead}>{b.head}</span>
                <span className={m.satBetWhy}>{b.why}</span>
                {b.now && <span className={m.satBetNow}>{b.now}</span>}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function MarketCard({ e, d }: { e: SatelliteEvent; d: Satellite }) {
  const sigs = (d.signals ?? []).filter((x) => e.levels.includes(x.id));
  const bets = (d.bets ?? []).filter((b) => e.bets.includes(b.id));
  const open = bets.filter((b) => b.status === "open");
  const status = open.length ? `${open.length} ${open.length === 1 ? "bet" : "bets"}` : bets.length ? "settled" : "watching";
  return (
    <details className={`${m.panel} ${m.fold}`}>
      <summary className={m.foldHead}>
        <span className={m.satCardHead}>
          <span className={m.panelTitle}>{e.question ?? tidy(e.title)}</span>
          <span className={m.satRead}><span className={`${m.tag} ${open.length ? m.tagOpen : ""}`}>{status}</span>{e.read}</span>
        </span>
      </summary>
      {e.story && <Story e={e} />}
      <details className={m.satLevels} open={!e.story}>
        <summary>The numbers behind it</summary>
      <ul className={m.satFacts}>{e.facts.map((f) => <li key={f}>{f}</li>)}</ul>
      <EvidenceChart e={e} />
      {e.images?.length > 0 && (
        <div className={m.satPhotos}>
          {e.images.map((im) => (
            <figure key={im.url} className={`${m.satPhoto} ${m.satMap}`}>
              {/* External NSIDC satellite maps, not set up for next/image. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={im.url} alt={im.caption} loading="lazy" width={420} height={500} />
              <figcaption>{im.caption}</figcaption>
            </figure>
          ))}
        </div>
      )}
      </details>
      {open.length > 0 && (
        <div className={m.scroll}><table className={s.table}>
          <thead><tr><th>Our bet</th><th>Cost</th><th>Worth now</th><th>Our chance</th></tr></thead>
          <tbody>
            {bets.map((b) => {
              const now = worthNow(b, sigs.find((x) => x.ticker === b.ticker));
              return (
                <tr key={b.id}>
                  <td><a className={m.satLink} href={b.url} target="_blank" rel="noreferrer">{`${b.side === "yes" ? "Yes" : "No"} on ${b.label}`}</a><span className={m.satWhy}>{`${b.contracts.toLocaleString("en-US")} at ${cents(b.price)}`}</span></td>
                  <td className={s.num}>{usd(b.cost + b.fee)}</td>
                  <td className={s.num}>{b.status === "open" ? (now != null ? usd(now) : "·") : <span className={tone(b.pnl ?? 0)}>{`${b.status === "won" ? "Won" : "Lost"} ${usd(b.pnl ?? 0, true)}`}</span>}</td>
                  <td className={s.num}>{chance(b.p)}</td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
      )}
      <details className={m.satLevels}>
        <summary>{`All ${sigs.length} ${sigs.length === 1 ? "price" : "prices"} we check (${VENUE[e.venue]})`}</summary>
        <div className={m.scroll}><table className={s.table}>
          <thead><tr><th>Market</th><th>Our chance (yes)</th><th>Price (yes)</th><th>Best edge</th></tr></thead>
          <tbody>
            {sigs.map((r) => (
              <tr key={r.id}>
                <td><a className={m.satLink} href={r.url} target="_blank" rel="noreferrer">{r.label}</a></td>
                <td className={s.num}>{chance(r.p)}</td>
                <td className={`${s.num} ${s.muted}`}>{`${r.yesBid != null ? cents(r.yesBid) : "·"} to ${r.yesAsk != null ? cents(r.yesAsk) : "·"}`}</td>
                <td className={`${s.num} ${r.best ? tone(r.best.edge) : s.muted}`}>{r.best ? `${r.best.side === "yes" ? "Yes" : "No"} ${r.best.edge >= 0 ? "+" : "-"}${Math.abs(r.best.edge * 100).toFixed(1)}¢` : "·"}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
        <p className={s.thin}>{`Best edge: the cheaper side to buy and how far our chance beats its price after fees. It bets at ${cents(d.rules.minEdge)} or more.`}</p>
      </details>
    </details>
  );
}

function Markets({ d }: { d: Satellite }) {
  const ev = d.events ?? [];
  if (!ev.length) return <p className={m.sub}>No markets priced on the last run.</p>;
  return (
    <div className={m.satMarkets}>
      <div className={m.venueHead}>
        <h2 className={s.h2}>Satellite markets</h2>
        <span className={m.foldMeta}>{`${ev.length} questions, settled by satellite-measured numbers. Tap one for the reasoning.`}</span>
      </div>
      {ev.map((e) => <MarketCard key={e.event} e={e} d={d} />)}
    </div>
  );
}

function Settled({ d }: { d: Satellite }) {
  const done = (d.bets ?? []).filter((b) => b.status !== "open");
  if (!done.length) return null;
  return (
    <details className={`${m.panel} ${m.fold}`}>
      <summary className={m.foldHead}>
        <h2 className={m.panelTitle}>Settled satellite bets</h2>
        <span className={m.foldMeta}>{`${d.wins}-${d.settled - d.wins}, ${usd(d.realizedPnl, true)}`}</span>
      </summary>
      <ul className={m.satFacts}>
        {done.map((b) => <li key={b.id}><span className={tone(b.pnl ?? 0)}>{`${b.status === "won" ? "Won" : "Lost"} ${usd(b.pnl ?? 0, true)}`}</span>{`: ${b.side === "yes" ? "Yes" : "No"} on ${b.label} (${tidy(b.title)})`}</li>)}
      </ul>
    </details>
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

/* What it's learning (satdesk/learner.py): the weekly review, each market type's grade, and the desk's own log. */

const LOG_KIND: { [k in SatelliteLogLine["kind"]]: [string, string] } = {
  bet: ["Bet", s.kNew], close: ["Closed", ""], settle: ["Settled", ""], rule: ["Rule", s.kLive], market: ["New market", s.kNew],
  site: ["Site", s.kNew], lesson: ["Lesson", s.kLive], check: ["Check", ""], reset: ["Reset", s.kBack],
};
const whenShort = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });

function Learning({ d }: { d: Satellite }) {
  const L = d.learner;
  if (!L) return null;
  const fams = Object.entries(L.grades?.families ?? {});
  const graded = L.grades?.settledMarkets ?? 0;
  return (
    <details className={`${m.panel} ${m.fold}`} open>
      <summary className={m.foldHead}>
        <h2 className={m.panelTitle}>What it&apos;s learning</h2>
        <span className={m.foldMeta}>{`${graded} ${graded === 1 ? "market" : "markets"} graded, ${L.log.length} log entries`}</span>
      </summary>
      <p className={m.sub}>
        Every market it prices is logged once a day, bet or not. When a market settles, the learner scores its chance against the market&apos;s and what a bet at its bar would have made. Inside fixed limits it raises the bar on a type that loses, pauses one whose chances trail the market&apos;s, and lowers the bar on one that keeps winning. A weekly review writes lessons and proposals, and researches new sites to watch. It never changes its own code.
      </p>
      {L.retro && (
        <div className={m.satRetro}>
          <h3 className={m.subHead}>{`Latest review: ${L.retro.headline || L.retro.file}`}</h3>
          {L.retro.lessons.length > 0 && <ul className={m.satFacts}>{L.retro.lessons.map((x) => <li key={x}>{x}</li>)}</ul>}
          {L.retro.proposals.length > 0 && (
            <>
              <p className={m.sub}><b>Proposals for you to approve</b></p>
              <ul className={m.satFacts}>{L.retro.proposals.map((x) => <li key={x}>{x}</li>)}</ul>
            </>
          )}
        </div>
      )}
      {fams.length > 0 && (
        <div className={m.scroll}><table className={s.table}>
          <thead><tr><th>Market type</th><th>Settled</th><th>Our score / market</th><th>Shadow bets</th><th>Bar</th></tr></thead>
          <tbody>
            {fams.map(([k, x]) => (
              <tr key={k}>
                <td>{x.label}{!x.active && <span className={`${m.tag} ${m.tagIdea}`}>paused</span>}</td>
                <td className={s.num}>{x.markets}</td>
                <td className={s.num}>{x.brierDesk != null && x.brierMarket != null ? <span className={x.brierDesk < x.brierMarket ? s.pos : s.neg}>{`${x.brierDesk.toFixed(3)} / ${x.brierMarket.toFixed(3)}`}</span> : "·"}</td>
                <td className={s.num}>{x.shadowBets ? `${x.shadowWins}-${x.shadowBets - x.shadowWins}, ${x.shadowRoi != null ? `${x.shadowRoi >= 0 ? "+" : ""}${(x.shadowRoi * 100).toFixed(1)}¢ each` : ""}` : "·"}</td>
                <td className={s.num}>{cents(x.minEdge)}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
      {graded === 0 && <p className={s.thin}>Nothing has settled yet. The first temperature markets settle when NOAA and NASA publish November, around Dec 8 to 14; the sea ice peak settles after Apr 1.</p>}
      {L.candidates.length > 0 && (
        <details className={m.satLevels}>
          <summary>{`${L.candidates.length} markets found that it could learn to price`}</summary>
          <ul className={m.satFacts}>{L.candidates.map((c) => <li key={c.id}>{`${c.title} (${c.venue === "kalshi" ? "Kalshi" : "Polymarket"}): settles on ${c.source.replace(/\s+/g, " ")}`}</li>)}</ul>
        </details>
      )}
      <ol className={s.log}>
        {L.log.filter((x) => x.kind !== "check").slice(0, 15).map((e, i) => (
          <li key={`${e.ts}|${i}`} className={s.logRow}>
            <span className={s.logWhen}>{whenShort(e.ts)}</span>
            <span className={`${s.logKind} ${LOG_KIND[e.kind]?.[1] ?? ""}`}>{LOG_KIND[e.kind]?.[0] ?? e.kind}</span>
            <span className={s.logText}><b>{e.title}</b>{e.detail ? <span>{e.detail}</span> : null}</span>
          </li>
        ))}
      </ol>
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
  return (
    <section className={s.section}>
      <Markets d={d} />
      <Learning d={d} />
      <Settled d={d} />
      <Sites d={d} />
      <details className={`${m.panel} ${m.fold}`}>
        <summary className={m.foldHead}>
          <h2 className={m.panelTitle}>Satellite bankroll</h2>
          <span className={m.foldMeta}>{`${usd(d.equity)} of ${usd(d.bankroll)}`}</span>
        </summary>
        {satelliteChart(d, 220, 640)}
      </details>
      <Grading d={d} />
      <Ideas d={d} />
    </section>
  );
}
