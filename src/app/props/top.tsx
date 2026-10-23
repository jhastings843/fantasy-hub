// The top of each Props tab (2026-10-21 redesign): one headline that says
// whether anything is a bet, the biggest edges each of our models sees right
// now with our chance against the market's, and how close each model is to
// real bets. The full boards sit below it, every game one click deep.
import type { SectionView } from "@/lib/learning/engine";
import { implied } from "@/lib/props/parse";
import { getOurNbaView, type OurNbaView } from "@/lib/models/nba/store";
import { getOurNflView, type OurNflView } from "@/lib/models/nfl/store";
import { getOurFtdView, type OurFtdView } from "@/lib/models/nfl/ftd-store";
import { noVig } from "@/lib/models/nba/market";
import { kalshiCost, kalshiFor } from "@/lib/firsttd/trends";
import { pricedPlayers } from "@/lib/firsttd/parse";
import { CutRanges, Hero, LearnerLog, ModelLineup, TrackingProgress, engineEntry, type LogEntry, type ModelRow } from "../picks/board";
import { trackRows } from "./learning";
import s from "../picks/picks.module.css";

const TOP = 4;
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const am = (p: number) => (p > 0 ? `+${p}` : `${p}`);
const SHORT: { [k: string]: string } = { pts: "pts", reb: "reb", ast: "ast", threes: "threes", pass_yds: "pass yds", rush_yds: "rush yds", rec_yds: "rec yds", rec: "rec" };
const sideWord = (x: "over" | "under") => (x === "over" ? "Over" : "Under");

interface EdgeRow {
  key: string;
  who: string;
  game: string;
  bet: string;
  ours: number;
  mkt: number;
}

export interface Product {
  name: string;
  meta: string;
  rows: EdgeRow[];
  empty: string;
  learning: SectionView;
}

/** Our chance next to the market's, as two bars scaled to the larger. */
function Bars({ ours, mkt }: { ours: number; mkt: number }) {
  const top = Math.max(ours, mkt, 0.01);
  return (
    <span className={s.bars} aria-label={`Ours ${pct(ours)}, market ${pct(mkt)}`}>
      <span>
        <i className={s.barOurs} style={{ width: `${(ours / top) * 80}px` }} />
        {pct(ours)}
      </span>
      <span style={{ color: "var(--ink2)" }}>
        <i className={s.barMkt} style={{ width: `${(mkt / top) * 80}px` }} />
        {pct(mkt)}
      </span>
    </span>
  );
}

function EdgeCard({ p }: { p: Product }) {
  return (
    <section className={s.edgeCard} aria-label={p.name}>
      <div className={s.edgeHead}>
        <h3>{p.name}</h3>
        <span>{p.meta}</span>
      </div>
      {p.rows.length ? (
        p.rows.map((r) => (
          <div key={r.key} className={s.edgeRow}>
            <span className={s.edgeWho}>
              <b>
                {`${r.who} `}
                <span>{r.game}</span>
              </b>
              <span>{r.bet}</span>
            </span>
            <Bars ours={r.ours} mkt={r.mkt} />
          </div>
        ))
      ) : (
        <p className={s.thin}>{p.empty}</p>
      )}
    </section>
  );
}

/** The game count the closest slice has toward its section's gate. */
function Gate({ items }: { items: Product[] }) {
  return (
    <div className={s.gate}>
      {items.map((p) => {
        const best = Math.max(0, ...p.learning.entries.map((e) => e.ev?.games ?? 0));
        const live = p.learning.entries.filter((e) => e.status === "active").length;
        const need = p.learning.gate.minGames;
        return (
          <div key={p.name}>
            <b>{p.name}</b>
            <span className={s.gateBar}>
              <i style={{ width: `${Math.min(100, (best / need) * 100)}%` }} />
            </span>
            <span className={`${s.num} ${s.statK}`}>{live ? `${live} slice${live > 1 ? "s" : ""} live` : `${best} of ${need} games graded`}</span>
          </div>
        );
      })}
    </div>
  );
}

