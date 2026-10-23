import Link from "next/link";
import { etDay, getNbaBoard, NBA_SOURCES, type NbaBoard, type NbaBoardGame } from "@/lib/picks/nba-store";
import { getNbaPicksView, type NbaPicksView } from "@/lib/picks/nba-track-store";
import { nbaBets, NBA_GO_LIVE, NBA_LIMITS, tierOf, type NbaBet, type NbaCutRecord, type NbaTracked } from "@/lib/picks/nba-track";
import { readNba } from "@/lib/picks/nba";
import { CRITERIA } from "@/lib/picks/learning/model";
import { MIN_SAMPLE } from "@/lib/picks/engine";
import { href, kickoffEt, line, price, rec, units, LOG_VIEW, NBA_VIEWS, whenEt, type View } from "../ui";
import { Background, GoLiveSteps, Hero, LearnerLog, MarketKey, MarketLine, ModelLineup, Stats, TrackingProgress, type LogEntry } from "../board";
import s from "../picks.module.css";

// The NBA tab. One model (Sam) against the DraftKings line, tracked like
// football (nba-track.ts): saved before tip, graded, sliced into cuts, a rule
// chosen the football way and a weekly learning review. Not staked until the
// go-live gate clears, then under NBA's own limits; never in football's 30u.

const dayLabel = (day: string, today: string) => {
  const d = new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(4, 6)) - 1, Number(day.slice(6, 8)), 16));
  const label = d.toLocaleDateString("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric" });
  return day === today ? `Today · ${label}` : label;
};

/** Sam's board state in one sentence, for the headline. */
function samLine(b: NbaBoard): string {
  const sam = b.sam;
  if (sam.state === "live") return "Sam's side at the DraftKings number. Every read is saved before tip and graded; nothing is staked until the go-live gate clears.";
  if (sam.state === "soon") return `Sam's NBA model isn't out yet (his page says: "${sam.note}"). DraftKings lines below; his side fills in when it posts.`;
  if (sam.state === "unread") return "Sam's NBA page is up but laid out differently, so it can't be read yet (src/lib/picks/nba.ts needs updating).";
  return `Couldn't reach Sam's NBA page (${sam.error}). DraftKings lines only.`;
}

/** Sam's spread bet on a board game, in the tracker's terms (for the rule's tiers). */
function boardBet(g: NbaBoardGame): NbaBet | null {
  if (!g.read) return null;
  const snap = { at: "", line: g.line?.home, homePrice: g.line?.homePrice, awayPrice: g.line?.awayPrice, model: g.read.model, samLine: g.read.samLine };
  return nbaBets({ id: g.id, day: g.day, week: 0, tip: g.tip, home: g.home.abbr, away: g.away.abbr, first: snap, last: snap }).find((b) => b.market === "ats") ?? null;
}

/**
 * Once a game tips, Sam drops it from his page and ESPN drops the odds, so a
 * live or final card shows the copy saved before tip: the numbers it is graded on.
 */
function asSaved(g: NbaBoardGame, t: NbaTracked | undefined): NbaBoardGame {
  if (g.state === "pre" || !t) return g;
  const s = t.last;
  const out: NbaBoardGame = {
    ...g,
    line: s.line !== undefined ? { home: s.line, homePrice: s.homePrice, awayPrice: s.awayPrice } : g.line,
    total: s.total !== undefined ? { points: s.total, overPrice: s.overPrice, underPrice: s.underPrice } : g.total,
    ml: s.mlHome !== undefined || s.mlAway !== undefined ? { home: s.mlHome, away: s.mlAway } : g.ml,
  };
  return { ...out, read: readNba(out, { home: g.home.abbr, away: g.away.abbr, model: s.model, vegas: s.samLine ?? NaN, ...(s.modelTotal !== undefined ? { total: s.modelTotal } : {}) }) };
}

