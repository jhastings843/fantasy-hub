import Link from "next/link";
import { getPicksReport, SOURCES, type PicksReport } from "@/lib/picks/report";
import type { League } from "@/lib/picks/parse";
import { OUTSTANDING_CAP, WEEKLY_CAP } from "@/lib/picks/limits";
import { getPoolShares, getPoolTrack } from "@/lib/picks/pool-store";
import { AtsResearch, AtsResults, AtsWeek } from "./ats";
import { SuResearch, SuResults, SuWeek, TotalsResearch, TotalsResults, TotalsWeek } from "./su-totals";
import { PoolCard } from "./pool";
import { HarrisCard } from "./harris";
import { FOOTBALL_VIEWS, LEAGUE_NAME, MARKETS, href, kickoffEt, rec, units, type Market, type View } from "./ui";
import { Background, Stats } from "./board";
import { PicksLog } from "./log";
import { redisStore } from "@/lib/picks/learning/store";
import WeekSearch from "./WeekSearch";
import { picksSearchIndex } from "./search";
import s from "./picks.module.css";

// The Picks tab. Sport, then market, then view, all in the URL (?m=, ?v=),
// so a view can be shared, survives a refresh and works with Back. The
// current picks come first; history, research and method sit behind the
// Results and Research views and inside disclosures.

