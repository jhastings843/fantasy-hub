// Search entries for the sports the header search didn't cover before
// (Jack, 2026-11-02: "make sure cbb and every team/player/sport is
// searchable"): NBA games, CBB games and our NBA player props, plus the rule
// that keeps the list to each team's or player's current game.

import type { NbaBoard, NbaBoardGame } from "@/lib/picks/nba-store";
import type { CbbBoard, CbbBoardRow } from "@/lib/models/cbb/store";
import type { OurNbaView } from "@/lib/models/nba/store";
import type { PropMarket } from "@/lib/props/parse";
import type { SearchEntry, SearchRow } from "@/app/picks/WeekSearch";

/** A search entry with what the "current game only" rule needs. */
export interface Dated extends SearchEntry {
  /** Who the entry is about, namespaced by sport ("nba:BOS", "cbb:150"); a player's entry carries his team. */
  subjects: string[];
  /** Tip or kickoff, ISO. */
  at: string;
  /** The game has ended. */
  done: boolean;
}

/**
 * Keep each team's and player's current game. A finished game drops out once
 * every team (or the player) in it has a later game posted; until then it
 * stays, so the last result is still findable between games.
 */
export function currentOnly<T extends Dated>(entries: T[]): T[] {
  const latest = new Map<string, string>();
  for (const e of entries) for (const s of e.subjects) if ((latest.get(s) ?? "") < e.at) latest.set(s, e.at);
  return entries.filter((e) => !e.done || e.subjects.some((s) => (latest.get(s) ?? "") <= e.at));
}

const ET = "America/New_York";
const when = (iso: string) => new Date(iso).toLocaleString("en-US", { timeZone: ET, weekday: "short", hour: "numeric", minute: "2-digit" });
const ln = (x: number) => (x > 0 ? `+${x}` : x === 0 ? "PK" : `${x}`);
const am = (p: number) => (p > 0 ? `+${p}` : `${p}`);

/* ------------------------------------------------------------------ NBA -- */

function nbaGame(g: NbaBoardGame): Dated {
  const rows: SearchRow[] = [];
  const r = g.read;
  const f = g.state === "post" && g.score ? g.score : null;
  if (g.line) {
    if (r) {
      const team = r.side === "home" ? g.home.abbr : g.away.abbr;
      const at = r.side === "home" ? g.line.home : -g.line.home;
      const cov = f ? (f.home - f.away + g.line.home) * (r.side === "home" ? 1 : -1) : null;
      const res = cov === null ? undefined : cov === 0 ? "P" : cov > 0 ? "W" : "L";
      rows.push({ market: "Spread", text: `Sam: ${team} ${ln(at)} · his line ${g.home.abbr} ${ln(r.model)}, edge ${r.edge.toFixed(1)}`, tone: res ?? (r.crossed ? "pass" : "lean"), result: res });
    } else rows.push({ market: "Spread", text: `DK ${g.home.abbr} ${ln(g.line.home)} · no Sam read`, tone: "pass" });
  } else rows.push({ market: "Spread", text: "No line yet", tone: "pass" });
  if (g.total) {
    const pts = f ? f.home + f.away : null;
    const side = r?.totalSide;
    const res = pts === null || !side ? undefined : pts === g.total.points ? "P" : (pts > g.total.points) === (side === "over") ? "W" : "L";
    rows.push({ market: "Total", text: `${side ? `Sam: ${side === "over" ? "Over" : "Under"} ${g.total.points} · his ${r?.modelTotal}` : `DK ${g.total.points}`}${pts !== null ? ` · ${pts} scored` : ""}`, tone: res ?? (side ? "lean" : "pass"), result: res });
  }
  return {
    key: `nba:${g.id}`,
    title: `${g.away.name} at ${g.home.name}`,
    meta: `NBA · ${f ? `Final ${g.away.abbr} ${f.away}, ${g.home.abbr} ${f.home}` : g.state === "in" ? `Live · ${g.detail}` : when(g.tip)}`,
    terms: [g.away, g.home].flatMap((t) => [t.abbr, t.name, t.short]).join(" ").toLowerCase(),
    rank: g.state === "post" ? 2 : 1,
    rows,
    href: `/picks/nba/game?id=${g.id}`,
    subjects: [`nba:${g.away.abbr}`, `nba:${g.home.abbr}`],
    at: g.tip,
    done: g.state === "post",
  };
}

