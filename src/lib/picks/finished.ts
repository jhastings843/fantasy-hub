// This week as the games finish: which week the board shows, and grading
// each game from its ESPN final the day it ends rather than waiting for the
// sites to post their records. Pure: `now` and every input are passed in.

import { type GradedGame, type PemLine, type Result, grade, gradeGame, key } from "./engine";
import { type League, type ModelLine, weekOf } from "./parse";

const ET = "America/New_York";
/** Monday night is over by 4am ET Tuesday; that is when the board turns over. */
const TURNOVER_HOURS = 4;

/**
 * The week the board shows: the calendar week (Tuesday 4am ET to the next
 * Tuesday 4am), whether or not either model has posted it yet. A site that
 * posts next week early waits for the turnover. If the calendar is more than
 * a week ahead of the sites (bowls, playoffs, the off-season), the sites'
 * week stands, so a numbering gap can't empty the board.
 */
export function boardWeek(league: League, sourceWeek: number | null, now: Date): { week: number | null; awaiting: boolean } {
  const etDate = new Date(now.getTime() - TURNOVER_HOURS * 3_600_000).toLocaleDateString("en-CA", { timeZone: ET });
  const cal = weekOf(league, etDate);
  const week = sourceWeek === null ? cal : cal > sourceWeek + 1 ? sourceWeek : cal;
  return { week, awaiting: sourceWeek === null || week > sourceWeek };
}

type Final = { home: number; away: number };
type Row = { home: string; away: string; sam?: ModelLine; david?: ModelLine; pem?: PemLine };

/**
 * This week's finished games graded from their finals at each site's own
 * line, the same way the backtest grades the sites' records. Games a site
 * has already graded are left to the site's version. Only games both models
 * posted are graded (the backtest needs both).
 */
export function gradeFinished(week: number | null, rows: Row[], finals: Map<string, Final>, graded: GradedGame[]): GradedGame[] {
  if (!week) return [];
  const have = new Set(graded.map(key));
  return rows.flatMap((r) => {
    const k = key({ week, home: r.home, away: r.away });
    const final = finals.get(k);
    if (!final || !r.sam || !r.david || have.has(k)) return [];
    return [gradeGame({ week, home: r.home, away: r.away, final, sam: r.sam, david: r.david, ...(r.pem ? { pem: r.pem } : {}) })];
  });
}

export interface FinishedResults {
  /** The board's call (agreed side, or the tiered play) at the line it was made. */
  pick?: Result;
  /** What the email sent, at the sent line. */
  issued?: Result;
  sam?: Result;
  david?: Result;
  pem?: Result;
}

/** Each model's result on one finished game, at that model's own line. */
export function finishedResults(
  g: Row & { side?: "home" | "away"; homeLine?: number; issued?: { homeLine: number; side: "home" | "away" } },
  final: Final,
): FinishedResults {
  const own = (m?: ModelLine) => (m && m.model !== m.market ? grade(final, m.market, m.model < m.market ? "home" : "away") : undefined);
  const markets = [g.sam?.market, g.david?.market].filter((x): x is number => x !== undefined);
  const pemAt = g.pem?.market ?? (markets.length ? markets.reduce((a, b) => a + b, 0) / markets.length : undefined);
  return {
    pick: g.side && g.homeLine !== undefined ? grade(final, g.homeLine, g.side) : undefined,
    issued: g.issued ? grade(final, g.issued.homeLine, g.issued.side) : undefined,
    sam: own(g.sam),
    david: own(g.david),
    pem: g.pem && pemAt !== undefined && g.pem.model !== pemAt ? grade(final, pemAt, g.pem.model < pemAt ? "home" : "away") : undefined,
  };
}