const nowMs = () => Date.now();

function nbaProducts(v: OurNbaView): Product[] {
  const now = nowMs();
  const ahead = v.board.filter((g) => !g.kickoff || Date.parse(g.kickoff) > now);
  const props: EdgeRow[] = ahead
    .flatMap((g) =>
      g.game.markets
        .filter((m) => m.clears && m.side && m.gap !== null)
        .map((m) => {
          const dk = m.books[0];
          const fair = dk.over !== null && dk.under !== null ? noVig(dk.over, dk.under)[m.side!] : 0.5;
          return { key: `${g.game.slug}|${m.id}`, who: m.player, game: `${g.away} at ${g.home}`, bet: `${sideWord(m.side!)} ${m.line} ${SHORT[m.stat ?? ""] ?? ""}${dk[m.side!] !== null ? ` · ${am(dk[m.side!]!)}` : ""}`, ours: g.extra[m.id]?.[m.side!] ?? 0, mkt: fair, gap: m.gap! };
        }),
    )
    .sort((a, b) => b.gap - a.gap)
    .slice(0, TOP);
  const fb: EdgeRow[] = ahead
    .flatMap((g) => (g.fb?.players ?? []).filter((x) => x.edge && x.price !== null).map((x) => ({ key: `${g.game.slug}|fb|${x.id}`, who: x.name, game: `${g.away} at ${g.home}`, bet: `First basket · ${am(x.price!)}`, ours: x.p, mkt: x.fair ?? implied(x.price!), gap: x.p - implied(x.price!) })))
    .sort((a, b) => b.gap - a.gap)
    .slice(0, TOP);
  const games = ahead.length;
  return [
    { name: "NBA props", meta: `${games} game${games === 1 ? "" : "s"} ahead · DraftKings`, rows: props, empty: "No edges on games still to tip.", learning: v.learning },
    { name: "First Basket", meta: "DraftKings, vig removed across the field", rows: fb, empty: "No First Basket edges on games still to tip.", learning: v.fb.learning },
  ];
}

function nflProducts(v: OurNflView, f: OurFtdView): Product[] {
  const now = nowMs();
  const props: EdgeRow[] = v.board
    .filter((g) => !g.kickoff || Date.parse(g.kickoff) > now)
    .flatMap((g) =>
      g.game.markets
        .filter((m) => m.clears && m.side && m.gap !== null)
        .map((m) => {
          const dk = m.books[0];
          const assumed = g.extra[m.id]?.price === "assumed";
          return { key: `${g.game.slug}|${m.id}`, who: m.player, game: `${g.away} at ${g.home}`, bet: `${sideWord(m.side!)} ${m.line} ${SHORT[m.stat ?? ""] ?? ""} · ${am(dk[m.side!] ?? -110)}${assumed ? " assumed" : ""}`, ours: g.extra[m.id]?.[m.side!] ?? 0, mkt: noVig(dk.over ?? -110, dk.under ?? -110)[m.side!], gap: m.gap! };
        }),
    )
    .sort((a, b) => b.gap - a.gap)
    .slice(0, TOP);
  const ftd: EdgeRow[] = f.board
    .filter((g) => !g.kickoff || Date.parse(g.kickoff) > now)
    .flatMap((g) =>
      pricedPlayers(g.game).flatMap((p) => {
        const k = kalshiFor(g.kalshi, p.name);
        const cost = k?.ask ? kalshiCost(k.ask) : null;
        return cost !== null && p.p > cost ? [{ key: `${g.game.slug}|${p.key}`, who: p.name, game: `${g.game.away} at ${g.game.home}`, bet: `First TD · Kalshi ${Math.round(cost * 100)}¢`, ours: p.p, mkt: cost, gap: p.p - cost }] : [];
      }),
    )
    .sort((a, b) => b.gap - a.gap)
    .slice(0, TOP);
  return [
    { name: "NFL props", meta: v.week ? `Week ${v.week} · DraftKings` : "DraftKings", rows: props, empty: "No edges on games still to kick off.", learning: v.learning },
    { name: "First TD", meta: f.week ? `Week ${f.week} · against Kalshi` : "against Kalshi", rows: ftd, empty: "Nobody above Kalshi's cost on games still to kick off.", learning: f.learning },
  ];
}

