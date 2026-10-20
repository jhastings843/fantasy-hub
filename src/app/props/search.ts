// The week's props, flattened for the search box: one entry per player, with
// Sam's prop calls, David's board and the first TD model side by side. Same
// tests the cards use (isPlay, systemHits, davidSide), so they cannot disagree.
import { isPlay } from "@/lib/props/grade";
import type { PropMarket } from "@/lib/props/parse";
import type { PropsView } from "@/lib/props/store";
import { davidSide, davidSliceSide, isDavidSlice, samOn, type DavidGame } from "@/lib/props/david";
import { fairAmerican } from "@/lib/firsttd/parse";
import type { FirstTdView } from "@/lib/firsttd/store";
import { kalshiCost, kalshiFor } from "@/lib/firsttd/trends";
import { NFL_TEAMS } from "@/lib/picks/teams";
import { whenEt } from "../picks/ui";
import type { SearchEntry, SearchRow } from "../picks/WeekSearch";
import { systemHits } from "./playerprops";

const FULL: Record<string, string> = Object.fromEntries(Object.entries(NFL_TEAMS).map(([full, abbr]) => [abbr, full]));
const STAT: { [k: string]: string } = { pass_yds: "pass yds", rush_yds: "rush yds", rec_yds: "rec yds", rec: "rec" };
const DSTAT: { [k: string]: string } = {
  passing_yards: "pass yds",
  pass_attempts: "pass att",
  rushing_yards: "rush yds",
  rush_attempts: "rush att",
  receiving_yards: "rec yds",
  receptions: "rec",
};
const am = (p: number) => (p > 0 ? `+${p}` : `${p}`);
const side = (x: "over" | "under") => (x === "over" ? "Over" : "Under");
const pct = (p: number) => `${(p * 100).toFixed(1)}%`;

/** "Troy Franklin", "T.Franklin" and "Franklin Jr." all fold to "DEN|t|franklin". */
export function playerKey(team: string, name: string): string {
  const parts = name
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv|v)\.?$/i, "")
    .split(/[\s.]+/)
    .filter(Boolean);
  const last = (parts[parts.length - 1] ?? "").replace(/[^a-z-]/g, "");
  return `${team.toUpperCase()}|${(parts[0] ?? "")[0] ?? ""}|${last}`;
}

interface Player {
  name: string;
  team: string;
  game: string;
  opp: string;
  kickoff?: string;
  rows: SearchRow[];
  rank: number;
}

