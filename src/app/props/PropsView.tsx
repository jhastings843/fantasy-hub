import Link from "next/link";
import { LOG_VIEW, NBA_VIEWS, VIEWS, type View } from "../picks/ui";
import { PropsLineup, PropsLog } from "./top";
import { PropTabWeek } from "./week";
import { DavidResearch, DavidResults, DavidWeek } from "./davidprops";
import { OurNflResults } from "./ournfl";
import { OurFtdResults } from "./ourftd";
import { OurFirstBasketResults, OurNbaResults } from "./ournba";
import { KotcResults, KotcWeek } from "./kotc";
import { NbaNewsResults, NbaNewsToday } from "./news";
import { Background, PageHead, SecHead } from "../picks/board";
import { DAVID_URL } from "@/lib/props/david";
import s from "../picks/picks.module.css";

// The Props tab: our own models (NFL props and first TD, NBA props, first
// basket and King of the Court) and David Sasser's NFL props board. Sam's props, first TD and NBA
// pages went behind his paywall on 2026-10-21; Jack had his record taken off
// the page (his saved data stays in Redis, untouched). Same shape as Picks
// (market, then view, both in the URL), no stakes: everything here is
// tracked and graded until a slice earns its way into the system.

export type PropsMarket = "pp" | "ftd" | "nba" | "fb" | "kotc";
/** Every market in one control, in the Ledger order, and each one's page title. */
const ALL_MARKETS: { id: PropsMarket; label: string }[] = [
  { id: "pp", label: "NFL props" },
  { id: "ftd", label: "First TD" },
  { id: "nba", label: "NBA props" },
  { id: "fb", label: "First Basket" },
  { id: "kotc", label: "King of the Court" },
];
const TITLE: { [k in PropsMarket]: string } = { pp: "NFL player props", ftd: "NFL First TD", nba: "NBA player props", fb: "NBA First Basket", kotc: "NBA King of the Court" };
export const parsePropsMarket = (x: unknown): PropsMarket => (x === "ftd" || x === "nba" || x === "fb" || x === "kotc" ? x : "pp");

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
  const sport = market === "nba" || market === "fb" || market === "kotc" ? "nba" : "nfl";
  // Only David's board has a Research view (NFL player props); our models keep theirs on Results and the Learner log.
  const base = sport === "nba" ? NBA_VIEWS : VIEWS;
  // King of the Court has no learner yet (its numbers are graded nightly and refit between seasons), so no log view.
  const views = base.filter((v) => v.id !== "research" || market === "pp").concat(market === "kotc" ? [] : [LOG_VIEW]);
  const shown: View = market === "kotc" && view === "log" ? "week" : market !== "pp" && view === "research" ? "results" : view;
  return (
    <main className={s.page}>
      <div className={s.wrap}>
        <header className={s.pageFrame}>
          <PageHead
            title={TITLE[market]}
            sub="Our own models only. Sam plays no part in Props."
            asof={sport === "nba" ? `NBA ${season}-${String(season + 1).slice(2)}` : `NFL ${season}`}
          />
          <div className={s.controlBar}>
            <nav className={s.chips} aria-label="Market">
              {ALL_MARKETS.map((m) => (
                <Link key={m.id} href={href(m.id, shown === "research" && m.id !== "pp" ? "week" : shown === "log" && m.id === "kotc" ? "week" : shown)} aria-current={m.id === market ? "page" : undefined} className={s.chip}>
                  {m.label}
                </Link>
              ))}
            </nav>
            <nav className={s.chips} aria-label="View">
              {views.map((v) => (
                <Link key={v.id} href={href(market, v.id)} aria-current={v.id === shown ? "page" : undefined} className={s.chip}>
                  {v.id === "week" ? "Board" : v.label}
                </Link>
              ))}
            </nav>
          </div>
        </header>

        {shown === "week" && <PropsLineup tab={market} season={season} />}
        {shown === "week" && market !== "kotc" && <PropTabWeek tab={market} season={season} />}
        {shown === "log" && market !== "kotc" && <PropsLog tab={market} season={season} />}
        {market === "kotc" && shown === "week" && <KotcWeek season={season} />}
        {market === "kotc" && shown === "results" && <KotcResults season={season} />}
        {market === "pp" && shown === "results" && <OurNflResults season={season} />}
        {/* David's board is research only (Jack, 2026-10-22): still saved and graded by the data jobs, shown folded here. */}
        {market === "pp" && shown === "research" && (
          <>
            <SecHead title="David Sasser's props board" aside="Research only · tracked in the background" />
            <Background title="This week's board">
              <DavidWeek season={season} />
            </Background>
            <Background title="Results">
              <DavidResults season={season} />
            </Background>
            <Background title="Research: what beats the price">
              <DavidResearch season={season} />
            </Background>
          </>
        )}
        {market === "ftd" && shown === "results" && <OurFtdResults season={season} />}
        {market === "nba" && shown === "week" && <NbaNewsToday season={season} />}
        {market === "nba" && shown === "results" && (
          <>
            <NbaNewsResults season={season} />
            <OurNbaResults season={season} />
          </>
        )}
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
