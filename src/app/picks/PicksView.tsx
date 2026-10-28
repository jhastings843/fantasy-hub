import Link from "next/link";
import { getPicksReport, SOURCES, type PicksReport } from "@/lib/picks/report";
import type { League } from "@/lib/picks/parse";
import { OUTSTANDING_CAP, WEEKLY_CAP } from "@/lib/picks/limits";
import { getPoolShares, getPoolTrack } from "@/lib/picks/pool-store";
import { AtsResearch, AtsResults, AtsWeek } from "./ats";
import { SuResearch, SuResults, SuWeek, TotalsResearch, TotalsResults, TotalsWeek } from "./su-totals";
import { PoolCard } from "./pool";
import { HarrisCard } from "./harris";
import { OurSpreadCard } from "./ours";
import { CfbModelCard } from "./cfb-model";
import { FOOTBALL_VIEWS, LEAGUE_NAME, MARKETS, href, kickoffEt, rec, units, type Market, type View } from "./ui";
import { Background, ModelLineup, PageHead, Stats, type ModelRow } from "./board";
import { sourceState, type PicksPolicy } from "@/lib/picks/policy";
import { scoreboard } from "@/lib/live/espn";
import { AutoRefresh } from "@/components/AutoRefresh";
import { PicksLog } from "./log";
import { redisStore } from "@/lib/picks/learning/store";
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
  const [review, active] = await Promise.all([redisStore.state().catch(() => null), redisStore.active().catch(() => null)]);
  // Live scores only when a game on the board is under way (ESPN, free); the page then refreshes every 10 minutes.
  const anyLive = r?.board.some((g) => g.basis === "started" && !g.final) ?? false;
  const live = anyLive && view === "week" ? await scoreboard(league).catch(() => []) : [];
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
        <header className={s.pageFrame}>
          <PageHead
            title={`${LEAGUE_NAME[league]} picks`}
            sub={`${r.week ? `Week ${r.week}. ` : ""}Which model moves money here, and what each game reads.`}
            asof={`${LEAGUE_NAME[league]} ${r.season}`}
          />
          <div className={s.controlBar}>
            {sportNav}
            <nav className={s.chips} aria-label="Market">
              {MARKETS.map((m) => (
                <Link key={m.id} href={href(league, m.id, view)} aria-current={m.id === market ? "page" : undefined} className={s.chip}>
                  {m.label}
                </Link>
              ))}
            </nav>
            <nav className={s.chips} aria-label="View">
              {FOOTBALL_VIEWS.map((v) => (
                <Link key={v.id} href={href(league, market, v.id)} aria-current={v.id === view ? "page" : undefined} className={s.chip}>
                  {v.id === "week" ? "Board" : v.label}
                </Link>
              ))}
            </nav>
            {anyLive && view === "week" && (
              <span className={s.liveRefresh}>
                <AutoRefresh intervalMs={600_000} label="Live games: refreshing every" />
              </span>
            )}
          </div>
          <Warnings r={r} coreStale={fresh?.stale ?? false} />
          {view !== "week" && <TopStats r={r} testing={testing} logHref={href(league, market, "log")} />}
        </header>
        {view === "week" && <ModelLineup title={`Who decides ${LEAGUE_NAME[league]} ${MARKETS.find((m) => m.id === market)!.label.toLowerCase()}`} aside={lineupAside(r, market)} models={lineup(r, market, active)} />}

        {market === "ats" && view === "week" && <AtsWeek r={r} live={live} />}
        {market === "ats" && view === "results" && <AtsResults r={r} />}
        {market === "ats" && view === "research" && <AtsResearch r={r} panel={league === "cfb" ? <><HarrisCard /><CfbModelCard season={r.season} /></> : <OurSpreadCard season={r.season} />} />}
        {market === "su" && view === "week" && league === "nfl" && <PoolCard />}
        {market === "su" && view === "week" && <SuWeek r={r} poolShares={poolShares} />}
        {market === "su" && view === "results" && <SuResults r={r} poolTrack={poolTrack} />}
        {market === "su" && view === "research" && <SuResearch r={r} />}
        {market === "ou" && view === "week" && <TotalsWeek r={r} live={live} />}
        {market === "ou" && view === "results" && <TotalsResults r={r} />}
        {market === "ou" && view === "research" && <TotalsResearch r={r} />}
        {view === "log" && <PicksLog league={league} market={market} />}
        {view === "week" && <TopStats r={r} testing={testing} logHref={href(league, market, "log")} />}

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