/** Sam's spread and total results on a finished game, from the saved copy. */
function samResults(g: NbaBoardGame, t: NbaTracked | undefined): string | null {
  if (g.state !== "post" || !g.score || !t) return null;
  const bets = nbaBets({ ...t, final: t.final ?? g.score });
  const word = (m: "ats" | "ou", label: string) => {
    const b = bets.find((x) => x.market === m);
    return b?.result ? `${label} ${b.result === "W" ? "won" : b.result === "L" ? "lost" : "push"}` : null;
  };
  return [word("ats", "Spread"), word("ou", "Total")].filter(Boolean).join(" · ") || null;
}

/** Everything behind one game: spread, total, moneyline, Sam's numbers and results. */
function NbaWhy({ g, done }: { g: NbaBoardGame; done: string | null }) {
  const r = g.read;
  return (
    <dl className={s.kv}>
      <dt>Spread</dt>
      <dd className={s.num}>{g.line ? `${g.home.short} ${line(g.line.home)} (${price(g.line.homePrice)} / ${price(g.line.awayPrice)})` : "not posted"}</dd>
      <dt>Total</dt>
      <dd className={s.num}>{g.total ? `${g.total.points} (o ${price(g.total.overPrice)} / u ${price(g.total.underPrice)})` : "not posted"}</dd>
      <dt>Moneyline</dt>
      <dd className={s.num}>{g.ml ? `${g.away.abbr} ${price(g.ml.away)} · ${g.home.abbr} ${price(g.ml.home)}` : "not posted"}</dd>
      {done && (
        <>
          <dt>Sam</dt>
          <dd className={s.num}>{done}</dd>
        </>
      )}
      {r && (
        <>
          <dt>Sam line</dt>
          <dd className={s.num}>{`${g.home.short} ${line(r.model)}${r.samLine !== undefined ? ` vs his posted ${line(r.samLine)}` : ""}`}</dd>
          {r.modelTotal !== undefined && (
            <>
              <dt>Sam total</dt>
              <dd className={s.num}>{`${r.modelTotal} (${r.totalSide} by ${r.totalEdge?.toFixed(1)})`}</dd>
            </>
          )}
        </>
      )}
    </dl>
  );
}

/** One game's read: the saved copy once tipped, Sam's side, the rule's tier and any stake. */
export function readGame(raw: NbaBoardGame, v: NbaPicksView | null) {
  const saved = v?.games.find((x) => x.id === raw.id);
  const g = asSaved(raw, saved);
  const done = samResults(g, saved);
  const r = g.read;
  const bet = boardBet(g);
  const tier = bet && v && g.state === "pre" ? tierOf(bet, v.ats) : null;
  const stake = tier && v?.gate.live ? (saved?.stake ?? null) : null;
  const pickTeam = r ? (r.side === "home" ? g.home : g.away) : null;
  const pickLine = r && g.line ? (r.side === "home" ? g.line.home : -g.line.home) : null;
  const pickPrice = r && g.line ? (r.side === "home" ? g.line.homePrice : g.line.awayPrice) : undefined;
  const pick = pickTeam && pickLine !== null ? `${pickTeam.short} ${line(pickLine)}` : `${g.away.short} at ${g.home.short}`;
  return { g, done, r, tier, stake, pick, pickPrice };
}

function NbaBetCard({ x }: { x: ReturnType<typeof readGame> }) {
  const { g, r, tier, stake, pick, pickPrice } = x;
  return (
    <li className={s.betCard}>
      <div className={s.betCardTop}>
        <div>
          <div className={s.betPickBig}>{pick}</div>
          <div className={s.betWhen}>{`${g.away.short} at ${g.home.short} · ${kickoffEt(g.tip)}`}</div>
        </div>
        <span className={s.lockChip}>{stake ? `Tier ${tier} bet` : `Tier ${tier} · tracking`}</span>
      </div>
      {r && g.line && <MarketLine market={g.line.home} sam={r.model} fmt={(n) => `${g.home.short} ${line(Math.round(n * 10) / 10)}`} pk={{ below: g.home.short, above: g.away.short }} />}
      <dl className={s.facts}>
        <div>
          <dt>Sam vs market</dt>
          <dd>{r ? `${r.edge.toFixed(1)} pts` : "·"}</dd>
        </div>
        <div>
          <dt>Price</dt>
          <dd>{`${price(pickPrice)} DK`}</dd>
        </div>
        <div>
          <dt>Stake</dt>
          <dd>{stake ? `${stake}u` : "none yet"}</dd>
        </div>
      </dl>
      <details className={s.why}>
        <summary>Every number</summary>
        <NbaWhy g={g} done={x.done} />
      </details>
    </li>
  );
}

