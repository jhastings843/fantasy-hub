import Link from "next/link";
import { cbbGameHref } from "../hrefs";
import { getCbbBoard, getCbbRecord, CBB_PARAMS, type CbbBoard, type CbbBoardRow, type CbbRecord } from "@/lib/models/cbb/store";
import { SIGNALS, signalsOf, graded, type SignalRecord } from "@/lib/models/cbb/track";
import BACKTEST from "@/lib/models/cbb/backtest.json";
import { GameCell, line, pieces, price, rec, units, whenEt, type Market, type View } from "../ui";
import { betRecordTile } from "../../props/learning";
import { Background, engineEntry, Hero, LearnerLog, PageHead, SecHead, Stats, TrackingProgress } from "../board";
import { CBB_SLICES } from "@/lib/models/cbb/learn";
import { scoresAt } from "@/lib/live/scores-at";
import { ScopeRow, ViewTabs } from "../tabs";
import { scopeGroups, viewTabs } from "../tab-sets";
import { LazyDetails } from "@/components/hh/LazyDetails";
import { loadCbbGame } from "./actions";
import s from "../picks.module.css";
import c from "./cbb.module.css";

// College basketball (Jack, 2026-11-02). One model of ours, blended from our
// own ratings and T-Rank, against DraftKings' number via ESPN. Same layout
// as NFL, college football and NBA: a market, then a view. Tracked only:
// the backtest found no edge at the close, so nothing here is staked until a
// signal clears its gate on live games (lib/models/cbb/track.ts).

const MARKET_NAME: { [m in Market]: string } = { ats: "Spreads", su: "Straight up", ou: "Totals" };
const ET = "America/New_York";
const tipTime = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { timeZone: ET, hour: "numeric", minute: "2-digit" });
const shortDate = (iso: string) => new Date(iso).toLocaleDateString("en-US", { timeZone: ET, weekday: "short", month: "short", day: "numeric" });
const pctOf = (x: number) => `${(x * 100).toFixed(0)}%`;
const signed = (x: number, d = 1) => `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(x).toFixed(d)}`;
const cls = (u: number) => (u > 0 ? s.pos : u < 0 ? s.neg : "");
const STATUS = { collecting: "Collecting", active: "Live", paused: "Paused this week", "rolled-back": "Rolled back", retired: "Retired" } as const;
/** Which slices belong to a market tab. */
const sliceMarket = (id: string): Market => (CBB_SLICES.find((x) => x[0] === id)?.[3] === "total" ? "ou" : "ats");

type SliceBt = { id: string; label: string; w: number; l: number; p: number; units: number; move: number | null };
const BT_SLICES = ((BACKTEST as unknown as { slices?: SliceBt[] }).slices ?? []) as SliceBt[];

/**
 * Every learner slice in one market: the live record since it registered (starts at 0-0 on opening night,
 * the only thing the gate reads) beside its 2025-26 backtest, which is background evidence and never counts.
 */
