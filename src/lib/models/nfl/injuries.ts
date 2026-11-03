// "Who's out" for the NFL game models (Jack, 2026-11-02: injuries should apply
// to every game model, not just props). Two numbers per team per game, from an
// injury report (nflverse injuries_{season}.csv for history, ESPN rosters live)
// and the team's own recent usage (nflverse weekly stats):
//
//   qbOut     1 when the QB who started the team's previous game is Out or
//             Doubtful now (lib/injuries/status.ts: Out, Injured Reserve,
//             Doubtful, Suspension), else 0.
//   skillOut  the summed usage share of RB/WR/TE (FB counts as RB) newly Out
//             or Doubtful: on this report and not on the team's previous one.
//             Usage share = his targets + carries over the team's last 8
//             games / the team's targets + carries in those games (games he
//             missed count as zero, so a long absence fades on its own).
//
// Worked example: KC's last 8 games had 400 targets + carries; Kelce had 60
// targets, Pacheco 100 carries. This week Kelce is Doubtful (was healthy last
// week), Pacheco is Out (also Out last week), and Mahomes (last week's
// starter) is Questionable:
//   teamOut(...) -> { qbOut: 0, skillOut: 0.15 }   (60 / 400; Pacheco isn't new)
//
// nflverse's older games and injury files use STL, SD and OAK; its stats files
// use LA, LAC and LV throughout. normTeam folds the old codes into the new.
// Pure.

import { isOut } from "@/lib/injuries/status";

export const USAGE_WINDOW = 8;
const SKILL_POS = new Set(["RB", "FB", "WR", "TE"]);
const OLD: Record<string, string> = { STL: "LA", SD: "LAC", OAK: "LV" };

/** nflverse team code in its current form ("STL" -> "LA"). */
export const normTeam = (t: string) => OLD[t] ?? t;

export interface ReportEntry {
  /** Player id (gsis for nflverse). */
  id: string;
  pos: string;
  status: string;
}

export interface TeamOut {
  qbOut: number;
  skillOut: number;
  /** Who, for the flag shown on a game (live only): the starting QB and any skill player with 5%+ of usage newly out, "Jalen Hurts (QB)". */
  names?: string[];
}
/** A skill player's usage share that earns a name on the flag. */
export const NAME_SHARE = 0.05;

/** Each team's last few games of targets + carries per player, folded in a game at a time. */
export class UsageBook {
  private games = new Map<string, Map<string, number>[]>();

  constructor(readonly window = USAGE_WINDOW) {}

  /** One team-game: each player's targets + carries. */
  add(team: string, rows: { id: string; opp: number }[]) {
    const g = new Map<string, number>();
    for (const r of rows) g.set(r.id, (g.get(r.id) ?? 0) + r.opp);
    const list = this.games.get(team) ?? [];
    list.push(g);
    if (list.length > this.window) list.shift();
    this.games.set(team, list);
  }

  /** His share of the team's targets + carries over the window (0 when the team has none yet). */
  share(team: string, id: string): number {
    let mine = 0;
    let all = 0;
    for (const g of this.games.get(team) ?? [])
      for (const [p, n] of g) {
        all += n;
        if (p === id) mine += n;
      }
    return all ? mine / all : 0;
  }
}

/** The ids on a report that count as out (Out, Doubtful, IR, Suspension). */
export const outIds = (report: ReportEntry[]) => new Set(report.filter((r) => isOut(r.status)).map((r) => r.id));

/**
 * One team's two numbers for a game.
 * `lastQb`: the id of the QB who started its previous game. `prevOut`: ids
 * out on its previous report. `share`: usage share by player id.
 */
export function teamOut(report: ReportEntry[], o: { lastQb?: string; prevOut: Set<string>; share: (id: string) => number; nameOf?: (id: string) => string | undefined }): TeamOut {
  let qbOut = 0;
  let skillOut = 0;
  const names: string[] = [];
  for (const r of report) {
    if (!isOut(r.status)) continue;
    if (o.lastQb && r.id === o.lastQb) {
      qbOut = 1;
      const n = o.nameOf?.(r.id);
      if (n) names.push(`${n} (QB)`);
    }
    if (SKILL_POS.has(r.pos) && !o.prevOut.has(r.id)) {
      const sh = o.share(r.id);
      skillOut += sh;
      const n = o.nameOf?.(r.id);
      if (n && sh >= NAME_SHARE) names.push(`${n} (${r.pos})`);
    }
  }
  return { qbOut, skillOut: Math.round(skillOut * 1e4) / 1e4, ...(o.nameOf ? { names } : {}) };
}

/** The guard: a team missing its starting QB or at least `skillMin` of its usage, newly. */
export const bigOut = (t: TeamOut | undefined, skillMin: number) => !!t && (t.qbOut > 0 || t.skillOut >= skillMin);

/**
 * The guard's skillOut cut. From scripts/fit-nfl-injuries.mts (2015-2026,
 * closing lines): at 0.15 and below, games with a team that far short were
 * noisier (the line's squared miss 172.9 vs 159.3 in the rest); at 0.2 the
 * gap was gone (160.7 vs 161.3). 0.15 flags about 1 game in 7.
 */
export const SKILL_OUT_GUARD = 0.15;

/** Both teams' numbers for a game and whether the guard holds it. */
export interface InjuryRead {
  home: TeamOut;
  away: TeamOut;
  flagged: boolean;
}

export const injuryRead = (home: TeamOut, away: TeamOut, cut = SKILL_OUT_GUARD): InjuryRead => ({ home, away, flagged: bigOut(home, cut) || bigOut(away, cut) });

/** True when a game carries the injury flag (Jack, 2026-11-02: show the flag only; it does not hold any pick or tracking). */
export const injuryHeld = (o: { injury?: { flagged?: boolean } } | undefined | null) => !!o?.injury?.flagged;

/** A usage book from nflverse weekly rows (data.ts NflRow): one team-game per season, week and team, in order. */
export function bookFromRows(rows: { id: string; season: number; week: number; team: string; tgt: number; car: number }[], window = USAGE_WINDOW): UsageBook {
  const games = new Map<string, { season: number; week: number; team: string; rows: { id: string; opp: number }[] }>();
  for (const r of rows) {
    const team = normTeam(r.team);
    const k = `${r.season}|${r.week}|${team}`;
    const g = games.get(k) ?? { season: r.season, week: r.week, team, rows: [] };
    g.rows.push({ id: r.id, opp: r.tgt + r.car });
    games.set(k, g);
  }
  const book = new UsageBook(window);
  for (const g of [...games.values()].sort((a, b) => a.season - b.season || a.week - b.week)) book.add(g.team, g.rows);
  return book;
}

/**
 * ESPN roster statuses into a report: each athlete matched by name key to the
 * team's nflverse id and position (players nflverse never saw are left out:
 * they have no usage share and can't be last game's starter).
 */
export function rosterReport(roster: { key: string; status?: string }[], players: Map<string, { id: string; pos: string }>): ReportEntry[] {
  const out: ReportEntry[] = [];
  for (const a of roster) {
    const p = players.get(a.key);
    if (p && a.status) out.push({ id: p.id, pos: p.pos, status: a.status });
  }
  return out;
}