export async function loadProducts(sport: "nfl" | "nba", season: number): Promise<Product[] | null> {
  if (sport === "nba") {
    const v = await getOurNbaView(season).catch(() => null);
    return v ? nbaProducts(v) : null;
  }
  const [v, f] = await Promise.all([getOurNflView(season).catch(() => null), getOurFtdView(season).catch(() => null)]);
  return v && f ? nflProducts(v, f) : null;
}

/**
 * Who decides a Props market: our own model only (Sam is never part of Props).
 * "Sets real stakes" only when a learner slice is live; otherwise its edges are tracked.
 */
const LINEUP: { [k in "pp" | "ftd" | "nba" | "fb"]: { product: string; model: string; role: string; prices: string } } = {
  pp: { product: "NFL props", model: "Hobby Hub NFL prop model", role: "Pass, rush and receiving yards and catches", prices: "DraftKings prices come from one game-day morning read; a prop without a price shows our number and no edge. David's line is shown for comparison only." },
  ftd: { product: "First TD", model: "Hobby Hub First TD model", role: "Team to score first, then the scorer", prices: "Compared with Kalshi (fee in), DraftKings and FanDuel; an edge beats the cheapest." },
  nba: { product: "NBA props", model: "Hobby Hub NBA prop model", role: "Points, rebounds, assists and threes", prices: "A player needs 3 games this season before an edge counts." },
  fb: { product: "First Basket", model: "Hobby Hub First Basket model", role: "Tip chance and each starter's share of first shots", prices: "DraftKings prices read the morning of the game." },
};
export async function PropsLineup({ tab, season }: { tab: "pp" | "ftd" | "nba" | "fb" | "kotc"; season: number }) {
  if (tab === "kotc")
    return (
      <ModelLineup
        title="Who decides King of the Court"
        aside="Projections only. Nothing is staked."
        models={[
          { name: "Slate simulation", role: "Chance to lead the slate in points + rebounds + assists", status: "projections", note: "Simulated slates, saved before the first tip and graded after the last final. No stakes." },
          { name: "Crowd model", role: "Who else backs each player", status: "unavailable", note: "Not built, so the payout share can't be estimated. A chance to lead is not a price." },
        ]}
      />
    );
  const L = LINEUP[tab];
  const items = await loadProducts(tab === "nba" || tab === "fb" ? "nba" : "nfl", season);
  const p = items?.find((x) => x.name === L.product);
  const entries = p?.learning.entries ?? [];
  const live = entries.filter((e) => e.status === "active");
  const gate = p?.learning.gate;
  const best = entries.filter((e) => e.status === "collecting").reduce((a, e) => Math.max(a, e.ev?.games ?? 0), 0);
  const model: ModelRow = {
    name: L.model,
    role: L.role,
    status: !p ? "unavailable" : live.length ? "active" : "collecting",
    note: !p
      ? "Couldn't read this model's learning just now."
      : live.length
        ? `${live.length} slice${live.length === 1 ? " is" : "s are"} live for real stakes: ${live.map((e) => e.label).join(", ")}. Everything else is tracked. ${L.prices}`
        : `Edges are tracked only: no slice has cleared its gate (closest ${best} of ${gate?.minGames ?? 30} games). ${L.prices}`,
  };
  return <ModelLineup title={`Who decides ${L.product}`} aside={live.length ? "Live slices set stakes. Everything else is tracked." : "Nothing here carries a stake."} models={[model]} />;
}

