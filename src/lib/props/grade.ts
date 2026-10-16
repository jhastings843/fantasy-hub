// Grading a saved props page from ESPN's box score (the game summary's
// boxscore.players: passing, rushing and receiving tables per team, no key).
//
// Two things are graded per market:
// - Sam's play, when the page shows one (the gap clears the vig): his side at
//   the playing book's line and price, 1 unit risked.
// - The projection's lean, on every market: the side his number points to
//   from the shown line, at the playing book's price for that side. This is
//   the pure model, without his market read.
// A player missing from the box score didn't play: the market is void, as a
// book would void it. A player in the box score with no line in a table had
// zero of that stat (a back with no catches).

import { implied, payout, playPrice, type PropMarket, type PropsGame, type Side, type Stat } from "./parse";

export interface EspnBoxTeam {
  team?: { abbreviation?: string };
  statistics?: { name?: string; keys?: string[]; athletes?: { athlete?: { displayName?: string }; stats?: string[] }[] }[];
}

const SUFFIX = /\s+(jr|sr|ii|iii|iv|v)\.?$/i;
export const nameKey = (s: string) => s.replace(SUFFIX, "").toLowerCase().replace(/[^a-z]/g, "");

/** Every player's stat line from a box score, by name key. */
export function boxStats(players: EspnBoxTeam[]): Map<string, { [s in Stat]: number }> {
  const out = new Map<string, { [s in Stat]: number }>();
  const row = (k: string) => {
    let r = out.get(k);
    if (!r) out.set(k, (r = { pass_yds: 0, rush_yds: 0, rec_yds: 0, rec: 0 }));
    return r;
  };
  const want: { [table: string]: [string, Stat][] } = {
    passing: [["passingYards", "pass_yds"]],
    rushing: [["rushingYards", "rush_yds"]],
    receiving: [
      ["receivingYards", "rec_yds"],
      ["receptions", "rec"],
    ],
  };
  for (const t of players) {
    for (const table of t.statistics ?? []) {
      const keys = table.keys ?? [];
      // Every table counts as "he played", so a back with no catches reads 0 receptions.
      for (const a of table.athletes ?? []) {
        const name = a.athlete?.displayName;
        if (!name) continue;
        const r = row(nameKey(name));
        for (const [key, stat] of want[table.name ?? ""] ?? []) {
          const i = keys.indexOf(key);
          const v = i >= 0 ? Number(a.stats?.[i]) : NaN;
          if (Number.isFinite(v)) r[stat] = v;
        }
      }
    }
  }
  return out;
}

export type Outcome = "W" | "L" | "P";

export interface GradedBet {
  side: Side;
  line: number;
  price: number;
  book: string;
  outcome: Outcome;
  /** Units won or lost on 1 unit risked. */
  net: number;
  /** Break-even win rate at this price. */
  breakEven: number;
}

export interface GradedMarket {
  id: string;
  /** Null: the player didn't play (void). */
  actual: number | null;
  play: GradedBet | null;
  lean: GradedBet | null;
  /** Rotowire's lean from the same line, when its projection was saved. */
  rw?: GradedBet | null;
}

export interface GradedGame {
  markets: GradedMarket[];
  /** Markets that couldn't be graded: an unknown stat, or a player not in the box score. */
  void: number;
}

export function settle(side: Side, line: number, actual: number): Outcome {
  if (actual === line) return "P";
  return (side === "over") === actual > line ? "W" : "L";
}

function bet(m: PropMarket, side: Side | null, actual: number): GradedBet | null {
  if (!side) return null;
  const at = playPrice(m, side);
  if (!at) return null;
  const outcome = settle(side, at.line, actual);
  return {
    side,
    line: at.line,
    price: at.price,
    book: at.book,
    outcome,
    net: outcome === "W" ? Math.round(payout(at.price) * 1000) / 1000 : outcome === "L" ? -1 : 0,
    breakEven: Math.round(implied(at.price) * 1000) / 1000,
  };
}

/** Is this one of Sam's plays (the gap clears the vig)? */
export const isPlay = (m: PropMarket) => m.clears && m.side !== null;

export function gradeGame(g: PropsGame, players: EspnBoxTeam[], rw: { [id: string]: number } = {}): GradedGame {
  const box = boxStats(players);
  let voids = 0;
  const markets: GradedMarket[] = g.markets.map((m) => {
    const r = m.stat ? box.get(nameKey(m.player)) : undefined;
    if (!m.stat || !r) {
      voids++;
      return { id: m.id, actual: null, play: null, lean: null };
    }
    const actual = r[m.stat];
    const r2 = rw[m.id];
    const rwLean: Side | null = r2 === undefined ? null : r2 > m.line ? "over" : r2 < m.line ? "under" : null;
    return {
      id: m.id,
      actual,
      play: isPlay(m) ? bet(m, m.side, actual) : null,
      lean: bet(m, m.lean, actual),
      ...(r2 !== undefined ? { rw: bet(m, rwLean, actual) } : {}),
    };
  });
  return { markets, void: voids };
}
