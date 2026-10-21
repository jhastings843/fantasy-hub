// The week's props, flattened for the search box: one entry per player, with
// our NFL props model, David's board and our first TD model side by side.
// Same tests the cards use (clears, davidSide, Kalshi cost), so they cannot disagree.
import type { PropMarket } from "@/lib/props/parse";
import type { OurNflView } from "@/lib/models/nfl/store";
import type { OurFtdView } from "@/lib/models/nfl/ftd-store";
import type { PropsView } from "@/lib/props/store";
import { davidSide, davidSliceSide, isDavidSlice, type DavidGame } from "@/lib/props/david";
import { fairAmerican } from "@/lib/firsttd/parse";
import { kalshiCost, kalshiFor } from "@/lib/firsttd/trends";
import { NFL_TEAMS } from "@/lib/picks/teams";
import { whenEt } from "../picks/ui";
import type { SearchEntry, SearchRow } from "../picks/WeekSearch";

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

export function propsSearchIndex(ours: OurNflView | null, v: PropsView | null, ftd: OurFtdView | null): SearchEntry[] {
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

  // Our NFL model: its edges first, then where it leans without one.
  for (const saved of ours?.board ?? []) {
    const g = saved.game;
    const where = { away: g.away, home: g.home, kickoff: saved.kickoff };
    for (const m of g.markets as PropMarket[]) {
      const stat = m.stat ? STAT[m.stat] : m.statLabel.toLowerCase();
      const graded = saved.result?.markets.find((x) => x.id === m.id);
      const went = graded && graded.actual !== null ? ` · went ${graded.actual}` : "";
      if (m.clears && m.side) {
        const dk = m.books[0];
        const price = dk ? dk[m.side] : null;
        const out = graded?.play?.outcome;
        const text = `Edge: ${side(m.side)} ${m.line} ${stat}${price !== null ? ` (${am(price)} DK)` : ""} · ours ${m.model}${went}`;
        add(m.team, m.player, where, { market: "Our model", text, tone: out ?? "lean", result: out }, 1);
      } else if (m.lean) {
        add(m.team, m.player, where, { market: "Our model", text: `Leans ${m.lean} ${m.line} ${stat}, no edge · ours ${m.model}${went}`, tone: "pass" }, 2);
      }
    }
  }

  if (v) {
    // David's board: tracking, unless one of his slices has earned a place in the system.
    const davidNow: DavidGame[] = v.david.games;
    for (const g of davidNow) {
      const [, , away, home] = g.gameId.split("_");
      const res = new Map((g.result ?? []).map((r) => [r.id, r]));
      for (const p of g.props) {
        const d = davidSide(p);
        const price = d === "over" ? p.over : d === "under" ? p.under : null;
        const r = res.get(p.id);
        // Same test as the David rows on the cards: an active David slice this prop falls in.
        const inSystem = v.active.some((id) => isDavidSlice(id) && !id.includes("sam") && davidSliceSide(id, p, undefined) !== null);
        const text = `${inSystem ? "In the system: " : ""}${d ? `${side(d)} ${p.line}` : `At ${p.line}`} ${DSTAT[p.market]} · his ${p.projection}${price !== null ? ` (${am(price)} DK)` : ""}${
          r && r.actual !== null && r.actual !== undefined ? ` · went ${r.actual}` : ""
        }`;
        add(p.team, p.player, { away, home, kickoff: g.kickoff }, { market: "David", text, tone: r?.outcome ?? (inSystem ? "bet" : "pass"), result: r?.outcome ?? undefined }, inSystem ? 0 : 2);
      }
    }
  }

  // First TD: our chance for every listed player, our likeliest marked.
  for (const saved of ftd?.board ?? []) {
    const g = saved.game;
    const where = { away: g.away, home: g.home, kickoff: saved.kickoff };
    for (const t of g.teams) {
      for (const p of t.players) {
        const isPick = !!g.pick && g.pick.team === t.team && g.pick.name === p.name;
        const scored = saved.result ? saved.result.key === p.key : null;
        if (p.p === null) continue;
        const k = kalshiFor(saved.kalshi, p.name);
        const cost = k?.ask ? kalshiCost(k.ask) : null;
        const value = cost !== null && p.p > cost;
        const text = `${isPick ? "Our likeliest · " : ""}${pct(p.p)} to score first (fair ${fairAmerican(p.p)})${
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