function NbaRow({ x, day }: { x: ReturnType<typeof readGame>; day: string }) {
  const { g, r, tier, done, stake } = x;
  const read: [string, string] = g.score && g.state !== "post"
    ? ["Live", s.readLive]
    : g.score
    ? done
      ? [done.split(" · ")[0].replace("Spread ", ""), /won/.test(done.split(" · ")[0]) ? s.readW : /lost/.test(done.split(" · ")[0]) ? s.readL : ""]
      : ["Final", s.readPass]
    : tier
    ? stake
      ? [`Tier ${tier} · ${stake}u`, s.readBet]
      : [`Tier ${tier} · no stake`, s.readPend]
    : r?.crossed
    ? ["DK crossed", s.readPass]
    : r
    ? ["Sam's side · no stake", s.readTrack]
    : [g.line ? "No model yet" : "No line yet", s.readPass];
  return (
    <details className={s.gRow}>
      <summary>
        <span className={s.gGame}>
          {`${g.away.short} at ${g.home.short}`}
          <span>{g.score ? `${g.away.abbr} ${g.score.away}, ${g.home.abbr} ${g.score.home}` : `${day} ${kickoffEt(g.tip)}`}</span>
        </span>
        <span className={s.gNum} data-k="Market">{g.line ? `${g.home.short} ${line(g.line.home)}` : "·"}</span>
        <span className={`${s.gNum} ${s.cSam}`} data-k="Sam">{r ? `${g.home.short} ${line(r.model)}` : "·"}</span>
        <span className={s.gNum} data-k="Pick">{r ? x.pick : "·"}</span>
        <span className={s.gNum} data-k="Edge">{r ? r.edge.toFixed(1) : "·"}</span>
        <span className={`${s.readChip} ${read[1]}`}>{read[0]}</span>
        <span className={s.chev} aria-hidden>
          ›
        </span>
      </summary>
      <div className={s.gBody}>
        <NbaWhy g={g} done={done} />
      </div>
    </details>
  );
}

function RowsTable({ rows }: { rows: { x: ReturnType<typeof readGame>; day: string }[] }) {
  return (
    <div className={s.gtable}>
      <div className={s.gHead} aria-hidden>
        <span>Game</span>
        <span>Market</span>
        <span>Sam</span>
        <span>Side</span>
        <span>Edge</span>
        <span>Read</span>
        <span />
      </div>
      {rows.map(({ x, day }) => (
        <NbaRow key={x.g.id} x={x} day={day} />
      ))}
    </div>
  );
}

const nbaHref = (v: View) => (v === "week" ? "/picks/nba" : `/picks/nba?v=${v}`);
const pctOf = (x: number) => `${(x * 100).toFixed(1)}%`;
const cls = (u: number) => (u > 0 ? s.pos : u < 0 ? s.neg : "");

