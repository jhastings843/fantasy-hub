import Link from "next/link";
import { etDay, getNbaBoard, NBA_SOURCES, type NbaBoard, type NbaBoardGame } from "@/lib/picks/nba-store";
import { getNbaPicksView, type NbaPicksView } from "@/lib/picks/nba-track-store";
import { nbaBets, NBA_GO_LIVE, NBA_LIMITS, tierOf, type NbaBet, type NbaCutRecord, type NbaRule, type NbaTracked } from "@/lib/picks/nba-track";
import { readNba } from "@/lib/picks/nba";
import { CRITERIA } from "@/lib/picks/learning/model";
import { BREAK_EVEN, MIN_SAMPLE } from "@/lib/picks/engine";
import { drawdown, GameCell, href, line, pieces, LOG_VIEW, MARKETS, NBA_VIEWS, price, rec, units, whenEt, type Market, type View } from "../ui";
import { Background, CutRanges, Curve, Hero, LearnerLog, ModelLineup, PageHead, SecHead, Stats, TrackingProgress, type LogEntry, type ModelRow } from "../board";
import { NbaGameModelCard } from "./game-model";
import s from "../picks.module.css";
import n from "./nba.module.css";

// The NBA tab. One model (Sam) against the DraftKings line, tracked like
// football (nba-track.ts): saved before tip, graded, sliced into cuts, a rule
// chosen the football way and a learning review after each night. Not staked
// until the go-live gate clears, then under NBA's own limits; never in
// football's 30u. Same layout as NFL and college: a market (spreads, straight
// up, totals), then a view (board, results, research, learner log). The board
// shows games still to finish; finished games live on Results.

const MARKET_NAME: { [m in Market]: string } = { ats: "Spreads", su: "Straight up", ou: "Totals" };
const ET = "America/New_York";
const tipTime = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { timeZone: ET, hour: "numeric", minute: "2-digit" });
const shortDate = (iso: string) => new Date(iso).toLocaleDateString("en-US", { timeZone: ET, weekday: "short", month: "short", day: "numeric" });
const pctOf = (x: number) => `${(x * 100).toFixed(1)}%`;
const cls = (u: number) => (u > 0 ? s.pos : u < 0 ? s.neg : "");

const dayLabel = (day: string, today: string) => {
  const d = new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(4, 6)) - 1, Number(day.slice(6, 8)), 16));
  const label = d.toLocaleDateString("en-US", { timeZone: ET, weekday: "short", month: "short", day: "numeric" });
  return day === today ? `Today · ${label}` : label;
};

export const nbaHref = (m: Market, v: View) => {
  const q = new URLSearchParams();
  if (m !== "ats") q.set("m", m);
  if (v !== "week") q.set("v", v);
  const qs = q.toString();
  return qs ? `/picks/nba?${qs}` : "/picks/nba";
};

/** Sam's board state in one sentence, for the headline. */
function samLine(b: NbaBoard): string {
  const sam = b.sam;
  if (sam.state === "live") return "Sam's side at the DraftKings number. Every read is saved before tip and graded; nothing is staked until the go-live gate clears.";
  if (sam.state === "soon") return `Sam's NBA model isn't out yet (his page says: "${sam.note}"). DraftKings lines below; his side fills in when it posts.`;
  if (sam.state === "unread") return "Sam's NBA page is up but laid out differently, so it can't be read yet (src/lib/picks/nba.ts needs updating).";
  return `Couldn't reach Sam's NBA page (${sam.error}). DraftKings lines only.`;
}

/** A board game's current numbers as a tracker snapshot, so the board reads bets the way grading will. */
function snapOf(g: NbaBoardGame): NbaTracked | null {
  if (!g.read) return null;
  const snap = {
    at: "",
    line: g.line?.home,
    homePrice: g.line?.homePrice,
    awayPrice: g.line?.awayPrice,
    total: g.total?.points,
    overPrice: g.total?.overPrice,
    underPrice: g.total?.underPrice,
    mlHome: g.ml?.home,
    mlAway: g.ml?.away,
    model: g.read.model,
    samLine: g.read.samLine,
    modelTotal: g.read.modelTotal,
  };
  return { id: g.id, day: g.day, week: 0, tip: g.tip, home: g.home.abbr, away: g.away.abbr, first: snap, last: snap };
}

/**
 * Once a game tips, Sam drops it from his page and ESPN drops the odds, so a
 * live or final card shows the copy saved before tip: the numbers it is graded on.
 */
function asSaved(g: NbaBoardGame, t: NbaTracked | undefined): NbaBoardGame {
  if (g.state === "pre" || !t) return g;
  const x = t.last;
  const out: NbaBoardGame = {
    ...g,
    line: x.line !== undefined ? { home: x.line, homePrice: x.homePrice, awayPrice: x.awayPrice } : g.line,
    total: x.total !== undefined ? { points: x.total, overPrice: x.overPrice, underPrice: x.underPrice } : g.total,
    ml: x.mlHome !== undefined || x.mlAway !== undefined ? { home: x.mlHome, away: x.mlAway } : g.ml,
  };
  return { ...out, read: readNba(out, { home: g.home.abbr, away: g.away.abbr, model: x.model, vegas: x.samLine ?? NaN, ...(x.modelTotal !== undefined ? { total: x.modelTotal } : {}) }) };
}

