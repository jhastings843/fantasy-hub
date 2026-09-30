// What the rest of the room is about to buy.
//
// The chop line used to be drawn against every rival's roster as it stood on
// Tuesday, which is the one version of the field that never takes the field on
// Sunday. Week 4 made the cost plain: the Tuesday email had Jack 3rd lowest of
// 13 and said to stay selective, and by 3:13 the next morning burnerr28 had
// bought Amon-Ra St. Brown for $502 and jumped from 9th to 3rd, Uberfilms had
// bought Josh Allen for $461, and Jack was last. Nobody in the room did
// anything surprising. A team with a hole and money filled the hole.
//
// So this plays the auction forward before the sim runs. Every rival with money
// is offered every player on the wire, and the claim that helps somebody most
// lands first, on the team it helps most. That is not a prediction of who wins
// each bid; nine teams bid on St. Brown and any of them could have. It is a
// prediction of what the field looks like on Sunday, which is the only thing
// the chop line needs: the best players on the wire end up in somebody's
// lineup, and the team that needed them most is the likeliest somebody.

import { bestLineup, type LineupPlayer } from "./lineup";

export interface RoomTeam {
  rosterId: number;
  name: string;
  /** FAAB left. A team with none can still claim for $0, but rarely wins. */
  faabLeft: number;
  /** Every rostered player, points already zeroed for anyone ruled out. */
  players: LineupPlayer[];
}

export interface RoomCandidate extends LineupPlayer {
  name: string;
}

export interface ProjectedClaim {
  rosterId: number;
  team: string;
  playerId: string;
  name: string;
  position: string;
  points: number;
  /** What he adds to that team's starting lineup this week. */
  gain: number;
}

/**
 * Below this a claim is not worth modelling. Matches the advisor's own
 * RIVAL_NEED_GAIN: two points is where a rival would actually start him.
 */
const MIN_GAIN = 2;

/**
 * One headline claim per team per week. Week 4 had seven winning claims across
 * seven teams, and the second claim a team does win is usually a $1 bench body
 * that never starts. Letting one team take three upgrades would describe a
 * room that does not exist.
 */
const CLAIMS_PER_TEAM = 1;

/** How many of the best wire players are worth offering around. */
const CANDIDATE_DEPTH = 60;

export function lineupTotal(players: LineupPlayer[], rosterPositions: string[]): number {
  return bestLineup(players, rosterPositions).slots.reduce(
    (sum, s) => sum + (s.player?.points ?? 0),
    0,
  );
}

export function projectRoomClaims(
  teams: RoomTeam[],
  candidates: RoomCandidate[],
  rosterPositions: string[],
  options: { minGain?: number; perTeam?: number } = {},
): ProjectedClaim[] {
  const minGain = options.minGain ?? MIN_GAIN;
  const perTeam = options.perTeam ?? CLAIMS_PER_TEAM;

  const pool = [...candidates]
    .filter((c) => c.points > 0)
    .sort((a, b) => b.points - a.points)
    .slice(0, CANDIDATE_DEPTH);
  const rosters = new Map(teams.map((t) => [t.rosterId, [...t.players]]));
  const base = new Map(teams.map((t) => [t.rosterId, lineupTotal(t.players, rosterPositions)]));
  const won = new Map<number, number>();
  const taken = new Set<string>();
  const claims: ProjectedClaim[] = [];

  for (;;) {
    let best: { team: RoomTeam; player: RoomCandidate; gain: number } | null = null;
    for (const team of teams) {
      if ((won.get(team.rosterId) ?? 0) >= perTeam) continue;
      // A broke team does not win a contested claim, and every claim worth
      // modelling is contested.
      if (team.faabLeft <= 0) continue;
      const roster = rosters.get(team.rosterId)!;
      const before = base.get(team.rosterId)!;
      for (const player of pool) {
        if (taken.has(player.playerId)) continue;
        const gain = lineupTotal([...roster, player], rosterPositions) - before;
        if (gain < minGain) continue;
        if (
          !best ||
          gain > best.gain + 1e-9 ||
          // Same gain, richer team: the one who can pay more usually does.
          (Math.abs(gain - best.gain) <= 1e-9 && team.faabLeft > best.team.faabLeft)
        ) {
          best = { team, player, gain };
        }
      }
    }
    if (!best) break;

    const { team, player, gain } = best;
    taken.add(player.playerId);
    won.set(team.rosterId, (won.get(team.rosterId) ?? 0) + 1);
    const roster = rosters.get(team.rosterId)!;
    roster.push(player);
    base.set(team.rosterId, lineupTotal(roster, rosterPositions));
    claims.push({
      rosterId: team.rosterId,
      team: team.name,
      playerId: player.playerId,
      name: player.name,
      position: player.position,
      points: player.points,
      gain: Math.round(gain * 10) / 10,
    });
  }

  return claims;
}

/** Each team's roster with its projected claim added. */
export function withClaims(
  teams: RoomTeam[],
  claims: ProjectedClaim[],
  candidates: RoomCandidate[],
): RoomTeam[] {
  const byId = new Map(candidates.map((c) => [c.playerId, c]));
  return teams.map((team) => {
    const added = claims
      .filter((c) => c.rosterId === team.rosterId)
      .map((c) => byId.get(c.playerId))
      .filter((p): p is RoomCandidate => p != null);
    return added.length === 0 ? team : { ...team, players: [...team.players, ...added] };
  });
}