function CutTable({ title, rows, v }: { title: string; rows: NbaCutRecord[]; v: NbaPicksView }) {
  const t1 = [v.ats.tier1?.id, v.ou.tier1?.id];
  const t2 = [v.ats.tier2?.id, v.ou.tier2?.id];
  return (
    <div className={s.tw}>
      <table className={s.table}>
        <caption className={s.caption}>{title}</caption>
        <thead>
          <tr>
            <th>Cut</th>
            <th>Record</th>
            <th>Win rate</th>
            <th>90% range</th>
            <th>Units</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((x) => (
            <tr key={x.id}>
              <td>
                {x.label}
                {t1.includes(x.id) && <span className={s.pill}>tier 1</span>}
                {t2.includes(x.id) && <span className={s.pill}>tier 2</span>}
                {x.research && <span className={s.dim}>{v.activated.includes(x.id) ? " · research, activated" : x.id.startsWith("ats:mkt-") ? " · research, report only" : " · research"}</span>}
              </td>
              <td className={s.num}>{rec(x)}</td>
              <td className={s.num}>{x.w + x.l ? pctOf(x.pct) : "–"}</td>
              <td className={s.num}>{x.w + x.l ? `${pctOf(x.lo)} to ${pctOf(x.hi)}` : "–"}</td>
              <td className={`${s.num} ${cls(x.units)}`}>{units(x.units)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function NbaResults({ v }: { v: NbaPicksView }) {
  const done = v.games.filter((g) => g.final);
  if (!done.length)
    return <p className={s.calm}>Nothing graded yet. Sam&apos;s reads are saved before each tip and graded from ESPN&apos;s final overnight (2:30am ET run); opening night is October 20.</p>;
  const cut = (id: string) => v.cuts.find((c) => c.id === id)!;
  const tile = (value: string, label: string) => (
    <div className={s.tile}>
      <span className={`${s.tileV} ${s.num}`}>{value}</span>
      <span className={s.tileK}>{label}</span>
    </div>
  );
  return (
    <section className={s.section} aria-labelledby="nba-results">
      <Hero
        eyebrow={`NBA ${v.season}-${String(v.season + 1).slice(2)} · every game Sam read`}
        title={
          <span id="nba-results">
            {cut("ats:all").units >= 0 ? "Up " : "Down "}
            <span className={cut("ats:all").units >= 0 ? s.up : s.down}>{units(cut("ats:all").units)}</span>
            {` on ${rec(cut("ats:all"))} spreads`}
          </span>
        }
        sub="Graded at the DraftKings number and price saved before tip, 1 unit per bet. Not staked: this is the record the go-live gate reads."
      />
      <div className={s.tiles}>
        {tile(units(cut("ats:all").units), `Spreads, every Sam side · ${rec(cut("ats:all"))}`)}
        {tile(v.ats.tier1 ? units(v.ats.tier1.units) : "none", v.ats.tier1 ? `Spread rule tier 1 · ${v.ats.tier1.label} · ${rec(v.ats.tier1)}` : "No spread cut qualifies yet")}
        {tile(rec(cut("su:all")), `Straight up · ${units(cut("su:all").units)} at the moneyline`)}
        {tile(units(cut("ou:all").units), `Totals, every Sam side · ${rec(cut("ou:all"))}`)}
      </div>
      <div className={s.tw}>
        <table className={s.table}>
          <caption className={s.caption}>Game by game</caption>
          <thead>
            <tr>
              <th>Date</th>
              <th>Game</th>
              <th>Final</th>
              <th>Spread</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {done.map((g) => {
              const bets = nbaBets(g);
              const cell = (m: "ats" | "ou") => {
                const b = bets.find((x) => x.market === m);
                if (!b) return <td className={s.dim}>–</td>;
                const what = m === "ats" ? `${b.side === "home" ? g.home : g.away} ${line(b.line)}` : `${b.side === "over" ? "Over" : "Under"} ${b.line}`;
                return <td className={b.result === "W" ? s.resW : b.result === "L" ? s.resL : s.resP}>{`${what} · ${b.result}`}</td>;
              };
              return (
                <tr key={g.id}>
                  <td className={s.num}>{whenEt(g.tip).split(",").slice(0, 2).join(",")}</td>
                  <td>{`${g.away} at ${g.home}`}</td>
                  <td className={s.num}>{`${g.final!.away}-${g.final!.home}`}</td>
                  {cell("ats")}
                  {cell("ou")}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function NbaResearch({ v }: { v: NbaPicksView }) {
  const by = (m: string) => v.cuts.filter((c) => c.market === m);
  return (
    <section className={s.section} aria-labelledby="nba-research">
      <Hero eyebrow="NBA · every cut on Sam's reads" title={<span id="nba-research">What actually wins</span>} />
      <div className={s.sectionHead}>
        <p className={s.p}>
          {`The football rule, on NBA cuts: a cut needs ${MIN_SAMPLE}+ decided games and a win rate past 52.4%, and the one whose 90% range has the highest low end is tier 1; tier 2 is the best other cut judged only on the games it adds. Research cuts join only when the weekly review shows they beat their parent cut.`}
        </p>
      </div>

      <div className={s.tw}>
        <table className={s.table}>
          <caption className={s.caption}>{v.gate.live ? "Go-live gate: cleared. Tier bets now carry stakes under NBA's own limits." : "Go-live gate: NBA stays unstaked until all four clear"}</caption>
          <thead>
            <tr>
              <th>Check</th>
              <th>Now</th>
              <th>Needs</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {v.gate.checks.map((c) => (
              <tr key={c.label}>
                <td>{c.label}</td>
                <td className={s.num}>{c.have}</td>
                <td className={s.num}>{c.need}</td>
                <td className={c.ok ? s.pos : s.dim}>{c.ok ? "met" : "not yet"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={`${s.notice} ${s.dim}`}>
        {`Set Oct 19, before any NBA record existed. Once live, NBA has its own limits, separate from football's 30u: ${NBA_LIMITS.MIN_STAKE}u to ${NBA_LIMITS.MAX_STAKE}u a bet (under ${NBA_LIMITS.MIN_STAKE}u is not a bet), ${NBA_LIMITS.PER_GAME}u a game, ${NBA_LIMITS.DAILY}u a day, and ${NBA_LIMITS.WINDOW_UNITS}u across any running ${NBA_LIMITS.WINDOW_DAYS} days (a bet's units come back a week after its game, not all at once on Monday, so a strong Sunday isn't left with nothing; when a day's room is short the biggest edges go first), quarter Kelly on the tier record pulled toward 50% over ${NBA_LIMITS.SHRINK_GAMES} games. Gate: ${NBA_GO_LIVE.MIN_GAMES}+ games over ${NBA_GO_LIVE.MIN_WEEKS}+ weeks.`}
      </p>

      {v.gate.live && (
        <p className={s.notice}>
          {`Today: ${v.room.today}u of ${NBA_LIMITS.DAILY}u used, ${v.room.window + v.room.today}u of ${NBA_LIMITS.WINDOW_UNITS}u in the running ${NBA_LIMITS.WINDOW_DAYS} days, ${v.room.room}u left today.${v.room.frees ? ` The oldest stake frees up ${v.room.frees.slice(4, 6)}/${v.room.frees.slice(6)}.` : ""}`}
        </p>
      )}

      <CutTable title="Spreads: every cut" rows={by("ats")} v={v} />
      <CutTable title="Totals: every cut" rows={by("ou")} v={v} />
      <CutTable title="Straight up" rows={by("su")} v={v} />

      <div className={s.tw}>
        <table className={s.table}>
          <caption className={s.caption}>Learning review: research cuts against their parent, games first seen after each was registered</caption>
          <thead>
            <tr>
              <th>Research cut</th>
              <th>Against</th>
              <th>Games</th>
              <th>Weeks</th>
              <th>Units a game</th>
              <th>t</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {v.hyps.length ? (
              v.hyps.map((h) => (
                <tr key={h.id}>
                  <td>{h.label}</td>
                  <td>{h.parentLabel}</td>
                  <td className={s.num}>{`${h.cmp.n} / ${CRITERIA.MIN_OPPORTUNITIES}`}</td>
                  <td className={s.num}>{`${h.cmp.weeks} / ${CRITERIA.MIN_WEEKS}`}</td>
                  <td className={`${s.num} ${cls(h.cmp.mean)}`}>{h.cmp.n ? `${h.cmp.mean > 0 ? "+" : ""}${h.cmp.mean.toFixed(2)}` : "–"}</td>
                  <td className={s.num}>{h.cmp.t ?? "–"}</td>
                  <td className={h.status === "active" ? s.pos : h.status === "rolled-back" ? s.neg : s.dim}>{h.status === "active" ? "in the rule" : h.status === "rolled-back" ? "rolled back" : "collecting"}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={7} className={s.dim}>Registered on the first run.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className={`${s.notice} ${s.dim}`}>
        {`Same bar as football's review: ${CRITERIA.MIN_OPPORTUNITIES}+ games over ${CRITERIA.MIN_WEEKS}+ weeks and t ${CRITERIA.MIN_T}+ to go in, at most one per review; rolled back when it trails its parent on ${CRITERIA.ROLLBACK_MIN_OPPORTUNITIES}+ games with t at or under -${CRITERIA.MIN_T}. ${v.lastReviewAt ? `Last review ${whenEt(v.lastReviewAt)}; it runs weekly.` : "Runs weekly."}`}
      </p>
      {v.journal.length > 0 && (
        <ul className={s.journal}>
          {v.journal.slice(0, 12).map((j) => (
            <li key={`${j.at}${j.text}`}>{`${whenEt(j.at)}: ${j.text}`}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

const NBA_KIND: { [k: string]: LogEntry["kind"] } = { register: "new", activate: "live", rollback: "back", review: "test", retain: "test" };

/** NBA's learner log: the research cuts it is testing against their parents, and what each weekly review did. */
function NbaLog({ v }: { v: NbaPicksView }) {
  const entries: LogEntry[] = v.journal.map((j) => ({ at: j.at, kind: NBA_KIND[j.kind] ?? "test", title: j.text }));
  return (
    <section className={s.section} aria-labelledby="nba-log">
      <Hero
        eyebrow="NBA · what changed, and why"
        title={<span id="nba-log">Learner log</span>}
        sub="NBA learns on its own games: each research cut is tested against the broader cut it narrows, on games first seen after it registered. The review runs weekly; games are daily, so evidence grows every night."
      />
      <GoLiveSteps games={`${CRITERIA.MIN_OPPORTUNITIES}+ games over ${CRITERIA.MIN_WEEKS}+ weeks against its parent cut, at t ${CRITERIA.MIN_T}+.`} />
      <TrackingProgress
        rows={v.hyps.map((h) => ({
          id: h.id,
          label: h.label,
          status: h.status === "active" ? "live" : h.status === "rolled-back" ? "back" : "testing",
          games: h.cmp.n,
          needGames: CRITERIA.MIN_OPPORTUNITIES,
          weeks: h.cmp.weeks,
          needWeeks: CRITERIA.MIN_WEEKS,
          result: h.cmp.n ? `${h.cmp.mean >= 0 ? "+" : "−"}${Math.abs(h.cmp.mean).toFixed(2)}u a game vs ${h.parentLabel.charAt(0).toLowerCase()}${h.parentLabel.slice(1)}${h.cmp.t !== null ? `, t ${h.cmp.t.toFixed(2)} of ${CRITERIA.MIN_T}` : ""}` : undefined,
          note: h.cmp.n ? undefined : "No games yet: only games after it registered count.",
        }))}
        sub="Research cuts on Sam's NBA reads, each against the broader cut it narrows. New games land every night."
        empty="No NBA ideas registered yet. They register at the first weekly review."
      />
      <div className={s.section}>
        <div className={s.sectionHead}>
          <h3 className={s.h2}>What NBA is testing</h3>
          <p className={s.p}>{`Spreads and totals cuts on Sam's reads. ${v.lastReviewAt ? `Last review ${whenEt(v.lastReviewAt)}.` : "The first review runs this week."}`}</p>
        </div>
        {v.hyps.length ? (
          <ol className={s.log}>
            {v.hyps.map((h) => (
              <li key={h.id} className={s.logRow}>
                <span className={s.logWhen}>{`since ${whenEt(h.registeredAt).split(",").slice(0, 2).join(",")}`}</span>
                <span className={`${s.logKind} ${h.status === "active" ? s.kLive : h.status === "rolled-back" ? s.kBack : ""}`}>{h.status === "active" ? "Live" : h.status === "rolled-back" ? "Rolled back" : "Testing"}</span>
                <span className={s.logText}>
                  <b>{h.label}</b>
                  <span>{`Against ${h.parentLabel.toLowerCase()}: ${h.cmp.n} game${h.cmp.n === 1 ? "" : "s"} over ${h.cmp.weeks} week${h.cmp.weeks === 1 ? "" : "s"}, ${h.cmp.mean >= 0 ? "+" : ""}${h.cmp.mean.toFixed(2)}u a game${h.cmp.t !== null ? `, t ${h.cmp.t.toFixed(2)}` : ""}.`}</span>
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p className={s.calm}>No NBA ideas registered yet. They register at the first weekly review.</p>
        )}
      </div>
      <div className={s.section}>
        <h3 className={s.h2}>Latest</h3>
        <LearnerLog entries={entries.slice(0, 20)} empty="Nothing recorded yet. The first entries come from the first weekly review." />
      </div>
    </section>
  );
}

export default async function NbaView({ view = "week" }: { view?: View }) {
  const [b, v] = await Promise.all([view === "week" ? getNbaBoard().catch(() => null) : Promise.resolve(null), getNbaPicksView().catch(() => null)]);
  const today = etDay(new Date());
  const sportNav = (
    <nav className={s.chips} aria-label="Sport">
      <Link className={s.chip} href={href("nfl", "ats", "week")}>
        NFL
      </Link>
      <Link className={s.chip} href={href("cfb", "ats", "week")}>
        College
      </Link>
      <Link className={s.chip} href="/picks/nba" aria-current="page">
        NBA
      </Link>
    </nav>
  );
  const all = v?.cuts.find((c) => c.id === "ats:all");
  const t1 = v?.ats.tier1;
  const testing = v?.hyps.filter((h) => h.status === "collecting").length ?? 0;
  const upcoming = (b?.days ?? []).flatMap((d) => d.games.map((g) => ({ x: readGame(g, v), day: d.day === today ? "" : dayLabel(d.day, today) })));
  const todayGames = (b?.days ?? []).find((d) => d.day === today)?.games.length ?? 0;
  const best = upcoming.filter(({ x }) => x.tier && x.g.state === "pre");
  const last = (b?.yesterday?.games ?? []).map((g) => ({ x: readGame(g, v), day: "Last night" }));

  return (
    <main className={s.page}>
      <div className={s.wrap}>
        <header className={s.header}>
          <h1 className={s.eyebrow} style={{ margin: 0 }}>{`Picks · NBA ${v ? `${v.season}-${String(v.season + 1).slice(2)}` : "2026-27"}`}</h1>
          <div className={s.navRows}>{sportNav}</div>
          <nav className={`${s.tabs} ${s.tabsSoft}`} aria-label="View">
            {[...NBA_VIEWS, LOG_VIEW].map((x) => (
              <Link key={x.id} href={nbaHref(x.id)} aria-current={x.id === view ? "page" : undefined} className={s.tab}>
                {x.label}
              </Link>
            ))}
          </nav>
          {v && (
            <Stats
              label="NBA record, rule and learner"
              items={[
                { k: "Spreads, every Sam side", v: all && all.w + all.l + all.p ? units(all.units) : "0-0", sub: all ? rec(all) : "nothing graded", tone: all && all.w + all.l ? (all.units >= 0 ? "up" : "down") : undefined },
                { k: "Rule tier 1", v: t1 ? t1.label : "None yet", sub: t1 ? rec(t1) : "nothing clears the bar", small: true },
                { k: "Stakes", v: v.gate.live ? "Live" : "Tracking", sub: v.gate.live ? "NBA's own limits" : "until the go-live gate clears", small: true },
                { k: "Learner", v: `${testing} idea${testing === 1 ? "" : "s"} testing`, sub: <Link href={nbaHref("log")}>Open the log</Link>, small: true },
              ]}
            />
          )}
          {v && view === "week" && (
            <ModelLineup
              title="Who decides NBA spreads"
              aside={v.gate.live ? "The tier rule sets stakes under NBA's own limits." : "Nothing in NBA picks sets a stake yet."}
              models={[
                {
                  name: t1 ? `Tier rule: ${t1.label}` : "Tier rule",
                  role: "Decides NBA spread bets once live",
                  status: v.gate.live ? "active" : "collecting",
                  note: v.gate.live
                    ? "Tier bets carry stakes under NBA's own limits."
                    : `Every Sam side is tracked at the saved DraftKings price with no stake. Go-live gate: ${v.gate.checks.map((c) => `${c.have} of ${c.need} ${c.label.toLowerCase()}`).join("; ")}.`,
                },
                { name: "Sam's NBA reads", role: "Spreads and totals, outside source", status: "input", note: "The only NBA input. Never stakes on its own." },
                { name: "Our NBA game model", role: "Not built", status: "unavailable", note: "NBA picks use Sam only for now." },
                { name: "Pool picks", role: "Straight up", status: "unavailable", note: "No NBA pool, so NBA straight up is not tracked." },
              ]}
            />
          )}
        </header>

        {view !== "week" ? (
          !v ? (
            <div className={s.error} role="alert">
              Couldn&apos;t load the NBA record right now. Try again in a few minutes.
            </div>
          ) : view === "results" ? (
            <NbaResults v={v} />
          ) : view === "log" ? (
            <NbaLog v={v} />
          ) : (
            <NbaResearch v={v} />
          )
        ) : !b ? (
          <div className={s.error} role="alert">
            Couldn&apos;t load the NBA slate right now. Try again in a few minutes.
          </div>
        ) : !b.days.length ? (
          <p className={s.calm}>No NBA games in the next week.</p>
        ) : (
          <section className={s.section} aria-labelledby="nba-slate">
            <Hero
              eyebrow="NBA · Spreads"
              title={<span id="nba-slate">{best.length ? `${best.length} in the rule's tier today` : todayGames ? `${todayGames} games today, none in the rule's tier` : "No games today"}</span>}
              sub={samLine(b)}
            />
            {best.length > 0 && (
              <>
                <ul className={s.betGrid} data-first-pick>
                  {best.map(({ x }) => (
                    <NbaBetCard key={x.g.id} x={x} />
                  ))}
                </ul>
                <MarketKey />
              </>
            )}
            <div className={s.section}>
              <div className={s.sectionHead}>
                <h3 className={s.h2}>Market vs Sam</h3>
                <p className={s.p}>Home spread, by tip time. Open a game for the total, moneyline and Sam&apos;s numbers.</p>
              </div>
              <RowsTable rows={upcoming} />
            </div>
            {last.length > 0 && (
              <div className={s.section}>
                <h3 className={s.h2}>Last night</h3>
                <RowsTable rows={last} />
              </div>
            )}
            <Background>
              <p className={s.p}>Once a game tips, Sam drops it and ESPN drops the odds, so its row keeps the numbers saved before tip: the ones it is graded on. Games run daily, so there is no weekly reset.</p>
            </Background>
          </section>
        )}

        <footer className={s.footer}>
          <span>
            Sources: <a href={NBA_SOURCES.samBoard}>Sam&apos;s Models</a>. Lines: DraftKings via ESPN. Model output, not betting advice.
          </span>
          {b?.unmatched.length ? <span>{`Sam games not matched to ESPN: ${b.unmatched.join(", ")}`}</span> : null}
          {b?.problems.map((t) => (
            <span key={t}>{t}</span>
          ))}
        </footer>
      </div>
    </main>
  );
}