export function nbaGamesIndex(b: NbaBoard | null): Dated[] {
  if (!b) return [];
  const games = [...(b.yesterday?.games ?? []), ...b.days.flatMap((d) => d.games)];
  const seen = new Set<string>();
  return games.filter((g) => !seen.has(g.id) && seen.add(g.id)).map(nbaGame);
}

/* ------------------------------------------------------------------ CBB -- */

const pctWin = (p: number) => (p > 0.99 ? ">99%" : p < 0.01 ? "<1%" : `${Math.round(p * 100)}%`);

function cbbGame(x: CbbBoardRow): Dated {
  const { g, read: r, saved } = x;
  const rows: SearchRow[] = [];
  const f = g.state === "post" && g.score ? g.score : null;
  // A game under way or over is shown as we read it before tip (the saved copy); today's read would know the result.
  const pre = g.state === "pre" ? null : saved?.first;
  const v =
    g.state === "pre"
      ? { sp: r.line?.spread ?? null, tot: r.line?.total ?? null, ours: r.proj.spread, oursTot: r.proj.total, homeWin: r.proj.homeWin, cover: r.homeCover }
      : pre
        ? { sp: pre.spread, tot: pre.total, ours: pre.ours.spread, oursTot: pre.ours.total, homeWin: pre.ours.homeWin, cover: null }
        : null;
  if (!v) rows.push({ market: "Ours", text: "Not priced before tip", tone: "pass" });
  else {
    const edge = v.sp === null ? null : v.sp - v.ours;
    if (v.sp !== null && edge !== null && edge !== 0) {
      const home = edge > 0;
      const team = home ? g.home.abbr : g.away.abbr;
      const cov = f ? (f.home - f.away + v.sp) * (home ? 1 : -1) : null;
      const res = cov === null ? undefined : cov === 0 ? "P" : cov > 0 ? "W" : "L";
      const chance = v.cover === null ? "" : `, ${Math.round((home ? v.cover : 1 - v.cover) * 100)}% to cover`;
      rows.push({ market: "Spread", text: `Ours: ${team} ${ln(home ? v.sp : -v.sp)} · ours ${g.home.abbr} ${ln(v.ours)}, edge ${Math.abs(edge).toFixed(1)}${chance}`, tone: res ?? "lean", result: res });
    } else rows.push({ market: "Spread", text: `Ours ${g.home.abbr} ${ln(v.ours)} · no DK line`, tone: "pass" });
    const tEdge = v.tot === null ? null : v.oursTot - v.tot;
    if (v.tot !== null && tEdge !== null && tEdge !== 0) {
      const over = tEdge > 0;
      const pts = f ? f.home + f.away : null;
      const res = pts === null ? undefined : pts === v.tot ? "P" : (pts > v.tot) === over ? "W" : "L";
      rows.push({ market: "Total", text: `Ours: ${over ? "Over" : "Under"} ${v.tot} · ours ${v.oursTot}${pts !== null ? ` · ${pts} scored` : ""}`, tone: res ?? "lean", result: res });
    }
    const winHome = v.homeWin >= 0.5;
    const winRes = f ? (f.home === f.away ? "P" : (f.home > f.away) === winHome ? "W" : "L") : undefined;
    rows.push({ market: "To win", text: `${winHome ? g.home.short : g.away.short} · ${pctWin(winHome ? v.homeWin : 1 - v.homeWin)} to win`, tone: winRes ?? "lean", result: winRes });
  }
  const sp = r.line?.spread ?? null;
  const name = (t: CbbBoardRow["g"]["home"]) => `${t.rank ? `${t.rank} ` : ""}${t.name}`;
  return {
    key: `cbb:${g.id}`,
    title: `${name(g.away)} ${g.neutral ? "vs" : "at"} ${name(g.home)}`,
    meta: `CBB · ${f ? `Final ${g.away.abbr} ${f.away}, ${g.home.abbr} ${f.home}` : g.state === "in" ? `Live · ${g.detail}` : `${when(g.tip)}${sp !== null ? ` · ${g.home.abbr} ${ln(sp)}` : ""}`}`,
    terms: [g.away, g.home].flatMap((t) => [t.abbr, t.name, t.short]).join(" ").toLowerCase(),
    rank: g.state === "post" ? 2 : 1,
    rows,
    href: "/picks/cbb",
    subjects: [`cbb:${g.away.id}`, `cbb:${g.home.id}`],
    at: g.tip,
    done: g.state === "post",
  };
}