const ruleOf = (v: NbaPicksView, m: Market): NbaRule | null => (m === "ats" ? v.ats : m === "ou" ? v.ou : null);

/** One game's read in one market: the saved copy once tipped, Sam's bet, the rule's tier and any stake. */
function readMarket(raw: NbaBoardGame, v: NbaPicksView | null, m: Market) {
  const saved = v?.games.find((x) => x.id === raw.id);
  const g = asSaved(raw, saved);
  const t = snapOf(g);
  const bet: NbaBet | null = t ? (nbaBets(t).find((b) => b.market === m) ?? null) : null;
  const rule = v ? ruleOf(v, m) : null;
  const tier = bet && rule && g.state === "pre" ? tierOf(bet, rule) : null;
  const stake = tier && v?.gate.live && m === "ats" ? (saved?.stake ?? null) : null;
  return { g, bet, tier, stake };
}
type Read = ReturnType<typeof readMarket>;

/** Sam's spread read on one game, for the Today page's live slips: the pick in words, its price, tier and any stake. */
export function readGame(raw: NbaBoardGame, v: NbaPicksView | null) {
  const x = readMarket(raw, v, "ats");
  const r = x.g.read;
  const pick = x.bet ? betText(x.bet, x.g.home.short, x.g.away.short) : `${x.g.away.short} at ${x.g.home.short}`;
  return { ...x, r, pick, pickPrice: x.bet?.price };
}

/** What the bet is, in words: "Celtics -4.5", "Under 228.5", "Knicks to win". */
function betText(b: NbaBet, home: string, away: string): string {
  const team = b.side === "home" ? home : away;
  if (b.market === "ats") return `${team} ${line(b.line)}`;
  if (b.market === "ou") return `${b.side === "over" ? "Over" : "Under"} ${b.line}`;
  return `${team} to win`;
}

/** The market's number, Sam's number, the bet and its edge, for one row. */
function cells(x: Read, m: Market) {
  const { g, bet } = x;
  const r = g.read;
  if (m === "ats")
    return {
      market: g.line ? `${g.home.abbr} ${line(g.line.home)}` : "·",
      sam: r ? `${g.home.abbr} ${line(r.model)}` : "·",
      pick: bet ? betText(bet, g.home.short, g.away.short) : r?.crossed ? "DK crossed" : "None",
      pickSub: bet?.price !== undefined ? price(bet.price) : undefined,
      edge: bet ? `${bet.edge.toFixed(1)}` : "·",
    };
  if (m === "ou")
    return {
      market: g.total ? `${g.total.points}` : "·",
      sam: r?.modelTotal !== undefined ? `${r.modelTotal}` : "·",
      pick: bet ? betText(bet, g.home.short, g.away.short) : "None",
      pickSub: bet?.price !== undefined ? price(bet.price) : undefined,
      edge: bet ? `${bet.edge.toFixed(1)}` : "·",
    };
  return {
    market: g.ml ? `${g.away.abbr} ${price(g.ml.away)}` : "·",
    marketSub: g.ml ? `${g.home.abbr} ${price(g.ml.home)}` : undefined,
    sam: r ? `${r.model < 0 ? g.home.abbr : g.away.abbr} by ${Math.abs(r.model).toFixed(1)}` : "·",
    pick: bet ? betText(bet, g.home.short, g.away.short) : "None",
    pickSub: bet ? `${price(bet.price)}${bet.dog ? " · underdog" : ""}` : undefined,
    edge: bet ? `${bet.edge.toFixed(1)}` : "·",
  };
}

function readChip(x: Read, m: Market): [string, string] {
  const { g, bet, tier, stake } = x;
  if (g.state === "in") return ["Live", s.readLive];
  if (g.state === "post") return [bet ? "Final · grading" : "Final", s.readPass];
  if (!g.read) return [g.line ? "No model yet" : "No line yet", s.readPass];
  if (!bet) return [m === "ats" && g.read.crossed ? "DK crossed" : "No side", s.readPass];
  if (m === "su") return ["Tracked · pick'em", s.readTrack];
  if (tier) return stake ? [`Tier ${tier} · ${stake}u`, s.readBet] : [`Tier ${tier} · no stake`, s.readPend];
  return ["Sam's side · no stake", s.readTrack];
}

/** Everything behind one game: spread, total, moneyline, Sam's numbers. */
function NbaWhy({ g }: { g: NbaBoardGame }) {
  const r = g.read;
  return (
    <dl className={s.kv}>
      <dt>Spread</dt>
      <dd className={s.num}>{g.line ? `${g.home.short} ${line(g.line.home)} (${price(g.line.homePrice)} / ${price(g.line.awayPrice)})` : "not posted"}</dd>
      <dt>Total</dt>
      <dd className={s.num}>{g.total ? `${g.total.points} (o ${price(g.total.overPrice)} / u ${price(g.total.underPrice)})` : "not posted"}</dd>
      <dt>Moneyline</dt>
      <dd className={s.num}>{g.ml ? `${g.away.abbr} ${price(g.ml.away)} · ${g.home.abbr} ${price(g.ml.home)}` : "not posted"}</dd>
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
      {g.tv && (
        <>
          <dt>Watch</dt>
          <dd>{g.tv}</dd>
        </>
      )}
    </dl>
  );
}