function SliceTable({ v, m }: { v: CbbRecord; m: Market }) {
  const live = new Map(v.section.entries.map((e) => [e.id, e]));
  const rows = CBB_SLICES.filter(([id]) => sliceMarket(id) === m);
  const g = v.section.gate;
  return (
    <div className={s.section}>
      <h3 className={s.h2}>Every slice the learner is testing</h3>
      <p className={s.p}>
        {`Live counts only games that tip after a slice registered, starting at 0-0 this season. A slice goes live at ${g.minGames}+ games over ${g.minWeeks}+ weeks with t ${g.minT}+ and must beat the broader slice it narrows; it rolls back if it then loses. The 2025-26 column is background: the same slice graded at the opening line, never counted toward the bar.`}
      </p>
      <div className={s.tw}>
        <table className={s.table}>
          <thead>
            <tr>
              <th>Slice</th>
              <th>Live</th>
              <th className={c.btHead}>2025-26</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([id, label]) => {
              const e = live.get(id);
              const ev = e?.ev;
              const bt = BT_SLICES.find((x) => x.id === id);
              const n = bt ? bt.w + bt.l : 0;
              return (
                <tr key={id} className={e?.status === "active" ? c.liveRow : undefined}>
                  <td className={c.sliceName}>
                    {label}
                    <small className={`${c.sub} ${e?.status === "active" ? s.pos : e?.status === "rolled-back" ? s.neg : s.dim}`}>{e ? STATUS[e.status] : "Registers soon"}</small>
                  </td>
                  <td className={`${s.num} ${s.nw}`}>
                    {ev && ev.bets ? `${ev.wins}-${ev.bets - ev.wins}` : "0-0"}
                    <small className={`${c.sub} ${ev && ev.bets ? cls(ev.units) : ""}`}>{ev && ev.bets ? `${units(ev.units)} · t ${ev.t.toFixed(2)}` : "new"}</small>
                  </td>
                  <td className={`${s.num} ${s.nw} ${c.bt}`}>
                    {n ? `${bt!.w}-${bt!.l}` : "·"}
                    {n > 0 && <small className={`${c.sub} ${bt!.w / n > 0.524 ? s.pos : bt!.units < 0 ? s.neg : ""}`}>{`${((bt!.w / n) * 100).toFixed(1)}% · ${units(bt!.units)}`}</small>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className={`${s.notice} ${s.dim}`}>2025-26 is retrospective: the model&apos;s number on a game could use results from after its line opened, and the blend&apos;s two weights were fit on that season&apos;s first half. Line-move slices need a later read, and Harris slices his daily sheet (tracked from Nov 6), so neither has a backtest.</p>
    </div>
  );
}

/** The learner's log: what registered, went live or rolled back, and each review's summary. */
function LogView({ v, m }: { v: CbbRecord; m: Market }) {
  const g = v.section.gate;
  const entries = v.section.entries.filter((e) => sliceMarket(e.id) === (m === "su" ? "ats" : m));
  return (
    <section className={s.section} aria-labelledby="cbb-log">
      <Hero
        eyebrow={`CBB ${m === "ou" ? "totals" : "spreads"} · what changed, and why`}
        title={<span id="cbb-log">Learner log</span>}
        sub={`The same learning cycle as football and NBA: each slice is a paper bet on games after it registered, reviewed once a night. It goes live at ${g.minGames}+ games over ${g.minWeeks}+ weeks with t ${g.minT}+ (and must beat the slice it narrows), at most ${g.maxNew} a review, and rolls back after ${g.rollbackGames}+ games if it loses at t ${g.rollbackT} or worse. It also proposes combinations of its strongest slices. ${v.section.lastReviewAt ? `Last review ${whenEt(v.section.lastReviewAt)}.` : "The first review runs after opening night's games are graded."}`}
      />
      <TrackingProgress
        rows={entries.map((e) => ({
          id: e.id,
          label: e.label,
          status: e.status === "active" || e.status === "paused" ? "live" : e.status === "rolled-back" ? "back" : "testing",
          games: e.ev?.games ?? 0,
          needGames: g.minGames,
          weeks: e.ev?.weeks ?? 0,
          needWeeks: g.minWeeks,
          result: e.ev && e.ev.bets ? `${e.ev.units >= 0 ? "+" : "−"}${Math.abs(e.ev.units).toFixed(1)}u over ${e.ev.bets} bets, t ${e.ev.t.toFixed(2)} of ${g.minT}` : undefined,
          note: e.ev && e.ev.bets ? undefined : "No graded games yet: only games after it registered count.",
        }))}
        sub={`Slices on our college hoops ${m === "ou" ? "totals" : "spreads"}, each a paper bet at the price we first saved.`}
        empty="No slices registered yet. They register on the first pulse after this deploy."
      />
      <div className={s.section}>
        <h3 className={s.h2}>Latest (spreads and totals)</h3>
        <LearnerLog entries={v.section.journal.map((j) => engineEntry(j, "CBB"))} empty="Nothing recorded yet. The first entries come when the slices register." />
      </div>
    </section>
  );
}

export const cbbHref = (m: Market, v: View) => {
  const q = new URLSearchParams();
  if (m !== "ats") q.set("m", m);
  if (v !== "week") q.set("v", v);
  const qs = q.toString();
  return qs ? `/picks/cbb?${qs}` : "/picks/cbb";
};

/* ------------------------------------------------------------------ reads -- */

type Lean = { side: "home" | "away" | "over" | "under"; size: number; tier: "big" | "strong" | "lean"; agree: boolean } | null;

function leanOf(x: CbbBoardRow, m: Market): Lean {
  const r = x.read;
  if (m === "ats") {
    if (r.spreadEdge === null || r.spreadEdge === 0) return null;
    const side = r.spreadEdge > 0 ? "home" : "away";
    const a = Math.abs(r.spreadEdge);
    const t = r.parts.trank;
    const sp = r.line?.spread ?? 0;
    const agree = !!t && Math.sign(r.parts.ours.margin + sp) === Math.sign(t.margin + sp) && Math.sign(r.parts.ours.margin + sp) === (side === "home" ? 1 : -1);
    return { side, size: a, tier: a >= 5 ? "big" : a >= CBB_PARAMS.strong ? "strong" : "lean", agree };
  }
  if (m === "ou") {
    if (r.totalEdge === null || r.totalEdge === 0) return null;
    const a = Math.abs(r.totalEdge);
    return { side: r.totalEdge > 0 ? "over" : "under", size: a, tier: a >= 7 ? "big" : a >= CBB_PARAMS.strongTotal ? "strong" : "lean", agree: false };
  }
  const p = r.proj.homeWin;
  return { side: p >= 0.5 ? "home" : "away", size: Math.abs(p - 0.5), tier: "lean", agree: false };
}

function pickText(x: CbbBoardRow, m: Market, l: Lean): string {
  const g = x.g;
  if (!l) return "None";
  if (m === "ats") {
    const sp = x.read.line?.spread ?? 0;
    return l.side === "home" ? `${g.home.short} ${line(sp)}` : `${g.away.short} ${line(-sp)}`;
  }
  if (m === "ou") return `${l.side === "over" ? "Over" : "Under"} ${x.read.line?.total}`;
  return `${l.side === "home" ? g.home.short : g.away.short} to win`;
}

function chanceOf(x: CbbBoardRow, m: Market, l: Lean): number | null {
  const r = x.read;
  if (!l) return null;
  if (m === "ats") return r.homeCover === null ? null : l.side === "home" ? r.homeCover : 1 - r.homeCover;
  if (m === "ou") return r.over === null ? null : l.side === "over" ? r.over : 1 - r.over;
  return l.side === "home" ? r.proj.homeWin : 1 - r.proj.homeWin;
}

function chip(x: CbbBoardRow, m: Market, l: Lean): [string, string] {
  if (x.g.state === "in") return ["Live", s.readLive];
  if (x.g.state === "post") return ["Final", s.readPass];
  if (m !== "su" && !x.read.line) return ["No line yet", s.readPass];
  if (!l) return ["No side", s.readPass];
  if (m === "su") return [`${pctOf(chanceOf(x, m, l) ?? 0.5)} to win`, s.readTrack];
  if (l.tier === "big") return ["Big lean · tracked", s.readPend];
  if (l.tier === "strong") return [`Strong${l.agree ? " · both agree" : ""}`, s.readTrack];
  return [l.agree ? "Lean · both agree" : "Lean", s.readPass];
}

const teamLabel = (t: { short: string; rank?: number }) => (t.rank ? `${t.rank} ${t.short}` : t.short);

function marketCell(x: CbbBoardRow, m: Market) {
  const l = x.read.line;
  const g = x.g;
  if (!l) return { v: "·" };
  if (m === "ats") return l.spread === null ? { v: "·" } : { v: `${g.home.abbr} ${line(l.spread)}`, sub: l.open.spread !== null && l.open.spread !== l.spread ? `opened ${line(l.open.spread)}` : undefined };
  if (m === "ou") return l.total === null ? { v: "·" } : { v: `${l.total}`, sub: l.open.total !== null && l.open.total !== l.total ? `opened ${l.open.total}` : undefined };
  return l.mlHome === undefined && l.mlAway === undefined ? { v: "·" } : { v: `${g.away.abbr} ${price(l.mlAway)}`, sub: `${g.home.abbr} ${price(l.mlHome)}` };
}

function oursCell(x: CbbBoardRow, m: Market) {
  const p = x.read.proj;
  const g = x.g;
  if (m === "ats") return { v: `${g.home.abbr} ${line(p.spread)}`, sub: `${Math.round(p.awayPts)}-${Math.round(p.homePts)}` };
  if (m === "ou") return { v: `${p.total}`, sub: `${Math.round(p.awayPts)}-${Math.round(p.homePts)}` };
  const fav = p.margin >= 0 ? g.home.abbr : g.away.abbr;
  return { v: `${fav} by ${Math.abs(p.margin).toFixed(1)}`, sub: `${pctOf(Math.max(p.homeWin, 1 - p.homeWin))}` };
}

function trankCell(x: CbbBoardRow, m: Market) {
  const t = x.read.parts.trank;
  if (!t) return "·";
  if (m === "ou") return `${t.total.toFixed(1)}`;
  return `${x.g.home.abbr} ${line(Math.round(-t.margin * 10) / 10 || 0)}`;
}

/* ------------------------------------------------------------------- rows -- */

function Row({ x, m, day }: { x: CbbBoardRow; m: Market; day: string }) {
  const { g, read: r } = x;
  const l = leanOf(x, m);
  const [chipText, chipCls] = chip(x, m, l);
  const mk = marketCell(x, m);
  const ours = oursCell(x, m);
  const chance = chanceOf(x, m, l);
  const score = g.score ? `${g.away.abbr} ${g.score.away}, ${g.home.abbr} ${g.score.home}` : "";
  const edgeTxt = l && m !== "su" ? `edge ${l.size.toFixed(1)} pts` : "";
  const status =
    g.state === "in" ? (
      <>
        <span className={s.gLive}>Live</span>{" "}
        <span className={s.scoreLine}>{pieces(`${score}${score ? " · " : ""}${g.detail}`)}</span>
      </>
    ) : g.state === "post" ? (
      `Final${score ? ` ${score}` : ""}`
    ) : (
      pieces(`${day ? `${day} · ` : ""}${tipTime(g.tip)}${g.tv ? ` · ${g.tv}` : ""}${g.neutral ? " · neutral" : ""}`)
    );
  const cls = `${s.gRow} ${s.ledger} ${l && l.tier !== "lean" && g.state === "pre" && (m !== "su" ? !!r.line : false) ? c.hot : ""}`;
  const summary = (
      <summary key="summary">
        <GameCell league="cfb" away={g.away.abbr} home={g.home.abbr} awayName={teamLabel(g.away)} homeName={teamLabel(g.home)} href={cbbGameHref(g.id)} quote={{ homeId: g.home.id, awayId: g.away.id }} status={status} />
        <span className={s.gNum} data-k={m === "su" ? "Moneyline" : "DraftKings"}>
          {mk.v}
          {mk.sub && <small>{mk.sub}</small>}
        </span>
        <span className={s.gNum} data-k="Ours">
          <span className={c.ours}>{ours.v}</span>
          <small>{[ours.sub, m !== "su" && r.parts.trank ? `T-Rank ${trankCell(x, m)}` : ""].filter(Boolean).join(" · ")}</small>
        </span>
        <span className={s.gNum} data-k="Side">
          {m !== "su" && !r.line ? "·" : pickText(x, m, l)}
          {(edgeTxt || chance !== null) && (m === "su" || r.line) && <small>{[edgeTxt, chance !== null && m !== "su" ? `${pctOf(chance)} to ${m === "ou" ? "hit" : "cover"}` : ""].filter(Boolean).join(" · ")}</small>}
        </span>
        <span className={s.ledgerRead}>
          <span className={`${s.readChip} ${chipCls}`}>{chipText}</span>
        </span>
        <span className={s.chev} aria-hidden>
          ›
        </span>
      </summary>
  );
  // The numbers under each game load when it opens (UX pass item 4: ~94 games a day).
  return <LazyDetails className={cls} summary={summary} load={loadCbbGame.bind(null, g.id)} loadingClass={s.gBody} />;
}

/** One game's numbers: projections, lines, ratings, where, what was saved. */
export function CbbRowBody({ x }: { x: CbbBoardRow }) {
  const { g, read: r } = x;
  return (
      <div className={s.gBody}>
        <div className={c.stats}>
          <div>
            <span>Projected score</span>
            <b className={s.num}>{`${g.away.short} ${r.proj.awayPts.toFixed(0)}, ${g.home.short} ${r.proj.homePts.toFixed(0)}`}</b>
          </div>
          <div>
            <span>Win chance</span>
            <b className={s.num}>{`${r.proj.homeWin >= 0.5 ? g.home.short : g.away.short} ${pctOf(Math.max(r.proj.homeWin, 1 - r.proj.homeWin))}`}</b>
          </div>
          <div>
            <span>Cover chance</span>
            <b className={s.num}>{r.homeCover !== null ? `${g.home.short} ${pctOf(r.homeCover)}` : "no line"}</b>
          </div>
          <div>
            <span>Over chance</span>
            <b className={s.num}>{r.over !== null ? pctOf(r.over) : "no line"}</b>
          </div>
        </div>
        <dl className={s.kv}>
          <dt>Spread</dt>
          <dd className={s.num}>{r.line?.spread != null ? `${g.home.short} ${line(r.line.spread)} (${price(r.line.homePrice)} / ${price(r.line.awayPrice)})` : "not posted"}</dd>
          <dt>Total</dt>
          <dd className={s.num}>{r.line?.total != null ? `${r.line.total} (o ${price(r.line.overPrice)} / u ${price(r.line.underPrice)})` : "not posted"}</dd>
          <dt>Moneyline</dt>
          <dd className={s.num}>{r.line?.mlHome !== undefined || r.line?.mlAway !== undefined ? `${g.away.abbr} ${price(r.line?.mlAway)} · ${g.home.abbr} ${price(r.line?.mlHome)}` : "not posted"}</dd>
          <dt>Our ratings</dt>
          <dd className={s.num}>{`${g.home.short} ${signed(r.parts.ours.margin)}, total ${r.parts.ours.total.toFixed(1)}`}</dd>
          <dt>T-Rank</dt>
          <dd className={s.num}>{r.parts.trank ? `${g.home.short} ${signed(r.parts.trank.margin)}, total ${r.parts.trank.total.toFixed(1)}${r.rank.home || r.rank.away ? ` (ranks ${r.rank.away ?? "·"} at ${r.rank.home ?? "·"})` : ""}` : "not rated (non-Division I side)"}</dd>
          <dt>Blend</dt>
          <dd className={s.num}>{`${g.home.short} ${line(r.proj.spread)}, total ${r.proj.total}`}</dd>
          {(g.venue || g.note) && (
            <>
              <dt>Where</dt>
              <dd>{[g.note, g.venue, g.neutral ? "neutral site" : ""].filter(Boolean).join(" · ")}</dd>
            </>
          )}
          {x.saved && (
            <>
              <dt>Saved</dt>
              <dd className={s.num}>{`First read ${shortDate(x.saved.first.at)} ${tipTime(x.saved.first.at)} at ${x.saved.first.spread !== null ? `${g.home.abbr} ${line(x.saved.first.spread)}` : "no spread"}, total ${x.saved.first.total ?? "·"}`}</dd>
            </>
          )}
        </dl>
      </div>
  );
}

function Rows({ rows, m }: { rows: { x: CbbBoardRow; day: string }[]; m: Market }) {
  return (
    <div className={s.gtable}>
      <div className={`${s.gHead} ${s.ledgerHead}`} aria-hidden>
        <span>Game</span>
        <span>{m === "su" ? "Moneyline" : "DraftKings"}</span>
        <span>Ours</span>
        <span>Side</span>
        <span>Read</span>
        <span />
      </div>
      {rows.map(({ x, day }) => (
        <Row key={x.g.id} x={x} m={m} day={day} />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ board -- */

function BoardView({ b, m, filter }: { b: CbbBoard; m: Market; filter: "priced" | "all" }) {
  const rows = b.days.flatMap((d) => d.rows.map((x) => ({ x, day: d.day === b.today ? "" : shortDate(x.g.tip) })));
  const live = rows.filter(({ x }) => x.g.state === "in");
  const pre = rows.filter(({ x }) => x.g.state === "pre");
  const priced = pre.filter(({ x }) => x.read.line && (m === "ou" ? x.read.line.total !== null : m === "ats" ? x.read.line.spread !== null : x.read.line.mlHome !== undefined));
  const shown = [...live, ...(filter === "priced" ? priced : pre)];
  // Sort the priced board by how far we are off the market, biggest first, so the leans read top down.
  const key = ({ x }: { x: CbbBoardRow }) => (x.g.state === "in" ? 1e6 : (leanOf(x, m)?.size ?? 0) * (m === "su" ? 100 : 1));
  const sorted = filter === "priced" ? [...shown].sort((a, z) => key(z) - key(a)) : shown;
  const strong = priced.filter(({ x }) => {
    const l = leanOf(x, m);
    return l && l.tier !== "lean";
  }).length;
  const today = b.days.find((d) => d.day === b.today)?.rows ?? [];
  const finished = today.filter((x) => x.g.state === "post").length;
  return (
    <section className={s.section} aria-labelledby="cbb-slate">
      <SecHead
        id="cbb-slate"
        title={MARKET_NAME[m]}
        aside={`${pre.length} to tip in the next two days · ${priced.length} priced${m !== "su" ? ` · ${strong} strong lean${strong === 1 ? "" : "s"}` : ""}`}
      />
      <p className={s.p}>
        {m === "ats"
          ? `Our spread is a blend: a quarter our own ratings, three quarters T-Rank. Edge is the points between our number and DraftKings'. Strong means ${CBB_PARAMS.strong.toFixed(1)}+ points off the market (the top 30% of gaps); Big means 5+.`
          : m === "ou"
            ? `Our total blends our points ratings with T-Rank's tempo-free projection. Edge is points between ours and DraftKings'. Strong means ${CBB_PARAMS.strongTotal.toFixed(1)}+ points.`
            : `Our winner and its chance, from the blended margin and how far real margins miss it (about ${Math.round(CBB_PARAMS.sigma)} points either way).`}{" "}
        Every read is tracked; nothing here is staked.
      </p>
      <nav className={s.chips} aria-label="Which games" style={{ marginBottom: 12 }}>
        <Link className={s.chip} href={`${cbbHref(m, "week")}${cbbHref(m, "week").includes("?") ? "&" : "?"}show=priced`} aria-current={filter === "priced" ? "page" : undefined}>
          Priced, by edge
        </Link>
        <Link className={s.chip} href={`${cbbHref(m, "week")}${cbbHref(m, "week").includes("?") ? "&" : "?"}show=all`} aria-current={filter === "all" ? "page" : undefined}>
          Every game, by tip
        </Link>
      </nav>
      <div className={s.legendRow}>
        <span>
          <span className={`${s.readChip} ${s.readPend}`}>Big lean · tracked</span> 5+ pts off (spreads), 7+ (totals)
        </span>
        <span>
          <span className={`${s.readChip} ${s.readTrack}`}>Strong</span> top 30% of gaps in the backtest
        </span>
        <span>
          <span className={`${s.readChip} ${s.readPass}`}>Lean</span> any gap; &quot;both agree&quot; when our ratings and T-Rank are on the same side
        </span>
      </div>
      {sorted.length ? (
        <Rows rows={sorted} m={m} />
      ) : (
        <p className={s.calm}>
          {pre.length ? "No DraftKings numbers posted yet for the next two days. They usually land the day before tip. " : "No Division I games in the next two days. "}
          <Link href={`${cbbHref(m, "week")}${cbbHref(m, "week").includes("?") ? "&" : "?"}show=all`}>See every game</Link>.
        </p>
      )}
      {finished > 0 && (
        <p className={s.thin}>
          {`${finished} finished today: `}
          <Link href={cbbHref(m, "results")}>see Results</Link>.
        </p>
      )}
      <Background>
        <p className={s.p}>
          {`Our ratings fold in every Division I final this season (${b.finalsRated} so far) on top of where last season left them. T-Rank ${b.trankAt ? `was read ${shortDate(b.trankAt)} ${tipTime(b.trankAt)}` : "is unavailable right now, so the blend is our ratings alone"}; before games are played it is Torvik's preseason rating, which counts transfers and recruits. The pulse saves our number for every priced game within 36 hours of tip (the first save is the price it is graded at) and grades finals against the close.`}
        </p>
      </Background>
    </section>
  );
}

/* ---------------------------------------------------------------- results -- */

function ResultsView({ v, m }: { v: CbbRecord; m: Market }) {
  const recs = v.records.filter((r) => r.market === m);
  const head = recs[0];
  const done = v.games.filter((g) => g.final);
  const lean = SIGNALS.find((x) => x.market === m)!.id;
  const rows = done
    .flatMap((g) => signalsOf(g.first, v.strong).filter((x) => x.id === lean).map((x) => ({ g, side: x.side, res: graded(lean, x.side, g.first, g.final!) })))
    .filter((x) => x.res)
    .slice(0, 60);
  const what = m === "ats" ? "spread sides" : m === "ou" ? "totals" : "winners";
  return (
    <section className={s.section} aria-labelledby="cbb-results">
      <Hero
        eyebrow={`CBB ${v.season}-${String(v.season + 1).slice(2)} · ${MARKET_NAME[m]} · every game we priced`}
        title={
          <span id="cbb-results">
            {head && head.w + head.l ? (
              <>
                {head.units >= 0 ? "Up " : "Down "}
                <span className={head.units >= 0 ? s.up : s.down}>{units(head.units)}</span>
                {` on ${rec(head)} ${what}`}
              </>
            ) : (
              `No ${what} graded yet`
            )}
          </span>
        }
        sub={m === "su" ? "Our winner on every game at the saved moneyline, 1 unit each. Tracked only." : "Graded at the DraftKings number and price we first saved, 1 unit each. Closing-line value is how far the line moved toward our side by tip; it is the gate, since it settles faster than wins."}
      />
      <Stats label="Bet record" items={[{ k: "Bet record", v: betRecordTile(v.section).value, sub: betRecordTile(v.section).label.replace(/^Bet record · /, ""), tone: v.section.record.bets ? (v.section.record.units >= 0 ? "up" : "down") : undefined }, { k: `Every ${what.replace(/s$/, "")} we priced`, v: head && head.w + head.l ? units(head.units) : "0-0", sub: head ? rec(head) : "nothing graded" }]} />
      {m !== "su" && <SliceTable v={v} m={m} />}
      {m === "su" && (
      <div className={s.tw}>
        <table className={s.table}>
          <thead>
            <tr>
              <th>Signal</th>
              <th>Games</th>
              <th>Record</th>
              <th>Units</th>
              {m !== "su" && <th>CLV</th>}
              {m !== "su" && <th>t</th>}
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {recs.map((r: SignalRecord) => (
              <tr key={r.id}>
                <td>{r.label}</td>
                <td className={s.num}>{`${r.games} · ${r.weeks} wk`}</td>
                <td className={s.num}>{r.w + r.l + r.p ? rec(r) : "·"}</td>
                <td className={`${s.num} ${cls(r.units)}`}>{r.w + r.l ? units(r.units) : "·"}</td>
                {m !== "su" && <td className={`${s.num} ${r.clv !== null ? cls(r.clv) : ""}`}>{r.clv !== null ? `${signed(r.clv, 2)} pts` : "·"}</td>}
                {m !== "su" && <td className={s.num}>{r.t ?? "·"}</td>}
                <td className={r.verdict === "closer look" ? s.pos : r.verdict === "no edge" ? s.neg : s.dim}>{r.verdict}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}
      {m === "su" && <p className={`${s.notice} ${s.dim}`}>{`Straight up is tracked at the saved moneyline (games without one don't count). It earns a closer look at 200+ priced games over 4+ weeks in profit. Our winner picked 68.8% in the 2025-26 backtest.`}</p>}
      <div className={s.section}>
        <h3 className={s.h2}>Latest graded</h3>
        {!rows.length ? (
          <p className={s.dim}>Nothing graded yet. The season tips Nov 3; the first grades land the morning after.</p>
        ) : (
          <div className={s.tw}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th>Game</th>
                  <th>Our side</th>
                  <th>Final</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ g, side, res }) => (
                  <tr key={g.event}>
                    <td>{`${shortDate(g.tip)} · ${g.awayName} at ${g.homeName}`}</td>
                    <td className={s.num}>
                      {m === "ats"
                        ? side === "home"
                          ? `${g.homeName} ${line(g.first.spread ?? 0)}`
                          : `${g.awayName} ${line(-(g.first.spread ?? 0))}`
                        : m === "ou"
                          ? `${side === "over" ? "Over" : "Under"} ${g.first.total}`
                          : `${side === "home" ? g.homeName : g.awayName} ${price(side === "home" ? g.first.mlHome : g.first.mlAway)}`}
                    </td>
                    <td className={s.num}>{`${g.final!.away}-${g.final!.home}`}</td>
                    <td className={`${s.num} ${res!.r > 0 ? s.pos : res!.r < 0 ? s.neg : ""}`}>{res!.r > 0 ? `W ${units(res!.u)}` : res!.r < 0 ? "L −1.0u" : "Push"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

/* --------------------------------------------------------------- research -- */

type Bucket = { lo: number; hi: number | null; w: number; l: number; pct: number; units: number; t: number; move: number | null; moveT: number | null };

function ResearchView({ m }: { m: Market }) {
  const bt = BACKTEST as unknown as {
    fitAt: string;
    seasons: { ratings: string; blend: string; judged: string };
    accuracy: { games: number; priced: number; margin: { [k: string]: number }; total: { [k: string]: number } };
    straightUp: { hit: number; games: number; brier: number; bins: { lo: number; hi: number; games: number; said: number; won: number }[] };
    lines: { [k: string]: Bucket[] };
  };
  const mk = m === "ou" ? "total" : "spread";
  const acc = m === "ou" ? bt.accuracy.total : bt.accuracy.margin;
  const all = (k: string) => bt.lines[k].find((b) => b.lo === 0 && b.hi === null)!;
  return (
    <section className={s.section} aria-labelledby="cbb-research">
      <Hero
        eyebrow={`Backtest · fit ${bt.fitAt} · judged on ${bt.seasons.judged}`}
        title={<span id="cbb-research">{m === "su" ? `Picks ${Math.round((bt.straightUp.hit / bt.straightUp.games) * 100)}% of winners, and its chances hold up` : m === "ou" ? "Totals: no edge against the line" : "Spreads: close to the line, a small drift our way"}</span>}
        sub={`${bt.accuracy.games.toLocaleString()} Division I games neither fit saw (${bt.accuracy.priced.toLocaleString()} with a DraftKings number). Ratings constants fit on ${bt.seasons.ratings}; the blend's weights on ${bt.seasons.blend}.`}
      />
      <Stats
        label="Backtest summary"
        items={
          m === "su"
            ? [
                { k: "Winners picked", v: `${Math.round((bt.straightUp.hit / bt.straightUp.games) * 1000) / 10}%`, sub: `${bt.straightUp.hit.toLocaleString()} of ${bt.straightUp.games.toLocaleString()}` },
                { k: "Brier score", v: `${bt.straightUp.brier}`, sub: "0.25 is a coin flip; lower is better", small: true },
                { k: "Miss, typical game", v: `${CBB_PARAMS.sigma} pts`, sub: "spread of real margins around ours", small: true },
              ]
            : [
                { k: `${m === "ou" ? "Total" : "Margin"} miss, blend`, v: `${acc.blendPriced} pts`, sub: `closing line ${acc.close} · T-Rank ${acc.trank} · ours ${acc.ours}`, small: true },
                { k: "Our side at the close", v: `${(all(`${mk}:close`).pct * 100).toFixed(1)}%`, sub: `${all(`${mk}:close`).w}-${all(`${mk}:close`).l}, ${units(all(`${mk}:close`).units)} at −110`, tone: all(`${mk}:close`).units >= 0 ? "up" : "down" },
                { k: "Line move our way", v: `${signed(all(`${mk}:open`).move ?? 0, 2)} pts`, sub: `open to close, t ${all(`${mk}:open`).moveT}`, small: true },
              ]
        }
      />
      {m === "su" ? (
        <div className={s.tw}>
          <table className={s.table}>
            <thead>
              <tr>
                <th>Favorite&apos;s chance (ours)</th>
                <th>Games</th>
                <th>We said</th>
                <th>Won</th>
              </tr>
            </thead>
            <tbody>
              {bt.straightUp.bins.map((b) => (
                <tr key={b.lo}>
                  <td>{`${Math.round(b.lo * 100)}% to ${Math.round(b.hi * 100)}%`}</td>
                  <td className={s.num}>{b.games}</td>
                  <td className={s.num}>{pctOf(b.said)}</td>
                  <td className={`${s.num} ${Math.abs(b.won - b.said) <= 0.03 ? s.pos : ""}`}>{pctOf(b.won)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        (["open", "close"] as const).map((at) => (
          <div key={at} className={s.section}>
            <h3 className={s.h2}>{`Betting our side at the ${at === "open" ? "opener" : "close"}, by edge`}</h3>
            <div className={s.tw}>
              <table className={s.table}>
                <thead>
                  <tr>
                    <th>Edge</th>
                    <th>Record</th>
                    <th>Hit</th>
                    <th>Units</th>
                    <th>t</th>
                    {at === "open" && <th>Line moved our way</th>}
                  </tr>
                </thead>
                <tbody>
                  {bt.lines[`${mk}:${at}`].map((b) => (
                    <tr key={`${b.lo}-${b.hi}`} className={b.lo === 0 && b.hi === null ? c.totalRow : undefined}>
                      <td>{b.lo === 0 && b.hi === null ? "Every game" : `${b.lo} to ${b.hi ?? "up"} pts`}</td>
                      <td className={`${s.num} ${s.nw}`}>{`${b.w}-${b.l}`}</td>
                      <td className={`${s.num} ${b.pct > 0.524 ? s.pos : b.pct < 0.5 ? s.neg : ""}`}>{`${(b.pct * 100).toFixed(1)}%`}</td>
                      <td className={`${s.num} ${cls(b.units)}`}>{units(b.units)}</td>
                      <td className={s.num}>{b.t}</td>
                      {at === "open" && <td className={`${s.num} ${s.nw}`}>{b.move !== null ? `${signed(b.move, 2)} pts (t ${b.moveT})` : "·"}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))
      )}
      <details className={s.details} open>
        <summary>How the model works</summary>
        <div className={s.detailsBody}>
          <p className={s.p}>
            <b>Our ratings.</b> Every team has an offense (points over a Division I average) and a defense (points held under it). After each final both move toward what happened, faster for a team early in its season (its first games say the most) and slower once it has played a dozen. {`Home court is worth about ${CBB_PARAMS.rating.hfa} points.`} Last season&apos;s numbers carry into this one.
          </p>
          <p className={s.p}>
            <b>T-Rank.</b> Bart Torvik&apos;s adjusted efficiencies and tempo, turned into a score the KenPom way: possessions from both tempos, points from each offense against the other defense. Before the season his ratings are preseason projections that count transfers, recruits and returning minutes, which matters in the portal era. In the backtest, T-Rank alone missed by {bt.accuracy.margin.trank} points on the margin, ours by {bt.accuracy.margin.ours}.
          </p>
          <p className={s.p}>
            <b>The blend.</b> {`${Math.round(CBB_PARAMS.blend.margin.trank * 100)}% T-Rank and ${Math.round(CBB_PARAMS.blend.margin.ours * 100)}% ours on the margin, ${Math.round(CBB_PARAMS.blend.total.trank * 100)}% and ${Math.round(CBB_PARAMS.blend.total.ours * 100)}% on the total, weights fit on games before Jan 15 and judged after. Win chance assumes real margins land around ours with a typical miss of ${CBB_PARAMS.sigma} points (totals ${CBB_PARAMS.sigmaTotal}).`}
          </p>
          <p className={s.p}>
            <b>What it found.</b> Like every public rating, it trails the closing line by a fraction of a point, so betting every lean loses the vig. Two things are worth watching live: the line drifted toward our spread side between open and close (small, but steady), and the biggest spread gaps (5+ points) hit well at the opener in a small sample. Both opener results are a hint, not proof: the backtest&apos;s number could use results from after the line opened. Totals showed nothing. So it is tracked, not staked, and the Results tab says when a signal earns a closer look.
          </p>
        </div>
      </details>
    </section>
  );
}

/* ------------------------------------------------------------------- page -- */

export default async function CbbView({ view = "week", market = "ats", show = "priced" }: { view?: View; market?: Market; show?: "priced" | "all" }) {
  const m = market;
  const [b, v] = await Promise.all([view === "week" ? getCbbBoard().catch(() => null) : Promise.resolve(null), view === "results" || view === "log" ? getCbbRecord().catch(() => null) : Promise.resolve(null)]);
  const season = b?.season ?? v?.season ?? 2026;
  // The board reads ESPN on every load; Results and the log show finals as of the last tracking run.
  const updated = b ? new Date().toISOString() : await scoresAt("cbb");
  return (
    <main className={s.page}>
      <div className={s.wrap}>
        <header className={s.pageFrame}>
          <PageHead title="CBB" sub="Every Division I game: our number against DraftKings', tracked from tip one." asof={`NCAAB ${season}-${String(season + 1).slice(2)}`} updated={view === "research" ? null : updated} />
          <div className={s.controlBar}>
            <ScopeRow groups={scopeGroups("cbb", m, view)} />
            <ViewTabs {...viewTabs("cbb", m, view, [{ key: "bracket", label: "Bracket lab", href: "/picks/cbb/bracket" }])} />
          </div>
        </header>
        {view === "results" ? (
          v ? (
            <ResultsView v={v} m={m} />
          ) : (
            <div className={s.error} role="alert">
              Couldn&apos;t load the college hoops record right now. Try again in a few minutes.
            </div>
          )
        ) : view === "log" ? (
          v ? (
            <LogView v={v} m={m} />
          ) : (
            <div className={s.error} role="alert">
              Couldn&apos;t load the learner right now. Try again in a few minutes.
            </div>
          )
        ) : view === "research" ? (
          <ResearchView m={m} />
        ) : b ? (
          <BoardView b={b} m={m} filter={show} />
        ) : (
          <div className={s.error} role="alert">
            Couldn&apos;t load the college hoops slate right now. Try again in a few minutes.
          </div>
        )}
        <footer className={s.footer}>
          <span>
            Sources: <a href="https://barttorvik.com/">Bart Torvik&apos;s T-Rank</a>, ESPN finals. Lines: DraftKings via ESPN. Model output, not betting advice.
          </span>
          {b?.problems.map((t) => (
            <span key={t}>{t}</span>
          ))}
        </footer>
      </div>
    </main>
  );
}
