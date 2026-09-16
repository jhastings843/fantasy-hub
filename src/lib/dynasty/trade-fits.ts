// Pure logic for suggesting trade fits between two teams based on
// positional surplus / deficit. Safe to import from client components.

import type { PlayerRow, TeamSummary } from "./power-rankings";

export interface TradeFit {
  position: string;
  side: "send" | "receive";
  yourRank: number;
  theirRank: number;
  suggested: PlayerRow[];
}

const TRADE_POSITIONS = ["QB", "RB", "WR", "TE"] as const;

export function tradeRooms(team: TeamSummary, totalTeams: number) {
  return {
    surplus: TRADE_POSITIONS.filter((pos) => (team.positionRanks[pos] ?? 99) <= 4),
    deficit: TRADE_POSITIONS.filter((pos) =>
      (team.positionRanks[pos] ?? 99) >= Math.max(1, totalTeams - 2)),
  };
}

export function suggestTradeFits(
  myTeam: TeamSummary,
  partner: TeamSummary,
  totalTeams: number,
): TradeFit[] {
  const fits: TradeFit[] = [];
  const yours = tradeRooms(myTeam, totalTeams);
  const theirs = tradeRooms(partner, totalTeams);

  for (const pos of TRADE_POSITIONS) {
    const myRank = myTeam.positionRanks[pos] ?? 99;
    const theirRank = partner.positionRanks[pos] ?? 99;

    if (yours.surplus.includes(pos) && theirs.deficit.includes(pos)) {
      const candidates = myTeam.players
        .filter((p) => p.position === pos)
        .sort((a, b) => a.value - b.value);
      const lowest = candidates.slice(1, 4);
      if (lowest.length > 0) {
        fits.push({
          position: pos,
          side: "send",
          yourRank: myRank,
          theirRank,
          suggested: lowest,
        });
      }
    }

    if (theirs.surplus.includes(pos) && yours.deficit.includes(pos)) {
      const candidates = partner.players
        .filter((p) => p.position === pos)
        .sort((a, b) => a.value - b.value);
      const lowest = candidates.slice(1, 4);
      if (lowest.length > 0) {
        fits.push({
          position: pos,
          side: "receive",
          yourRank: myRank,
          theirRank,
          suggested: lowest,
        });
      }
    }
  }

  return fits;
}
