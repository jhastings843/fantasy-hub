import Link from "next/link";
import { VIEWS, type View } from "../picks/ui";
import { FirstTdResearch, FirstTdResults, FirstTdWeek } from "./firsttd";
import { PropsResearch, PropsResults, PropsWeek } from "./playerprops";
import WeekSearch from "../picks/WeekSearch";
import { getPropsView } from "@/lib/props/store";
import { getFirstTdView } from "@/lib/firsttd/store";
import { propsSearchIndex } from "./search";
import s from "../picks/picks.module.css";

// The Props tab: Sam's NFL player props and first touchdown models. Same
// shape as Picks (market, then view, both in the URL), no stakes: everything
// here is tracked and graded until a slice earns its way into the system.

export type PropsMarket = "pp" | "ftd";
const MARKETS: { id: PropsMarket; label: string }[] = [
  { id: "pp", label: "Player props" },
  { id: "ftd", label: "First TD" },
];
export const parsePropsMarket = (x: unknown): PropsMarket => (x === "ftd" ? "ftd" : "pp");

function href(m: PropsMarket, v: View) {
  const q = new URLSearchParams();
  if (m !== "pp") q.set("m", m);
  if (v !== "week") q.set("v", v);
  const qs = q.toString();
  return qs ? `/props?${qs}` : "/props";
}

/** The NFL season a date belongs to: January to July is the season before. */
const seasonOf = (d: Date) => (d.getUTCMonth() < 7 ? d.getUTCFullYear() - 1 : d.getUTCFullYear());

export default async function PropsView({ market, view }: { market: PropsMarket; view: View }) {
  const season = seasonOf(new Date());
  const [pv, fv] = await Promise.all([getPropsView(season).catch(() => null), getFirstTdView(season).catch(() => null)]);
  const entries = propsSearchIndex(pv, fv);
  return (
    <main className={s.page}>
      <div className={s.wrap}>
        <header className={s.header}>
          <div className={s.headRow}>
            <span className={s.eyebrow}>{`NFL ${season}`}</span>
          </div>
          <h1 className={s.h1}>Props</h1>
          {entries.length > 0 && (
            <WeekSearch entries={entries} label="Search this week: Sam's props, David's board and first TD" placeholder="Player or team, e.g. Kelce or Chiefs" />
          )}
          <nav className={s.tabs} aria-label="Market">
            {MARKETS.map((m) => (
              <Link key={m.id} href={href(m.id, view)} aria-current={m.id === market ? "page" : undefined} className={s.tab}>
                {m.label}
              </Link>
            ))}
          </nav>
          <nav className={`${s.tabs} ${s.tabsSoft}`} aria-label="View">
            {VIEWS.map((v) => (
              <Link key={v.id} href={href(market, v.id)} aria-current={v.id === view ? "page" : undefined} className={s.tab}>
                {v.label}
              </Link>
            ))}
          </nav>
        </header>

        {market === "pp" && view === "week" && <PropsWeek season={season} />}
        {market === "pp" && view === "results" && <PropsResults season={season} />}
        {market === "pp" && view === "research" && <PropsResearch season={season} />}
        {market === "ftd" && view === "week" && <FirstTdWeek season={season} />}
        {market === "ftd" && view === "results" && <FirstTdResults season={season} />}
        {market === "ftd" && view === "research" && <FirstTdResearch season={season} />}

        <footer className={s.footer}>
          <span>
            Sources: <a href="https://samthemodelman.smmodel.workers.dev/nfl/">Sam&apos;s Models</a> (props and first TD pages), Rotowire projections via
            Sleeper, ESPN projections and DraftKings lines via ESPN, Kalshi first TD prices, ESPN box scores and scoring plays. Model output and a record of it, not betting advice.
          </span>
        </footer>
      </div>
    </main>
  );
}