/** One game on the board, in the football boards' ledger shape (ats.tsx LedgerRow): matchup, market, Sam, our side and the read. */
function NbaRow({ x, m, day }: { x: Read; m: Market; day: string }) {
  const { g } = x;
  const c = cells(x, m);
  const chip = readChip(x, m);
  const tv = g.tv ? g.tv.replace(/^NBA League Pass$/, "League Pass") : "";
  const score = g.score ? `${g.away.abbr} ${g.score.away}, ${g.home.abbr} ${g.score.home}` : "";
  const sub = [c.pickSub, c.edge !== "·" ? `${m === "su" ? "margin" : "edge"} ${c.edge} pts` : ""].filter(Boolean).join(" · ");
  return (
    <details className={`${s.gRow} ${s.ledger}`}>
      <summary>
        <GameCell
          league="nba"
          away={g.away.abbr}
          home={g.home.abbr}
          awayName={g.away.short}
          homeName={g.home.short}
          status={
            g.state === "in" ? (
              <>
                <span className={s.gLive}>Live</span>
                <span className={s.scoreLine}>{pieces(`${score}${score ? " · " : ""}${g.detail}`)}</span>
              </>
            ) : g.state === "post" ? (
              `Final${score ? ` ${score}` : ""}`
            ) : (
              `${day ? `${day} · ` : ""}${tipTime(g.tip)}${tv ? ` · ${tv}` : ""}`
            )
          }
        />
        <span className={s.gNum} data-k={m === "su" ? "Moneyline" : "DraftKings"}>
          {c.market}
          {"marketSub" in c && c.marketSub ? <small>{c.marketSub}</small> : null}
        </span>
        <span className={s.gNum} data-k="Sam">
          <span className={s.cSam} style={{ whiteSpace: "nowrap" }}>{c.sam === "·" ? "·" : `Sam ${c.sam}`}</span>
        </span>
        <span className={s.gNum} data-k="Side">
          {c.pick}
          {sub && <small>{sub}</small>}
        </span>
        <span className={s.ledgerRead}>
          <span className={`${s.readChip} ${chip[1]}`}>{chip[0]}</span>
        </span>
        <span className={s.chev} aria-hidden>
          ›
        </span>
      </summary>
      <div className={s.gBody}>
        <NbaWhy g={g} />
      </div>
    </details>
  );
}

function RowsTable({ rows, m }: { rows: { x: Read; day: string }[]; m: Market }) {
  return (
    <div className={s.gtable}>
      <div className={`${s.gHead} ${s.ledgerHead}`} aria-hidden>
        <span>Game</span>
        <span>{m === "su" ? "Moneyline" : "DraftKings"}</span>
        <span>Sam</span>
        <span>Side</span>
        <span>Read</span>
        <span />
      </div>
      {rows.map(({ x, day }) => (
        <NbaRow key={x.g.id} x={x} m={m} day={day} />
      ))}
    </div>
  );
}

function BoardLegend({ m }: { m: Market }) {
  return (
    <div className={s.legendRow}>
      {m !== "su" && (
        <>
          <span>
            <span className={`${s.readChip} ${s.readBet}`}>Tier 1 · 1u</span> in the rule, staked (once live)
          </span>
          <span>
            <span className={`${s.readChip} ${s.readPend}`}>Tier 1 · no stake</span> in the rule, tracked until go-live
          </span>
        </>
      )}
      <span>
        <span className={`${s.readChip} ${s.readTrack}`}>{m === "su" ? "Tracked · pick'em" : "Sam's side · no stake"}</span> tracked, no stake
      </span>
      <span>
        <span className={`${s.readChip} ${s.readPass}`}>No side</span> no position
      </span>
    </div>
  );
}

/* ---------------------------------------------------------------- results -- */

