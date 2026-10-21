import Link from "next/link";
import { NBA_VIEWS, VIEWS, type View } from "../picks/ui";
import { FirstTdResearch, FirstTdResults, FirstTdWeek } from "./firsttd";
import {
  NbaPropsWeek,
  PropsResearch,
  PropsResults,
  PropsWeek,
} from "./playerprops";
import { OurNflResults, OurNflWeek } from "./ournfl";
import { OurFtdResults, OurFtdWeek } from "./ourftd";
import { OurFirstBasket, OurFirstBasketResults, OurNbaResults, OurNbaWeek } from "./ournba";
import WeekSearch from "../picks/WeekSearch";
import { getPropsView } from "@/lib/props/store";
import { getFirstTdView } from "@/lib/firsttd/store";
import { propsSearchIndex } from "./search";
import s from "../picks/picks.module.css";

// The Props tab: Sam's NFL player props and first touchdown models, and his
// NBA player props (same tracker, own record and system). Same
// shape as Picks (market, then view, both in the URL), no stakes: everything
// here is tracked and graded until a slice earns its way into the system.

export type PropsMarket = "pp" | "ftd" | "nba";
// NFL markets; NBA is its own sport tab (player props only).
const MARKETS: { id: PropsMarket; label: string }[] = [
  { id: "pp", label: "Player props" },
  { id: "ftd", label: "First TD" },
];
export const parsePropsMarket = (x: unknown): PropsMarket =>
  x === "ftd" || x === "nba" ? x : "pp";

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
  const [pv, fv] = await Promise.all([
    getPropsView(season).catch(() => null),
    getFirstTdView(season).catch(() => null),
  ]);
  const entries = propsSearchIndex(pv, fv);
  return (
    <main className={s.page}>
      <div className={s.wrap}>
        <header className={s.header}>
          <div className={s.headRow}>
            <nav className={s.subnav} aria-label="Sport">
              <Link
                href={href("pp", view)}
                aria-current={market !== "nba" ? "page" : undefined}
              >
                NFL
              </Link>
              <Link
                href={href("nba", view)}
                aria-current={market === "nba" ? "page" : undefined}
              >
                NBA
              </Link>
            </nav>
            <span className={s.eyebrow}>
              {market === "nba"
                ? `NBA ${season}-${String(season + 1).slice(2)}`
                : `NFL ${season}`}
            </span>
          </div>
          <h1 className={s.h1}>Props</h1>
          {market !== "nba" && entries.length > 0 && (
            <WeekSearch
              entries={entries}
              label="Search this week: Sam's props, David's board and first TD"
              placeholder="Player or team, e.g. Kelce or Chiefs"
            />
          )}
          {market !== "nba" && (
            <nav className={s.tabs} aria-label="Market">
              {MARKETS.map((m) => (
                <Link
                  key={m.id}
                  href={href(m.id, view)}
                  aria-current={m.id === market ? "page" : undefined}
                  className={s.tab}
                >
                  {m.label}
                </Link>
              ))}
            </nav>
          )}
          <nav className={`${s.tabs} ${s.tabsSoft}`} aria-label="View">
            {(market === "nba" ? NBA_VIEWS : VIEWS).map((v) => (
              <Link
                key={v.id}
                href={href(market, v.id)}
                aria-current={v.id === view ? "page" : undefined}
                className={s.tab}
              >
                {v.label}
              </Link>
            ))}
          </nav>
        </header>

        {market === "pp" && view === "week" && (
          <>
            <OurNflWeek season={season} />
            <PropsWeek season={season} />
          </>
        )}
        {market === "pp" && view === "results" && (
          <>
            <OurNflResults season={season} />
            <PropsResults season={season} />
          </>
        )}
        {market === "pp" && view === "research" && (
          <PropsResearch season={season} />
        )}
        {market === "ftd" && view === "week" && (
          <>
            <OurFtdWeek season={season} />
            <FirstTdWeek season={season} />
          </>
        )}
        {market === "ftd" && view === "results" && (
          <>
            <OurFtdResults season={season} />
            <FirstTdResults season={season} />
          </>
        )}
        {market === "ftd" && view === "research" && (
          <FirstTdResearch season={season} />
        )}
        {market === "nba" && view === "week" && (
          <>
            <OurNbaWeek season={season} />
            <OurFirstBasket season={season} />
            <NbaPropsWeek season={season} />
          </>
        )}
        {market === "nba" && view === "results" && (
          <>
            <OurNbaResults season={season} />
            <OurFirstBasketResults season={season} />
            <PropsResults season={season} league="nba" />
          </>
        )}
        {market === "nba" && view === "research" && (
          <PropsResearch season={season} league="nba" />
        )}

        <footer className={s.footer}>
          <span>
            Sources:{" "}
            <a href="https://samthemodelman.smmodel.workers.dev/nfl/">
              Sam&apos;s Models
            </a>{" "}
            (NFL and NBA props pages, first TD pages), Rotowire projections via
            Sleeper, ESPN projections and DraftKings lines via ESPN, Kalshi
            first TD prices, ESPN box scores and scoring plays. Our own models:
            ESPN box scores and play-by-play, DraftKings lines via ESPN. Model output and
            a record of it, not betting advice.
          </span>
        </footer>
      </div>
    </main>
  );
}
