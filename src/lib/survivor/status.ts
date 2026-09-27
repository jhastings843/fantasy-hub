import type { Game, PoolConfig } from "./types";

// Whether Jack is still in the pool, read off his own picks and the final scores.
//
// Derived rather than stored, for the same reason burned teams are: a flag set
// by hand is a flag somebody forgets to set, and then the Thursday email spends
// fifteen weeks telling a dead entry who to pick. The scores are already on
// every game the engine reads, so the answer is free and lands the minute the
// losing game goes final.
//
// A new season is a new pool key with no picks, so this resets on its own.

export interface SettledPick {
  week: number;
  team: string;
  opponent: string;
  home: boolean;
  teamScore: number;
  oppScore: number;
  result: "W" | "L" | "T";
}

export interface EntryStatus {
  alive: boolean;
  /** Losses so far, ties counted as losses where the pool says so. */
  losses: number;
  strikes: number;
  /** Every pick whose game is final, oldest first. */
  record: SettledPick[];
  /** The loss that ended it. Null while alive. */
  endedBy: SettledPick | null;
}

export function settlePick(week: number, team: string, games: Game[]): SettledPick | null {
  const g = games.find((x) => x.week === week && (x.home === team || x.away === team));
  if (!g || !g.completed || g.homeScore == null || g.awayScore == null) return null;
  const home = g.home === team;
  const teamScore = home ? g.homeScore : g.awayScore;
  const oppScore = home ? g.awayScore : g.homeScore;
  return {
    week,
    team,
    opponent: home ? g.away : g.home,
    home,
    teamScore,
    oppScore,
    result: teamScore > oppScore ? "W" : teamScore < oppScore ? "L" : "T",
  };
}

export function entryStatus(pool: PoolConfig, games: Game[]): EntryStatus {
  const strikes = Math.max(1, pool.strikes ?? 1);
  const record = Object.entries(pool.myPicks ?? {})
    .map(([w, team]) => settlePick(Number(w), team, games))
    .filter((p): p is SettledPick => p !== null)
    .sort((a, b) => a.week - b.week);

  let losses = 0;
  let endedBy: SettledPick | null = null;
  for (const p of record) {
    const lost = p.result === "L" || (p.result === "T" && !pool.tieAdvances);
    if (!lost) continue;
    losses += 1;
    if (losses >= strikes && !endedBy) endedBy = p;
  }

  // A rebuy pool can bring a dead entry back, and only Jack knows whether he
  // paid. Keep advising rather than go quiet on an entry that may be live.
  const alive = pool.canRebuy || endedBy === null;
  return { alive, losses, strikes, record, endedBy: alive ? null : endedBy };
}

/** "SEA lost 31-33 at WAS in week 3". */
export function endedSentence(p: SettledPick): string {
  const verb = p.result === "T" ? "tied" : "lost";
  return `${p.team} ${verb} ${p.teamScore}-${p.oppScore} ${p.home ? "vs" : "at"} ${p.opponent} in week ${p.week}`;
}