/**
 * Every model behind this market and what it does with money, from the report
 * and the policy in force. Only a rule that issues stakes reads "Sets real stakes".
 */
function lineup(r: PicksReport, market: Market, policy: PicksPolicy | null): ModelRow[] {
  const L = LEAGUE_NAME[r.league];
  const rule = r.strategies.rule;
  const totalsRule = r.totals.backtest.rule;
  const inputs: ModelRow[] = [
    { name: "Sam", role: "Spread and total numbers, outside source", status: "input", note: "Feeds the rule. Never stakes on its own." },
    { name: "David", role: "Spread and total numbers, outside source", status: "input", note: "Feeds the rule. Never stakes on its own." },
  ];
  const sources: ModelRow[] =
    r.league === "cfb" && policy
      ? (["pem", "harris"] as const).map((src) => {
          const st = sourceState(policy, src);
          const name = src === "pem" ? "PEM" : "John Harris";
          return st === "out"
            ? { name, role: "College source", status: "collecting" as const, note: "Not used in the rule now. The review keeps testing whether skipping the bets it disagrees with would gain." }
            : { name, role: "College source", status: "input" as const, note: st === "veto" ? "Its agreement cuts can be the rule, and a rule bet it disagrees with is skipped." : "Its agreement cuts compete for the rule. It vetoes nothing." };
        })
      : [];
  if (market === "ats")
    return [
      rule
        ? { name: `Spread rule: ${rule.label}`, role: `Decides ${L} spread bets`, status: "active", note: `${rule.record.w}-${rule.record.l}${rule.record.p ? `-${rule.record.p}` : ""} since tracking. Bets issue with that morning's DraftKings price and a stake under the weekly limits.` }
        : { name: "Spread rule", role: `Decides ${L} spread bets`, status: "collecting", note: "No cut clears the bar yet, so no spread bets issue. Every game is tracked." },
      ...inputs,
      ...sources,
      ...(r.league === "nfl" ? [{ name: "Our NFL spread model", role: "Our own number for every game", status: "collecting" as const, note: "Tracked only. Its leans are tested against the earlier price; it never touches the rule until it clears its gate." }] : []),
    ];
  if (market === "ou")
    return [
      totalsRule
        ? { name: `Totals rule: ${totalsRule.label}`, role: `Decides ${L} totals bets`, status: "active", note: `${totalsRule.record.w}-${totalsRule.record.l}${totalsRule.record.p ? `-${totalsRule.record.p}` : ""} on ${totalsRule.games} games. Bets issue with a saved price and a stake.` }
        : { name: "Totals", role: `${L} over/unders`, status: "collecting", note: "No totals cut clears the bar, so totals are tracked with no stake." },
      ...inputs,
    ];
  return [
    { name: "Straight-up picks", role: r.league === "nfl" ? "Pool entries" : "Winners, tracked", status: "projections", note: r.league === "nfl" ? "Picks for the pool, ranked by win chance. Pool entries only, never staked." : "Winner picks by the method in force. Tracked only, never staked." },
    ...inputs,
  ];
}
function lineupAside(r: PicksReport, market: Market): string {
  if (market === "ats") return r.strategies.rule ? "One rule sets stakes. Everything else is tracked." : "Nothing sets a stake right now.";
  if (market === "ou") return r.totals.backtest.rule ? "One rule sets stakes." : "Tracked only, no stakes.";
  return "No stakes in straight up.";
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
