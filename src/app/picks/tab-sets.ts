import { href, MARKETS, type Market, type View } from "./ui";
import type { Tab } from "./tabs";

// The tab sets for the four picks boards (UX pass item 3). One place, so the
// sport row reads the same on NFL, CFB, NBA and CBB.
//
//   scopeGroups("nfl", "ats", "week") ->
//     [[NFL*, CFB, NBA, CBB], [Spreads*, Straight up, Totals]]
//   footballViewTabs("nfl", "ats", "log").lab ->
//     [Research, Learner log*, How it works]

export type Sport = "nfl" | "cfb" | "nba" | "cbb";

const q = (base: string, m: Market, v: View) => {
  const p = new URLSearchParams();
  if (m !== "ats") p.set("m", m);
  if (v !== "week") p.set("v", v);
  const s = p.toString();
  return s ? `${base}?${s}` : base;
};

export function boardHref(sport: Sport, m: Market, v: View): string {
  if (sport === "nfl" || sport === "cfb") return href(sport, m, v);
  return q(sport === "nba" ? "/picks/nba" : "/picks/cbb", m, v);
}


export function scopeGroups(sport: Sport, m: Market, v: View): Tab[][] {
  const sports: { id: Sport; label: string }[] = [
    { id: "nfl", label: "NFL" },
    { id: "cfb", label: "CFB" },
    { id: "nba", label: "NBA" },
    { id: "cbb", label: "CBB" },
  ];
  return [
    sports.map((x) => {
      // Every board has the same three markets, so switching sport keeps the market and view.
      return { key: x.id, label: x.label, href: boardHref(x.id, m, v), current: x.id === sport };
    }),
    MARKETS.map((k) => ({ key: k.id, label: k.label, href: boardHref(sport, k.id, v), current: k.id === m })),
  ];
}

const view = (sport: Sport, m: Market, cur: View, id: View, label: string): Tab => ({ key: id, label, href: boardHref(sport, m, id), current: cur === id });

/** Board, Results, and the Lab pages (Research, Learner log, and the extras each board has). */
export function viewTabs(sport: Sport, m: Market, cur: View, extra: Tab[] = []) {
  return {
    board: view(sport, m, cur, "week", sport === "nba" || sport === "cbb" ? "Today" : "Board"),
    results: view(sport, m, cur, "results", "Results"),
    lab: [view(sport, m, cur, "research", "Research"), view(sport, m, cur, "log", "Learner log"), ...extra],
  };
}

export const footballViewTabs = (league: "nfl" | "cfb", m: Market, cur: View) =>
  viewTabs(league, m, cur, [{ key: "how", label: "How it works", href: `/picks/model?l=${league}` }]);