export function cbbGamesIndex(b: CbbBoard | null): Dated[] {
  return b ? b.days.flatMap((d) => d.rows.map(cbbGame)) : [];
}

/* ------------------------------------------------------------ NBA props -- */

const NBA_STAT: { [k: string]: string } = { pts: "pts", reb: "reb", ast: "ast", threes: "threes" };

/** One entry per player per game: our model's edges and leans, and David's number when saved. */
export function nbaPropsIndex(v: OurNbaView | null, teamNames: Map<string, string>): Dated[] {
  const out: Dated[] = [];
  for (const saved of v?.board ?? []) {
    const g = saved.game;
    const at = saved.kickoff ?? saved.capturedAt ?? "";
    const done = !!saved.result;
    const by = new Map<string, { name: string; team: string; rows: SearchRow[]; rank: number }>();
    for (const m of g.markets as PropMarket[]) {
      if (!m.stat || !NBA_STAT[m.stat]) continue;
      const k = `${m.team}|${m.player.toLowerCase()}`;
      const p = by.get(k) ?? { name: m.player, team: m.team, rows: [], rank: 3 };
      by.set(k, p);
      const graded = saved.result?.markets.find((x) => x.id === m.id);
      const went = graded && graded.actual !== null ? ` · went ${graded.actual}` : "";
      const stat = NBA_STAT[m.stat];
      if (m.clears && m.side) {
        const dk = m.books[0];
        const price = dk ? dk[m.side] : null;
        const res = graded?.play?.outcome;
        p.rows.push({ market: "Our model", text: `Edge: ${m.side === "over" ? "Over" : "Under"} ${m.line} ${stat}${price !== null && price !== undefined ? ` (${am(price)} DK)` : ""} · ours ${m.model}${went}`, tone: res ?? "lean", result: res });
        p.rank = Math.min(p.rank, 1);
      } else if (m.lean) {
        p.rows.push({ market: "Our model", text: `Leans ${m.lean} ${m.line} ${stat}, no edge · ours ${m.model}${went}`, tone: "pass" });
        p.rank = Math.min(p.rank, 2);
      }
      const d = saved.david?.[m.id];
      if (d !== undefined) {
        const side = d > m.line ? "Over" : d < m.line ? "Under" : "At";
        const res = graded?.david?.outcome;
        p.rows.push({ market: "David", text: `${side} ${m.line} ${stat} · his ${d}${went}`, tone: res ?? "pass", result: res });
      }
    }
    for (const p of by.values()) {
      if (!p.rows.length) continue;
      const opp = p.team === g.home ? g.away : g.home;
      out.push({
        key: `nbap:${g.slug}:${p.team}|${p.name}`,
        title: p.name,
        meta: `NBA props · ${p.team} vs ${opp}${at ? ` · ${when(at)}` : ""}`,
        terms: [p.team, teamNames.get(p.team) ?? "", opp, teamNames.get(opp) ?? ""].join(" ").toLowerCase(),
        rank: done ? 2 : p.rank,
        rows: p.rows,
        href: "/props?m=nba",
        // The team's next game posting retires this one, whether or not his props for it are up yet.
        subjects: [`nba:${p.team}`],
        at,
        done,
      });
    }
  }
  return out;
}