export default async function PicksView({ league, market: asked, view }: { league: League; market: Market; view: View }) {
  const market: Market = asked;
  const fresh = await getPicksReport(league).catch(() => null);
  const r = fresh?.value ?? null;
  const other: League = league === "nfl" ? "cfb" : "nfl";
  // The pool's pick shares, for "how much of the pool was on the winner" on finished games.
  const poolShares =
    r?.week && league === "nfl" && market === "su" && view === "week" ? ((await getPoolShares(r.week).catch(() => null))?.value ?? null) : null;
  // The Sleeper pool entry, graded in the background (Results only).
  const poolTrack = league === "nfl" && market === "su" && view === "results" ? ((await getPoolTrack().catch(() => null))?.value ?? null) : null;

  const sportNav = (
    <nav className={s.chips} aria-label="Sport">
      {(["nfl", "cfb"] as const).map((l) => (
        <Link key={l} className={s.chip} href={href(l, market, view)} aria-current={l === league ? "page" : undefined}>
          {LEAGUE_NAME[l]}
        </Link>
      ))}
      <Link className={s.chip} href="/picks/nba">
        NBA
      </Link>
    </nav>
  );
  const review = await redisStore.state().catch(() => null);
  const testing = (review?.decisions ?? []).filter((d) => (d.id.startsWith(`${league}:`) || d.id.startsWith("both:")) && d.verdict === "retain").length;

  if (!r) {
    return (
      <main className={s.page}>
        <div className={s.wrap}>
          {sportNav}
          <div className={s.error} role="alert">
            Couldn&apos;t load either model&apos;s pages right now, and there&apos;s no saved copy yet. Try again in a few
            minutes. The <Link href={href(other, market, view)}>{LEAGUE_NAME[other]}</Link> tab may still load.
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className={s.page}>
      <div className={s.wrap}>
        <header className={s.header}>
          <h1 className={s.eyebrow} style={{ margin: 0 }}>{`Picks · ${LEAGUE_NAME[league]} ${r.season}${r.week ? ` · Week ${r.week}` : ""}`}</h1>
          <div className={s.navRows}>
            {sportNav}
            <nav className={s.chips} aria-label="Market">
              {MARKETS.map((m) => (
                <Link key={m.id} href={href(league, m.id, view)} aria-current={m.id === market ? "page" : undefined} className={s.chip}>
                  {m.label}
                </Link>
              ))}
            </nav>
          </div>
          <nav className={`${s.tabs} ${s.tabsSoft}`} aria-label="View">
            {FOOTBALL_VIEWS.map((v) => (
              <Link key={v.id} href={href(league, market, v.id)} aria-current={v.id === view ? "page" : undefined} className={s.tab}>
                {v.label}
              </Link>
            ))}
          </nav>
          <TopStats r={r} testing={testing} logHref={href(league, market, "log")} />
          <Warnings r={r} coreStale={fresh?.stale ?? false} />
          {r.board.length > 0 && view === "week" && (
            <WeekSearch
              entries={picksSearchIndex(r)}
              label={`Search ${r.week ? `Week ${r.week}` : "this week"}: spread, winner and total`}
              placeholder={league === "nfl" ? "Team, e.g. Bills or KC" : "Team, e.g. Ohio State"}
            />
          )}
        </header>

        {market === "ats" && view === "week" && <AtsWeek r={r} />}
        {market === "ats" && view === "results" && <AtsResults r={r} />}
        {market === "ats" && view === "research" && <AtsResearch r={r} harris={league === "cfb" ? <HarrisCard /> : undefined} />}
        {market === "su" && view === "week" && league === "nfl" && <PoolCard />}
        {market === "su" && view === "week" && <SuWeek r={r} poolShares={poolShares} />}
        {market === "su" && view === "results" && <SuResults r={r} poolTrack={poolTrack} />}
        {market === "su" && view === "research" && <SuResearch r={r} />}
        {market === "ou" && view === "week" && <TotalsWeek r={r} />}
        {market === "ou" && view === "results" && <TotalsResults r={r} />}
        {market === "ou" && view === "research" && <TotalsResearch r={r} />}
        {view === "log" && <PicksLog league={league} market={market} />}

        <Background title="Budget and exposure">
          <RiskStrip r={r} coreStale={fresh?.stale ?? false} coreAt={fresh?.at ?? r.generatedAt} />
          {r.board.length > 0 && <p className={`${s.progress} ${s.num}`}>{`${r.board.filter((g) => g.final).length}/${r.board.length} games have completed`}</p>}
        </Background>

        <footer className={s.footer}>
          <span>
            Sources: <a href={SOURCES[league].davidBoard}>David Sasser</a> and <a href={SOURCES[league].samRecord}>Sam&apos;s Models</a>
            {league === "cfb" ? ", plus PEM (@FansOfCFB) cards" : ""}. Current lines: DraftKings via ESPN. Model output and a
            backtest, not betting advice.
          </span>
          {r.notes.map((t) => (
            <span key={t}>{t}</span>
          ))}
        </footer>
      </div>
    </main>
  );
}

/** The four numbers that matter, on every view: season, this week, the rule in force, the learner. */
function TopStats({ r, testing, logHref }: { r: PicksReport; testing: number; logHref: string }) {
  const u = r.units.total;
  const wk = r.units.byWeek.find((w) => w.week === r.week)?.ledger;
  const rule = r.strategies.rule;
  return (
    <Stats
      label="Season, this week, rule and learner"
      items={[
        { k: `Season (${LEAGUE_NAME[r.league]})`, v: u.w + u.l + u.p ? units(u.units) : "0-0", sub: u.w + u.l + u.p ? `${rec(u)} at the price taken` : "no bets settled", tone: u.w + u.l ? (u.units >= 0 ? "up" : "down") : undefined },
        { k: "This week", v: wk && wk.w + wk.l + wk.p ? rec(wk) : "0-0", sub: `${r.board.filter((g) => g.final).length} of ${r.board.length} games final` },
        { k: "Rule in force", v: rule ? rule.label : "None yet", sub: rule ? `${rec(rule.record)} since tracking` : "nothing clears the bar", small: true },
        { k: "Learner", v: `${testing} idea${testing === 1 ? "" : "s"} testing`, sub: <Link href={logHref}>Open the log</Link>, small: true },
      ]}
    />
  );
}

/** The one cross-market summary: budget, open exposure, season units, line freshness. */
function RiskStrip({ r, coreStale, coreAt }: { r: PicksReport; coreStale: boolean; coreAt: string }) {
  const a = r.allocation;
  const u = r.units.total;
  return (
    <dl className={s.strip} aria-label="Risk and freshness">
      <div>
        <dt>{`This week, both sports (${WEEKLY_CAP}u)`}</dt>
        <dd className={s.num}>
          {[
            a.exposure.weekly ? `${a.exposure.weekly}u issued` : null,
            `${a.used}u on board`,
            a.rivalHeld ? `${a.rivalHeld}u held for ${LEAGUE_NAME[r.league === "nfl" ? "cfb" : "nfl"]}` : null,
          ]
            .filter(Boolean)
            .join(" + ")}
        </dd>
      </div>
      <div>
        <dt>Open, both sports</dt>
        <dd className={s.num}>{`${a.exposure.outstanding}u of ${OUTSTANDING_CAP}u`}</dd>
      </div>
      <div>
        <dt>{`Season (${LEAGUE_NAME[r.league]})`}</dt>
        <dd className={`${s.num} ${u.w + u.l ? (u.units >= 0 ? s.pos : s.neg) : ""}`}>{u.w + u.l + u.p ? `${units(u.units)} · ${rec(u)}` : "no bets settled"}</dd>
      </div>
      <div>
        <dt>Updated</dt>
        <dd className={s.num}>
          <span className={r.reference.stale ? s.neg : ""}>{`lines ${r.reference.fetchedAt ? kickoffEt(r.reference.fetchedAt) : "not yet"}`}</span>
          {" · "}
          <span className={coreStale ? s.neg : ""}>{`models ${kickoffEt(coreAt)}`}</span>
        </dd>
      </div>
    </dl>
  );
}

/** Anything that makes this page less trustworthy right now. Never hidden. */
function Warnings({ r, coreStale }: { r: PicksReport; coreStale: boolean }) {
  const items = [
    r.reference.stale ? "Lines are stale: shown for reference, not offered as bets until they refresh." : "",
    r.reference.problem ?? "",
    coreStale ? "Showing the last good copy of the model boards: one of the sites didn't load on the latest try." : "",
    ...r.errors.map((e) => `Couldn't read ${e}`),
  ].filter(Boolean);
  if (!items.length) return null;
  return (
    <div className={s.scope} role="status">
      {items.map((t) => (
        <span key={t}>{t}</span>
      ))}
    </div>
  );
}
