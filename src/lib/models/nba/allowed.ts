// What each team has allowed by position this season, for the opponent-defense
// input (props.ts oppFactor, kOpp): per team, the opposing players' minutes and
// stats by position group, and the same for the whole league. Built from the
// season's finished games, the way scripts/fit-nba-props-inputs.mts builds it
// game by game. Pure.
//
//   allowedTables(games).teams.BOS.byPos.G -> { n: 1210, pts: 612, reb: 118, ast: 141, threes: 77 }  (n = minutes)

import type { NbaGame } from "./box";
import { NBA_STATS, posOf, type Allowed, type Pos } from "./props";

const POS: Pos[] = ["G", "F", "C"];
const empty = (): Allowed => ({ games: 0, byPos: Object.fromEntries(POS.map((p) => [p, { n: 0, pts: 0, reb: 0, ast: 0, threes: 0 }])) as Allowed["byPos"] });

export function allowedTables(games: NbaGame[]): { teams: { [team: string]: Allowed }; league: Allowed } {
  const teams: { [team: string]: Allowed } = {};
  const league = empty();
  for (const g of games) {
    league.games++;
    for (const t of [g.home, g.away]) {
      const o = t === g.home ? g.away : g.home;
      const a = (teams[t] ??= empty());
      a.games++;
      for (const l of g.players.filter((x) => x.team === o)) {
        const p = posOf(l.pos);
        a.byPos[p].n += l.min;
        league.byPos[p].n += l.min;
        for (const s of NBA_STATS) {
          a.byPos[p][s] += l[s];
          league.byPos[p][s] += l[s];
        }
      }
    }
  }
  return { teams, league };
}
