import Link from "next/link";
import { LOG_VIEW, NBA_VIEWS, VIEWS, type View } from "../picks/ui";
import { PropsLog } from "./top";
import { PropTabWeek } from "./week";
import { DavidResearch, DavidResults, DavidWeek } from "./davidprops";
import { OurNflResults } from "./ournfl";
import { OurFtdResults } from "./ourftd";
import { OurFirstBasketResults, OurNbaResults } from "./ournba";
import WeekSearch from "../picks/WeekSearch";
import { getPropsView } from "@/lib/props/store";
import { DAVID_URL } from "@/lib/props/david";
import { getOurNflView } from "@/lib/models/nfl/store";
import { getOurFtdView } from "@/lib/models/nfl/ftd-store";
import { propsSearchIndex } from "./search";
import s from "../picks/picks.module.css";

// The Props tab: our own models (NFL props and first TD, NBA props and first
// basket) and David Sasser's NFL props board. Sam's props, first TD and NBA
// pages went behind his paywall on 2026-10-21; Jack had his record taken off
// the page (his saved data stays in Redis, untouched). Same shape as Picks
// (market, then view, both in the URL), no stakes: everything here is
// tracked and graded until a slice earns its way into the system.

export type PropsMarket = "pp" | "ftd" | "nba" | "fb";
const MARKETS: { [sport in "nfl" | "nba"]: { id: PropsMarket; label: string }[] } = {
  nfl: [
    { id: "pp", label: "Player props" },
    { id: "ftd", label: "First TD" },
  ],
  nba: [
    { id: "nba", label: "Player props" },
    { id: "fb", label: "First Basket" },
  ],
};
export const parsePropsMarket = (x: unknown): PropsMarket => (x === "ftd" || x === "nba" || x === "fb" ? x : "pp");

function href(m: PropsMarket, v: View) {
  const q = new URLSearchParams();
  if (m !== "pp") q.set("m", m);
  if (v !== "week") q.set("v", v);
  const qs = q.toString();
  return qs ? `/props?${qs}` : "/props";
}

/** The NFL season a date belongs to: January to July is the season before. */
const seasonOf = (d: Date) =>
  d.getUTCMonth() < 7 ? d.getUTCFullYear() - 1 : d.getUTCFullYear();

export default async function PropsView({
  market,
  view,
}: {
  market: PropsMarket;
  view: View;
}) {
  const season = seasonOf(new Date());
  const [ov, pv, fv] = await Promise.all([
    getOurNflView(season).catch(() => null),
    getPropsView(season).catch(() => null),
    getOurFtdView(season).catch(() => null),
  ]);
  const entries = propsSearchIndex(ov, pv, fv);
  const sport = market === "nba" || market === "fb" ? "nba" : "nfl";
  // Only David's board has a Research view (NFL player props); our models keep theirs on Results and the Learner log.
  const base = sport === "nba" ? NBA_VIEWS : VIEWS;
  const views = base.filter((v) => v.id !== "research" || market === "pp").concat(LOG_VIEW);
  const shown: View = market !== "pp" && view === "research" ? "results" : view;
  return (
    <main className={s.page}>
      <div className={s.wrap}>
        <header className={s.header}>
          <h1 className={s.eyebrow} style={{ margin: 0 }}>
            {`Props · ${sport === "nba" ? `NBA ${season}-${String(season + 1).slice(2)}` : `NFL ${season}`}`}
          </h1>
          <div className={s.navRows}>
            <nav className={s.chips} aria-label="Sport">
              <Link className={s.chip} href={href("pp", shown === "research" ? "week" : shown)} aria-current={sport === "nfl" ? "page" : undefined}>
                NFL
              </Link>
              <Link className={s.chip} href={href("nba", shown === "research" ? "week" : shown)} aria-current={sport === "nba" ? "page" : undefined}>
                NBA
              </Link>
            </nav>
            <nav className={s.chips} aria-label="Market">
              {MARKETS[sport].map((m) => (
                <Link key={m.id} href={href(m.id, shown === "research" && m.id !== "pp" ? "week" : shown)} aria-current={m.id === market ? "page" : undefined} className={s.chip}>
                  {m.label}
                </Link>
              ))}
            </nav>
          </div>
          <nav className={`${s.tabs} ${s.tabsSoft}`} aria-label="View">
            {views.map((v) => (
              <Link key={v.id} href={href(market, v.id)} aria-current={v.id === shown ? "page" : undefined} className={s.tab}>
                {v.label}
              </Link>
            ))}
          </nav>
          {sport === "nfl" && shown === "week" && entries.length > 0 && (
            <WeekSearch entries={entries} label="Search this week: our props and first TD models, David's board" placeholder="Player or team, e.g. Kelce or Chiefs" />
          )}
        </header>

        {shown === "week" && <PropTabWeek tab={market} season={season} />}
        {shown === "log" && <PropsLog tab={market} season={season} />}
        {market === "pp" && shown === "week" && <DavidWeek season={season} />}
        {market === "pp" && shown === "results" && (
          <>
            <OurNflResults season={season} />
            <DavidResults season={season} />
          </>
        )}
        {market === "pp" && shown === "research" && <DavidResearch season={season} />}
        {market === "ftd" && shown === "results" && <OurFtdResults season={season} />}
        {market === "nba" && shown === "results" && <OurNbaResults season={season} />}
        {market === "fb" && shown === "results" && <OurFirstBasketResults season={season} />}

        <footer className={s.footer}>
          <span>
            Sources: our own models (ESPN box scores and play-by-play,
            nflverse weekly stats, DraftKings lines via ESPN and The Odds API,
            Kalshi first TD prices),{" "}
            <a href={DAVID_URL}>David Sasser&apos;s props board</a>,
            ESPN box scores and scoring plays. Model output and a record of
            it, not betting advice.
          </span>
        </footer>
      </div>
    </main>
  );
}