/** Every graded bet in one market, newest week first, each week a disclosure with its games. */
function NbaResults({ v, m, pending }: { v: NbaPicksView; m: Market; pending: Read[] }) {
  const graded = v.games
    .filter((g) => g.final)
    .map((g) => ({ g, b: nbaBets(g).find((x) => x.market === m) }))
    .filter((x): x is { g: NbaTracked; b: NbaBet } => !!x.b?.result);
  const all = v.cuts.find((c) => c.id === `${m}:all`);
  const rule = ruleOf(v, m);
  const weeks = [...new Set(graded.map((x) => x.g.week))].sort((a, b) => a - b);
  const byWeek = weeks.map((w) => {
    const xs = graded.filter((x) => x.g.week === w);
    const tally = { w: xs.filter((x) => x.b.result === "W").length, l: xs.filter((x) => x.b.result === "L").length, p: xs.filter((x) => x.b.result === "P").length };
    return { week: w, xs: xs.sort((a, b) => b.g.tip.localeCompare(a.g.tip)), tally, units: xs.reduce((a, x) => a + (x.b.net ?? 0), 0) };
  });
  const total = byWeek.reduce((a, w) => a + w.units, 0);
  const risked = graded.filter((x) => x.b.result !== "P").length;
  const dd = drawdown(byWeek.map((w) => w.units));
  const inRule = rule?.tier1 ? graded.filter((x) => tierOf(x.b, rule) !== null) : [];
  const ruleUnits = inRule.reduce((a, x) => a + (x.b.net ?? 0), 0);
  const ruleRec = { w: inRule.filter((x) => x.b.result === "W").length, l: inRule.filter((x) => x.b.result === "L").length, p: inRule.filter((x) => x.b.result === "P").length };
  const what = m === "ats" ? "spreads" : m === "ou" ? "totals" : "straight-up winners";
  const startedPending = pending.filter((x) => x.bet);

  return (
    <section className={s.section} aria-labelledby="nba-results">
      <Hero
        eyebrow={`NBA ${v.season}-${String(v.season + 1).slice(2)} · ${MARKET_NAME[m]} · every game Sam read`}
        title={
          <span id="nba-results">
            {graded.length ? (
              <>
                {total >= 0 ? "Up " : "Down "}
                <span className={total >= 0 ? s.up : s.down}>{units(total)}</span>
                {` on ${all ? rec(all) : "0-0"} ${what}`}
              </>
            ) : (
              `No ${what} graded yet`
            )}
          </span>
        }
        sub={
          m === "su"
            ? "Sam's winner on every game at the saved moneyline, 1 unit per bet. Tracked only: straight up never stakes."
            : "Graded at the DraftKings number and price saved before tip, 1 unit per bet. Not staked yet: this is the record the go-live gate reads."
        }
      />
      {byWeek.length > 0 && (
        <div className={s.curveBox}>
          <h3 className={s.h3} style={{ margin: 0 }}>Units over the season</h3>
          <Curve points={byWeek.map((w) => ({ x: `Wk ${w.week}`, v: Math.round(w.units * 100) / 100 }))} label="Running units after each week" />
        </div>
      )}
      <div className={s.tiles}>
        <div className={`${s.tile} ${graded.length ? (total >= 0 ? s.good : s.bad) : ""}`}>
          <div className={`${s.tileV} ${s.num}`}>{graded.length ? units(total) : "none yet"}</div>
          <div className={s.tileK}>{`Every Sam ${m === "su" ? "winner" : "side"} · ${all ? rec(all) : "0-0"}`}</div>
        </div>
        <div className={s.tile}>
          <div className={`${s.tileV} ${s.num}`}>{risked ? `${Math.round((total / risked) * 100)}%` : "·"}</div>
          <div className={s.tileK}>{risked ? `Return on ${risked}u risked` : "Return on risk"}</div>
        </div>
        <div className={s.tile}>
          <div className={`${s.tileV} ${s.num}`}>{dd ? `−${dd.toFixed(1)}u` : "0u"}</div>
          <div className={s.tileK}>Worst drawdown (by week)</div>
        </div>
        <div className={s.tile}>
          <div className={`${s.tileV} ${s.num}`}>{rule?.tier1 ? units(ruleUnits) : m === "su" ? "No rule" : "None yet"}</div>
          <div className={s.tileK}>{rule?.tier1 ? `Rule tier 1 · ${rule.tier1.label} · ${rec(ruleRec)}` : m === "su" ? "Straight up is tracked, never staked" : "No cut clears the bar yet"}</div>
        </div>
      </div>

      {startedPending.length > 0 && (
        <div className={s.section}>
          <h3 className={s.h2}>Finished, grading overnight</h3>
          <RowsTable rows={startedPending.map((x) => ({ x, day: shortDate(x.g.tip) }))} m={m} />
          <p className={s.thin}>Graded from ESPN&apos;s final on the 2:30am ET run, then listed in their week below.</p>
        </div>
      )}

      <div className={s.betWeeks}>
        <h3 className={s.caption}>Game by game, by week</h3>
        {!byWeek.length && <p className={s.dim}>Nothing graded yet. Reads are saved before each tip and graded overnight.</p>}
        {[...byWeek].reverse().map((w, i) => (
          <details key={w.week} className={s.betWeek} open={i === 0}>
            <summary>
              <span className={s.betWeekName}>{`Week ${w.week}`}</span>
              <span className={`${s.num} ${s.betWeekRec}`}>{`${rec(w.tally)} · ${w.xs.length} game${w.xs.length === 1 ? "" : "s"}`}</span>
              <span className={`${s.num} ${s.betWeekNet} ${w.units < 0 ? s.neg : s.pos}`}>{units(w.units)}</span>
            </summary>
            <div className={s.betWeekBody}>
              {w.xs.map(({ g, b }) => (
                <div key={g.id} className={n.gameRow}>
                  <span className={n.when}>{shortDate(g.tip)}</span>
                  <span>{`${g.away} at ${g.home}`}</span>
                  <span className={`${n.mono} ${n.final}`}>{`${g.final!.away}-${g.final!.home}`}</span>
                  <span className={`${n.mono} ${n.bet}`}>
                    {betText(b, g.home, g.away)}
                    {b.price !== undefined ? <span className={s.dim}>{` ${price(b.price)}`}</span> : null}
                    {rule && tierOf(b, rule) ? <span className={`${s.tag} ${s.tagRule}`}>{`tier ${tierOf(b, rule)}`}</span> : null}
                  </span>
                  <span className={`${n.res} ${b.result === "W" ? s.resW : b.result === "L" ? s.resL : s.resP}`}>{`${b.result} ${(b.net ?? 0) >= 0 ? "+" : "−"}${Math.abs(b.net ?? 0).toFixed(2)}`}</span>
                </div>
              ))}
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}

/* --------------------------------------------------------------- research -- */

/** A cut's record as a bar with its 90% range, NFL's research look. Units here are at the saved prices. */
function CutBar({ c, mark }: { c: NbaCutRecord; mark?: 1 | 2 }) {
  const d = c.w + c.l;
  const good = c.pct > BREAK_EVEN;
  const tip = `${c.label}: ${rec(c)}, ${pctOf(c.pct)}, ${units(c.units)} at the saved prices. 90% likely range ${pctOf(c.lo)} to ${pctOf(c.hi)}.`;
  return (
    <div className={`${s.srow} ${mark === 1 ? s.star : mark === 2 ? s.second : ""}`} title={tip} tabIndex={0}>
      <div className={s.sname}>
        {c.label}
        {mark === 1 && <span className={s.pill}>tier 1</span>}
        {mark === 2 && <span className={`${s.pill} ${s.pillSoft}`}>tier 2</span>}
        {d > 0 && d < MIN_SAMPLE && <span className={s.thin}> · small sample</span>}
      </div>
      <div className={`${s.right} ${s.num}`}>{d ? rec(c) : "none"}</div>
      <div className={s.sbar}>
        <div className={s.track}>
          {d > 0 && (
            <>
              <span className={s.ci} style={{ left: `${c.lo * 100}%`, width: `${(c.hi - c.lo) * 100}%` }} />
              <span className={`${s.fill} ${good ? s.fillPos : s.fillNeg}`} style={{ width: `${c.pct * 100}%` }} />
            </>
          )}
          <span className={s.be} />
        </div>
      </div>
      <div className={`${s.right} ${s.num} ${s.hideSm}`}>{d ? `${Math.round(c.pct * 100)}%` : ""}</div>
      <div className={`${s.right} ${s.num} ${good ? s.pos : s.neg}`}>{d ? `${c.units >= 0 ? "+" : "−"}${Math.abs(c.units).toFixed(1)}` : ""}</div>
    </div>
  );
}

function NbaResearch({ v, m }: { v: NbaPicksView; m: Market }) {
  const cuts = v.cuts.filter((c) => c.market === m);
  const rule = ruleOf(v, m);
  const decided = v.games.filter((g) => g.final).length;
  const markOf = (id: string) => (rule?.tier1?.id === id ? 1 : rule?.tier2?.id === id ? 2 : undefined);
  const hyps = v.hyps.filter((h) => h.id.startsWith(`${m}:`));
  const t1 = rule?.tier1;
  return (
    <section className={s.section} aria-labelledby="nba-research">
      <Hero
        eyebrow={`NBA ${MARKET_NAME[m].toLowerCase()} · ${decided} graded game${decided === 1 ? "" : "s"}`}
        title={<span id="nba-research">What actually wins</span>}
        sub="Each cut's record if you had bet every game it covers at the saved DraftKings price. The shaded band is its 90% likely range; the line is break-even."
      />
      {m === "su" ? (
        <p className={s.calm}>Straight up has no rule: Sam&apos;s winners are tracked at the moneyline to see whether any cut is worth a closer look. Nothing stakes.</p>
      ) : t1 ? (
        <div className={s.rule}>
          <div>
            <div className={s.eyebrow}>The rule in force</div>
            <h3 className={s.h2}>{t1.label}</h3>
            <p className={s.p}>
              {`Of the cuts with ${MIN_SAMPLE}+ decided games and a win rate past 52.4%, this has the highest low end of its 90% range (${pctOf(t1.lo)}).`}
              {rule?.tier2 ? ` Tier 2: ${rule.tier2.label.toLowerCase()} (${rec(rule.tier2)}), judged only on the games it adds.` : " No tier 2 yet."}
              {m === "ats" ? (v.gate.live ? " Staked under NBA's own limits." : " Tracked with no stake until the go-live gate clears.") : " Tracked with no stake."}
            </p>
          </div>
          <div className={`${s.big} ${s.num}`}>
            {rec(t1)}
            <small>{`${Math.round(t1.pct * 100)}% · ${units(t1.units)}`}</small>
          </div>
        </div>
      ) : (
        <div className={s.rule}>
          <div>
            <div className={s.eyebrow}>The rule in force</div>
            <h3 className={s.h2}>None yet</h3>
            <p className={s.p}>{`A cut needs ${MIN_SAMPLE}+ decided games and a win rate past 52.4% before it can be the rule. Every game is tracked meanwhile.`}</p>
          </div>
          <div className={`${s.big} ${s.num}`}>
            {decided}
            <small>games graded</small>
          </div>
        </div>
      )}

      <details className={s.details} open>
        <summary>Every cut tested</summary>
        <div className={s.board}>
          <div className={s.legend}>
            <span>
              <i style={{ background: "var(--pos)" }} />
              Above break-even
            </span>
            <span>
              <i style={{ background: "var(--neg)" }} />
              Below
            </span>
            <span>
              <i style={{ background: "var(--ci)" }} />
              90% likely range
            </span>
            <span>Units: 1u a bet at the saved price</span>
          </div>
          <div className={s.grp}>Core cuts</div>
          {cuts.filter((c) => !c.research).map((c) => (
            <CutBar key={c.id} c={c} mark={markOf(c.id)} />
          ))}
          {cuts.some((c) => c.research) && (
            <>
              <div className={s.grp}>Research cuts (join the rule only through the review)</div>
              {cuts.filter((c) => c.research).map((c) => (
                <CutBar key={c.id} c={c} mark={markOf(c.id)} />
              ))}
            </>
          )}
        </div>
      </details>

      {m === "ats" && (
        <details className={s.details}>
          <summary>{v.gate.live ? "Go-live gate: cleared" : `Go-live gate: ${v.gate.checks.filter((c) => c.ok).length} of ${v.gate.checks.length} checks met`}</summary>
          <div className={s.tw}>
            <table className={s.table}>
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
            {`Set Oct 19, before any NBA record existed. Once live, NBA has its own limits, separate from football's 30u: ${NBA_LIMITS.MIN_STAKE}u to ${NBA_LIMITS.MAX_STAKE}u a bet, ${NBA_LIMITS.PER_GAME}u a game, ${NBA_LIMITS.DAILY}u a day, and ${NBA_LIMITS.WINDOW_UNITS}u across any running ${NBA_LIMITS.WINDOW_DAYS} days, quarter Kelly on the tier record pulled toward 50% over ${NBA_LIMITS.SHRINK_GAMES} games. Gate: ${NBA_GO_LIVE.MIN_GAMES}+ games over ${NBA_GO_LIVE.MIN_WEEKS}+ weeks.`}
            {v.gate.live ? ` Today: ${v.room.today}u of ${NBA_LIMITS.DAILY}u used, ${v.room.room}u left.` : ""}
          </p>
        </details>
      )}

      {hyps.length > 0 && (
        <details className={s.details}>
          <summary>{`Does being more specific help? (${hyps.length} research cut${hyps.length === 1 ? "" : "s"} against their parent)`}</summary>
          <div className={s.tw}>
            <table className={s.table}>
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
                {hyps.map((h) => (
                  <tr key={h.id}>
                    <td>{h.label}</td>
                    <td>{h.parentLabel}</td>
                    <td className={s.num}>{`${h.cmp.n} / ${CRITERIA.MIN_OPPORTUNITIES}`}</td>
                    <td className={s.num}>{`${h.cmp.weeks} / ${CRITERIA.MIN_WEEKS}`}</td>
                    <td className={`${s.num} ${cls(h.cmp.mean)}`}>{h.cmp.n ? `${h.cmp.mean > 0 ? "+" : ""}${h.cmp.mean.toFixed(2)}` : "–"}</td>
                    <td className={s.num}>{h.cmp.t ?? "–"}</td>
                    <td className={h.status === "active" ? s.pos : h.status === "rolled-back" ? s.neg : s.dim}>{h.status === "active" ? "in the rule" : h.status === "rolled-back" ? "rolled back" : "collecting"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className={`${s.notice} ${s.dim}`}>
            {`Games first seen after each was registered. Same bar as football's review: ${CRITERIA.MIN_OPPORTUNITIES}+ games over ${CRITERIA.MIN_WEEKS}+ weeks and t ${CRITERIA.MIN_T}+ to go in, at most one per market a week; rolled back when it trails its parent on ${CRITERIA.ROLLBACK_MIN_OPPORTUNITIES}+ games with t at or under -${CRITERIA.MIN_T}.`}
          </p>
        </details>
      )}
      {m !== "su" && <NbaGameModelCard season={v.season} />}
    </section>
  );
}

/* ------------------------------------------------------------ learner log -- */

const NBA_KIND: { [k: string]: LogEntry["kind"] } = { register: "new", activate: "live", rollback: "back", review: "test", retain: "test" };

/** NBA's learner log for one market: the research cuts it is testing against their parents, and what each review did. */
function NbaLog({ v, m }: { v: NbaPicksView; m: Market }) {
  const hyps = v.hyps.filter((h) => h.id.startsWith(`${m}:`));
  const entries: LogEntry[] = v.journal.map((j) => ({ at: j.at, kind: NBA_KIND[j.kind] ?? "test", title: j.text }));
  return (
    <section className={s.section} aria-labelledby="nba-log">
      <Hero
        eyebrow={`NBA ${MARKET_NAME[m].toLowerCase()} · what changed, and why`}
        title={<span id="nba-log">Learner log</span>}
        sub={`NBA learns on its own games: each research cut is tested against the broader cut it narrows, on games first seen after it registered, and goes live at ${CRITERIA.MIN_OPPORTUNITIES}+ games over ${CRITERIA.MIN_WEEKS}+ weeks at t ${CRITERIA.MIN_T}+. ${v.lastReviewAt ? `Last review ${whenEt(v.lastReviewAt)}; it runs after each night's games.` : "The first review runs after the first graded night."}`}
      />
      <TrackingProgress
        rows={hyps.map((h) => ({
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
        sub={`Research cuts on Sam's NBA ${MARKET_NAME[m].toLowerCase()}, each against the broader cut it narrows. New games land every night.`}
        empty={m === "su" ? "Straight up has no research cuts: it is tracked only." : "No ideas registered for this market yet. They register at the first review."}
      />
      <div className={s.section}>
        <h3 className={s.h2}>Latest (all NBA markets)</h3>
        <LearnerLog entries={entries.slice(0, 20)} empty="Nothing recorded yet. The first entries come from the first review." />
      </div>
      <div className={s.section}>
        <h3 className={s.h2}>Cut comparisons</h3>
        <CutRanges
          title={MARKET_NAME[m]}
          open
          rows={v.cuts.filter((c) => c.market === m && c.w + c.l > 0).map((c) => ({ label: c.label, w: c.w, l: c.l, p: c.p, be: m === "su" ? undefined : 0.524, units: c.units }))}
        />
      </div>
      <p className={`${s.notice} ${s.dim}`}>The review status and the full journal for every NBA market are on this page under any market; the scheduler&apos;s health is on the Spreads learner log for football.</p>
    </section>
  );
}

/* ------------------------------------------------------------------- page -- */

function lineup(v: NbaPicksView, m: Market): ModelRow[] {
  const sam: ModelRow = { name: "Sam's NBA reads", role: "Spreads, totals and winners, outside source", status: "input", note: "The input behind NBA tier picks. Never stakes on its own." };
  if (m === "su")
    return [
      { name: "Straight-up picks", role: "Sam's winner, every game", status: "projections", note: "Tracked at the moneyline. No NBA pool, so nothing here is entered or staked." },
      sam,
    ];
  const rule = ruleOf(v, m)!;
  const t1 = rule.tier1;
  const live = m === "ats" && v.gate.live;
  return [
    {
      name: t1 ? `${m === "ats" ? "Spread" : "Totals"} rule: ${t1.label}` : `${m === "ats" ? "Spread" : "Totals"} rule`,
      role: `Decides NBA ${m === "ats" ? "spread" : "totals"} bets once live`,
      status: live ? "active" : "collecting",
      note: live
        ? "Tier bets carry stakes under NBA's own limits."
        : m === "ats"
        ? `Every Sam side is tracked at the saved DraftKings price with no stake. Go-live gate: ${v.gate.checks.map((c) => `${c.have} of ${c.need} ${c.label.toLowerCase()}`).join("; ")}.`
        : "Every Sam total is tracked at the saved price with no stake.",
    },
    sam,
    { name: "Our NBA game model", role: "Spreads and totals, forward test", status: "collecting", note: "Built Oct 26. No edge at the close in the backtest, so it is tracked at the first price we had a number, with no stake. See Research." },
  ];
}

export default async function NbaView({ view = "week", market = "ats" }: { view?: View; market?: Market }) {
  const m = market;
  const needBoard = view === "week" || view === "results";
  const [b, v] = await Promise.all([needBoard ? getNbaBoard().catch(() => null) : Promise.resolve(null), getNbaPicksView().catch(() => null)]);
  const today = etDay(new Date());
  const sportNav = (
    <nav className={s.chips} aria-label="Sport">
      <Link className={s.chip} href={href("nfl", m, view)}>
        NFL
      </Link>
      <Link className={s.chip} href={href("cfb", m, view)}>
        College
      </Link>
      <Link className={s.chip} href={nbaHref(m, view)} aria-current="page">
        NBA
      </Link>
    </nav>
  );
  const all = v?.cuts.find((c) => c.id === `${m}:all`);
  const rule = v ? ruleOf(v, m) : null;
  const t1 = rule?.tier1;
  const testing = v?.hyps.filter((h) => h.status === "collecting").length ?? 0;
  // The board: games still to finish (live first, then by tip). Finished ones are on Results.
  const ahead = (b?.days ?? []).flatMap((d) => d.games.map((g) => ({ x: readMarket(g, v, m), day: d.day === today ? "" : dayLabel(d.day, today) })));
  const upcoming = [...ahead.filter(({ x }) => x.g.state === "in"), ...ahead.filter(({ x }) => x.g.state === "pre")];
  const finishedToday = ahead.filter(({ x }) => x.g.state === "post").length;
  // Finished but not yet graded (tonight's and last night's), shown at the top of Results.
  const graded = new Set(v?.games.filter((g) => g.final).map((g) => g.id) ?? []);
  const pending = [...(b?.yesterday?.games ?? []), ...(b?.days ?? []).flatMap((d) => d.games)]
    .filter((g) => g.state === "post" && !graded.has(g.id))
    .map((g) => readMarket(g, v, m));
  const todayGames = (b?.days ?? []).find((d) => d.day === today)?.games.filter((g) => g.state !== "post").length ?? 0;
  const inTier = upcoming.filter(({ x }) => x.tier && x.g.state === "pre").length;

  const stats = v && (
    <Stats
      label="NBA record, rule and learner"
      items={[
        { k: `${MARKET_NAME[m]}, every Sam ${m === "su" ? "winner" : "side"}`, v: all && all.w + all.l + all.p ? units(all.units) : "0-0", sub: all ? rec(all) : "nothing graded", tone: all && all.w + all.l ? (all.units >= 0 ? "up" : "down") : undefined },
        { k: "Rule in force", v: m === "su" ? "None (tracked)" : t1 ? t1.label : "None yet", sub: m === "su" ? "straight up never stakes" : t1 ? rec(t1) : "nothing clears the bar", small: true },
        { k: "Stakes", v: v.gate.live && m === "ats" ? "Live" : "Tracking", sub: v.gate.live && m === "ats" ? "NBA's own limits" : m === "ats" ? "until the go-live gate clears" : "no stakes in this market", small: true },
        { k: "Learner", v: `${testing} idea${testing === 1 ? "" : "s"} testing`, sub: <Link href={nbaHref(m, "log")}>Open the log</Link>, small: true },
      ]}
    />
  );

  return (
    <main className={s.page}>
      <div className={s.wrap}>
        <header className={s.pageFrame}>
          <PageHead title="NBA picks" sub="Tonight. Which model moves money here, and what each game reads." asof={`NBA ${v ? `${v.season}-${String(v.season + 1).slice(2)}` : "2026-27"}`} />
          <div className={s.controlBar}>
            {sportNav}
            <nav className={s.chips} aria-label="Market">
              {MARKETS.map((x) => (
                <Link key={x.id} href={nbaHref(x.id, view)} aria-current={x.id === m ? "page" : undefined} className={s.chip}>
                  {x.label}
                </Link>
              ))}
            </nav>
            <nav className={s.chips} aria-label="View">
              {[...NBA_VIEWS, LOG_VIEW].map((x) => (
                <Link key={x.id} href={nbaHref(m, x.id)} aria-current={x.id === view ? "page" : undefined} className={s.chip}>
                  {x.id === "week" ? "Board" : x.label}
                </Link>
              ))}
            </nav>
          </div>
          {view !== "week" && stats}
        </header>
        {v && view === "week" && <ModelLineup title={`Who decides NBA ${MARKET_NAME[m].toLowerCase()}`} aside={m === "su" ? "No stakes in straight up." : v.gate.live && m === "ats" ? "The tier rule sets stakes under NBA's own limits." : "Nothing here sets a stake yet."} models={lineup(v, m)} />}

        {view !== "week" ? (
          !v ? (
            <div className={s.error} role="alert">
              Couldn&apos;t load the NBA record right now. Try again in a few minutes.
            </div>
          ) : view === "results" ? (
            <NbaResults v={v} m={m} pending={pending} />
          ) : view === "log" ? (
            <NbaLog v={v} m={m} />
          ) : (
            <NbaResearch v={v} m={m} />
          )
        ) : !b ? (
          <div className={s.error} role="alert">
            Couldn&apos;t load the NBA slate right now. Try again in a few minutes.
          </div>
        ) : !upcoming.length ? (
          <p className={s.calm}>
            {`No NBA games left to play in the next week.`} <Link href={nbaHref(m, "results")}>Finished games are on Results.</Link>
          </p>
        ) : (
          <section className={s.section} aria-labelledby="nba-slate">
            <SecHead
              id="nba-slate"
              title={MARKET_NAME[m]}
              aside={m === "su" ? `${todayGames} game${todayGames === 1 ? "" : "s"} left today` : `${inTier ? `${inTier} in the rule's tier` : todayGames ? `${todayGames} left today, none in the rule's tier` : "No games left today"}`}
            />
            <p className={s.p}>{samLine(b)}</p>
            <BoardLegend m={m} />
            <RowsTable rows={upcoming} m={m} />
            <p className={s.p}>
              {`Live games first, then by tip. ${m === "ats" ? "Home spread under DraftKings and Sam; edge is the points between Sam and DraftKings on his side." : m === "ou" ? "Edge is the points between Sam's total and DraftKings'." : "Margin is how many points Sam has his winner by."} Open a game for every market and Sam's numbers.`}
              {finishedToday ? (
                <>
                  {` ${finishedToday} finished today: `}
                  <Link href={nbaHref(m, "results")}>see Results</Link>.
                </>
              ) : null}
            </p>
            {stats}
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