export function propsSearchIndex(v: PropsView | null, ftd: FirstTdView | null): SearchEntry[] {
  const players = new Map<string, Player>();
  const add = (team: string, name: string, game: { away: string; home: string; kickoff?: string }, row: SearchRow, rank: number) => {
    const k = playerKey(team, name);
    const opp = team === game.home ? game.away : game.home;
    let p = players.get(k);
    if (!p) {
      p = { name, team, game: `${game.away} at ${game.home}`, opp, kickoff: game.kickoff, rows: [], rank: 3 };
      players.set(k, p);
    }
    // Prefer a full name ("Troy Franklin") over the first TD page's "T.Franklin".
    if (p.name.includes(".") && !name.includes(".")) p.name = name;
    p.rows.push(row);
    p.rank = Math.min(p.rank, rank);
  };

  if (v) {
    // Sam's props: plays first, then where his number leans without a play.
    for (const saved of Object.values(v.current)) {
      const g = saved.game;
      const where = { away: g.away, home: g.home, kickoff: saved.kickoff };
      for (const m of g.markets as PropMarket[]) {
        const stat = m.stat ? STAT[m.stat] : m.statLabel.toLowerCase();
        const graded = saved.result?.markets.find((x) => x.id === m.id);
        if (isPlay(m)) {
          const w = m.books.find((b) => b.win);
          const price = w && m.side ? w[m.side] : null;
          const inSystem = systemHits(m, saved, v.active, v.graded).length > 0;
          const out = graded?.play?.outcome;
          const text = `${inSystem ? "In the system" : "Play"}: ${side(m.side!)} ${m.line} ${stat}${price !== null && w ? ` (${am(price)} ${w.book})` : ""} · Sam ${m.model}${
            graded && graded.actual !== null ? ` · went ${graded.actual}` : ""
          }`;
          add(m.team, m.player, where, { market: "Sam", text, tone: out ?? (inSystem ? "bet" : "lean"), result: out }, inSystem ? 0 : 1);
        } else if (m.lean) {
          const text = `Leans ${m.lean} ${m.line} ${stat}, no play · Sam ${m.model}${graded && graded.actual !== null ? ` · went ${graded.actual}` : ""}`;
          add(m.team, m.player, where, { market: "Sam", text, tone: "pass" }, 2);
        }
      }
    }
    // David's board: tracking, unless one of his slices has earned a place in the system.
    const davidNow: DavidGame[] = v.david.week !== null && (v.week === null || v.david.week >= v.week) ? v.david.games : [];
    const samMap = new Map(Object.entries(v.david.sam ?? {}));
    for (const g of davidNow) {
      const [, , away, home] = g.gameId.split("_");
      const res = new Map((g.result ?? []).map((r) => [r.id, r]));
      for (const p of g.props) {
        const d = davidSide(p);
        const price = d === "over" ? p.over : d === "under" ? p.under : null;
        const r = res.get(p.id);
        // Same test as the David rows on the cards: an active David slice this prop falls in.
        const inSystem = v.active.some((id) => isDavidSlice(id) && davidSliceSide(id, p, samOn(samMap, p)) !== null);
        const text = `${inSystem ? "In the system: " : ""}${d ? `${side(d)} ${p.line}` : `At ${p.line}`} ${DSTAT[p.market]} · his ${p.projection}${price !== null ? ` (${am(price)} DK)` : ""}${
          r && r.actual !== null && r.actual !== undefined ? ` · went ${r.actual}` : ""
        }`;
        add(p.team, p.player, { away, home, kickoff: g.kickoff }, { market: "David", text, tone: r?.outcome ?? (inSystem ? "bet" : "pass"), result: r?.outcome ?? undefined }, inSystem ? 0 : 2);
      }
    }
  }

  // First TD: Sam's chance for every priced player, his pick marked.
  for (const saved of Object.values(ftd?.current?.games ?? {})) {
    const g = saved.game;
    const where = { away: g.away, home: g.home, kickoff: saved.kickoff };
    for (const t of g.teams) {
      for (const p of t.players) {
        const isPick = !!g.pick && g.pick.team === t.team && g.pick.name === p.name;
        const scored = saved.result ? saved.result.key === p.key : null;
        if (p.out) {
          add(t.team, p.name, where, { market: "First TD", text: "Ruled out on Sam's page", tone: "pass" }, 3);
          continue;
        }
        if (p.p === null) continue;
        const k = kalshiFor(saved.kalshi, p.name);
        const cost = k?.ask ? kalshiCost(k.ask) : null;
        const value = cost !== null && p.p > cost;
        const text = `${isPick ? "Sam's pick · " : ""}${pct(p.p)} to score first (fair ${fairAmerican(p.p)})${
          cost !== null ? ` · Kalshi ${Math.round(cost * 100)}¢${value ? ", value" : ""}` : ""
        }${scored === true ? " · scored first" : ""}`;
        const result = saved.result && isPick ? (scored ? "W" : "L") : undefined;
        add(t.team, p.name, where, { market: "First TD", text, tone: result ?? (isPick || value ? "lean" : "pass"), result }, isPick ? 1 : 3);
      }
    }
  }

  return [...players.entries()].map(([key, p]) => ({
    key,
    title: p.name,
    meta: `${p.team} · ${p.game}${p.kickoff ? ` · ${whenEt(p.kickoff)}` : ""}`,
    terms: [p.team, FULL[p.team] ?? "", p.opp, FULL[p.opp] ?? "", p.game].join(" ").toLowerCase(),
    rank: p.rank,
    rows: p.rows,
  }));
}
