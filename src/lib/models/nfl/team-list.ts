// Who our First TD and Anytime TD models list for a team (Jack, 2026-11-02).
//
// Before: everyone who played the team's last 3 games, less anyone ESPN lists
// Out or on IR. That left out players back from injury, so their teammates kept
// the shares they had picked up while he was gone (MNF Week 8: Jadarian Price
// and Zach Charbonnet back for Seattle, Emanuel Wilson still at 50% to score
// against DraftKings' +350).
//
// Now also: anyone on the team's ESPN roster, not Out or IR, who played for
// the team earlier this season, or who has no game this season at all but has
// last season's history (a season debut). Shares renormalize across the list,
// so a returner takes his share back from the rest.
//
//   last 3 games: Wilson, Holani; earlier this season: Price (now active);
//   no 2026 games, 2025 history: Charbonnet (now active)
//     -> Wilson, Holani, Price, Charbonnet
//
// Pure.

import type { TdLine } from "./firsttd";
import { addTotals } from "./firsttd";
import type { NflRow } from "./data";

type Tot = Omit<TdLine, "team">;

export interface TeamListInput {
  team: string;
  /** This season's rows, weeks before the game. */
  rows: NflRow[];
  /** Last season's totals by gsis id. */
  prior: { [id: string]: Tot };
  /** This season's totals by gsis id. */
  cur: Map<string, Tot>;
  /** nameKeys on the team's ESPN roster and not Out or IR. */
  active: Set<string>;
  /** nameKeys ESPN lists Out or IR. */
  out: Set<string>;
  nameKey: (name: string) => string;
}

export function teamList(x: TeamListInput): { lines: TdLine[]; returners: string[] } {
  const T = x.team;
  const mine = x.rows.filter((r) => r.team === T);
  const weeks = [...new Set(mine.map((r) => r.week))].sort((a, b) => a - b).slice(-3);
  const recent = new Set(mine.filter((r) => weeks.includes(r.week)).map((r) => r.id));
  const earlier = new Set(mine.map((r) => r.id).filter((id) => !recent.has(id)));
  const playedAnywhere = new Set(x.rows.map((r) => r.id));
  const debut = Object.keys(x.prior).filter((id) => !playedAnywhere.has(id));
  const returners: string[] = [];
  const ids = [...recent];
  for (const id of [...earlier, ...debut]) {
    const name = x.cur.get(id)?.name ?? x.prior[id]?.name;
    if (!name || !x.active.has(x.nameKey(name))) continue;
    ids.push(id);
    returners.push(name);
  }
  const lines = ids.flatMap((id) => {
    const tot = addTotals(x.prior[id], x.cur.get(id));
    return tot && !x.out.has(x.nameKey(tot.name)) ? [{ ...tot, team: T }] : [];
  });
  return { lines, returners: returners.filter((n) => lines.some((l) => l.name === n)) };
}