export async function PropsTop({ sport, season }: { sport: "nfl" | "nba"; season: number }) {
  const items = await loadProducts(sport, season);
  if (!items) return null;
  const live = items.reduce((a, p) => a + p.learning.entries.filter((e) => e.status === "active").length, 0);
  const edges = items.reduce((a, p) => a + p.rows.length, 0);
  return (
    <section className={s.section} aria-labelledby="props-top">
      <Hero
        eyebrow={sport === "nba" ? "NBA · our props and First Basket models" : "NFL · our props and First TD models"}
        title={<span id="props-top">{live ? `${live} prop slice${live > 1 ? "s" : ""} live` : "No prop bets yet"}</span>}
        sub={
          live
            ? "Edges in a live slice are bets; the rest are tracking."
            : `Our models are tracking. An edge becomes a bet once its slice clears the learning gate.${edges ? " The biggest edges right now:" : ""}`
        }
      />
      <div className={s.edgeGrid}>
        {items.map((p) => (
          <EdgeCard key={p.name} p={p} />
        ))}
      </div>
      <div className={s.mKey}>
        <span>
          <i style={{ background: "var(--accent)", width: 18, height: 7, borderRadius: 4 }} />
          Our chance
        </span>
        <span>
          <i style={{ background: "var(--ink2)", opacity: 0.55, width: 18, height: 7, borderRadius: 4 }} />
          Market&apos;s chance, vig removed (Kalshi: its cost)
        </span>
      </div>
      <Gate items={items} />
    </section>
  );
}

/** The Props Learner log for one tab's market: its journal in plain language, with the gate detail one click down. */
export async function PropsLog({ tab, season }: { tab: "pp" | "ftd" | "nba" | "fb"; season: number }) {
  const all = await loadProducts(tab === "nba" || tab === "fb" ? "nba" : "nfl", season);
  const want = { pp: "NFL props", ftd: "First TD", nba: "NBA props", fb: "First Basket" }[tab];
  const items = all?.filter((p) => p.name === want) ?? null;
  if (!items) return <p className={s.calm}>The learning sections couldn&apos;t be read just now. Try again in a minute.</p>;
  const entries: LogEntry[] = items
    .flatMap((p) => p.learning.journal.filter((j) => j.kind !== "review" || /went live|rolled back|registered/i.test(j.text)).map((j) => engineEntry(j, p.name)))
    .sort((a, b) => b.at.localeCompare(a.at));
  const reviews = items.flatMap((p) => p.learning.journal.filter((j) => j.kind === "review").slice(0, 1).map((j) => engineEntry(j, p.name)));
  return (
    <section className={s.section} aria-labelledby="props-log">
      <Hero
        eyebrow={`${want} · what changed, and why`}
        title={<span id="props-log">Learner log</span>}
        sub={`Every slice is tracked from the day it was first seen, on later games only. It goes live at ${tab === "pp" || tab === "nba" ? "30+ games over 3+ weeks and 100+ bets" : "60+ games over 4+ weeks and 12+ winners (long prices)"} with a clear edge, and is rolled back if it starts losing.`}
      />
      <TrackingProgress
        rows={items.flatMap((p) => trackRows(p.learning, items.length > 1 ? `${p.name}: ` : ""))}
        sub="Each one counts only games after it was first tracked, and bets for real once it clears its gate."
        empty="Nothing registered yet. Slices register at this section's next data pull."
      />
      <div className={s.section}>
        <h3 className={s.h2}>Latest</h3>
        <LearnerLog entries={[...entries, ...reviews].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 20)} empty="Nothing recorded yet. Each section's first review runs at its next data pull." />
      </div>
      <div className={s.section}>
        <h3 className={s.h2}>Cut comparisons</h3>
        <p className={s.p}>Every slice&apos;s tracked bets since it was first seen, at the saved prices. Long-price markets (first TD, first basket) show units instead of a break-even line.</p>
        {items.map((p, i) => (
          <CutRanges
            key={p.name}
            title={p.name}
            open={i === 0}
            rows={p.learning.entries
              .filter((e) => (e.ev?.bets ?? 0) > 0)
              .map((e) => ({ label: e.label, w: e.ev!.wins, l: e.ev!.bets - e.ev!.wins, be: tab === "pp" || tab === "nba" ? 0.524 : undefined, units: e.ev!.units }))}
          />
        ))}
      </div>
    </section>
  );
}
