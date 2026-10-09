import Link from "next/link";
import { getPicksReport, SOURCES, type PicksReport } from "@/lib/picks/report";
import type { League } from "@/lib/picks/parse";
import { OUTSTANDING_CAP, WEEKLY_CAP } from "@/lib/picks/limits";
import { AtsResearch, AtsResults, AtsWeek } from "./ats";
import { SuResearch, SuResults, SuWeek, TotalsResearch, TotalsResults, TotalsWeek } from "./su-totals";
import { LearningPanel } from "./learning";
import { PoolCard } from "./pool";
import { HarrisCard } from "./harris";
import { LEAGUE_NAME, MARKETS, VIEWS, href, kickoffEt, rec, units, type Market, type View } from "./ui";
import s from "./picks.module.css";

// The Picks tab. Sport, then market, then view, all in the URL (?m=, ?v=),
// so a view can be shared, survives a refresh and works with Back. The
// current picks come first; history, research and method sit behind the
// Results and Research views and inside disclosures.

export default async function PicksView({ league, market, view }: { league: League; market: Market; view: View }) {
  const fresh = await getPicksReport(league).catch(() => null);
  const r = fresh?.value ?? null;
  const other: League = league === "nfl" ? "cfb" : "nfl";

  const sportNav = (
    <nav className={s.subnav} aria-label="Sport">
      {(["nfl", "cfb"] as const).map((l) => (
        <Link key={l} href={href(l, market, view)} aria-current={l === league ? "page" : undefined}>
          {LEAGUE_NAME[l]}
        </Link>
      ))}
    </nav>
  );

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
          <div className={s.headRow}>
            {sportNav}
            <span className={s.eyebrow}>{`${LEAGUE_NAME[league]} ${r.season}${r.week ? ` · Week ${r.week}` : ""}`}</span>
          </div>
          <h1 className={s.h1}>Picks</h1>
          <RiskStrip r={r} coreStale={fresh?.stale ?? false} coreAt={fresh?.at ?? r.generatedAt} />
          {r.board.length > 0 && (
            <p className={`${s.progress} ${s.num}`}>
              {`${r.board.filter((g) => g.final).length}/${r.board.length} games have completed`}
            </p>
          )}
          <Warnings r={r} coreStale={fresh?.stale ?? false} />
          <nav className={s.tabs} aria-label="Market">
            {MARKETS.map((m) => (
              <Link key={m.id} href={href(league, m.id, view)} aria-current={m.id === market ? "page" : undefined} className={s.tab}>
                {m.label}
              </Link>
            ))}
          </nav>
          <nav className={`${s.tabs} ${s.tabsSoft}`} aria-label="View">
            {VIEWS.map((v) => (
              <Link key={v.id} href={href(league, market, v.id)} aria-current={v.id === view ? "page" : undefined} className={s.tab}>
                {v.label}
              </Link>
            ))}
          </nav>
        </header>

        {market === "ats" && view === "week" && <AtsWeek r={r} />}
        {market === "ats" && view === "results" && <AtsResults r={r} />}
        {market === "ats" && view === "research" && <AtsResearch r={r} />}
        {market === "ats" && view === "research" && league === "cfb" && <HarrisCard />}
        {market === "su" && view === "week" && league === "nfl" && <PoolCard />}
        {market === "su" && view === "week" && <SuWeek r={r} />}
        {market === "su" && view === "results" && <SuResults r={r} />}
        {market === "su" && view === "research" && <SuResearch r={r} />}
        {market === "ou" && view === "week" && <TotalsWeek r={r} />}
        {market === "ou" && view === "results" && <TotalsResults r={r} />}
        {market === "ou" && view === "research" && <TotalsResearch r={r} />}
        {view === "research" && <LearningPanel league={league} />}

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
