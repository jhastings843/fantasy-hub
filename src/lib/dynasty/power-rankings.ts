import "server-only";
import type {
  SleeperPlayer,
  SleeperPlayersById,
  SleeperRoster,
  SleeperUser,
} from "@/lib/sleeper/types";

// Structural value shape that any value source can satisfy
// (RosterAudit, FantasyCalc, etc.).
export interface PlayerValueLike {
  value: number;
  overallRank: number;
  positionRank: number;
  position: string;
  // Optional richer fields some sources provide (RosterAudit only today).
  photoUrl?: string | null;
  buyLow?: boolean;
  sellHigh?: boolean;
  breakout?: boolean;
  // Present only where a league blends his season list into the market value
  // (see lib/redraft/jingles-values.ts). marketValue is what the source said
  // before the blend; jinglesRank is null when he left the player off.
  marketValue?: number;
  marketPositionRank?: number;
  jinglesRank?: number | null;
  jinglesPositionRank?: number | null;
}
export type PlayerValuesBySleeperId = Record<string, PlayerValueLike>;

export const POSITIONS = ["QB", "RB", "WR", "TE", "K", "DEF"] as const;
export type Position = (typeof POSITIONS)[number];

export type PlayerRow = {
  id: string;
  name: string;
  position: string;
  team: string | null;
  value: number;
  overallRank: number;
  positionRank: number;
  age?: number | null;
  photoUrl?: string | null;
  buyLow?: boolean;
  sellHigh?: boolean;
  breakout?: boolean;
  marketValue?: number;
  marketPositionRank?: number;
  jinglesRank?: number | null;
  jinglesPositionRank?: number | null;
};

export type TeamSummary = {
  rosterId: number;
  ownerName: string;
  totalValue: number;
  positionTotals: Record<string, number>;
  positionRanks: Record<string, number>;
  players: PlayerRow[];
};

function ownerName(
  roster: SleeperRoster,
  usersById: Map<string, SleeperUser>,
): string {
  const u = roster.owner_id ? usersById.get(roster.owner_id) : null;
  if (!u) return "Unowned";
  return (
    u.metadata?.team_name || u.display_name || u.username || u.user_id
  );
}

function nameOf(p: SleeperPlayer): string {
  if (p.full_name) return p.full_name;
  return `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || p.player_id;
}

const KNOWN_POSITIONS = new Set<string>(POSITIONS);

export function computeTeamSummaries(
  rosters: SleeperRoster[],
  users: SleeperUser[],
  players: SleeperPlayersById,
  fcValues: PlayerValuesBySleeperId,
): TeamSummary[] {
  const usersById = new Map(users.map((u) => [u.user_id, u]));

  const summaries: TeamSummary[] = rosters.map((r) => {
    const playerRows: PlayerRow[] = (r.players ?? [])
      .map((id): PlayerRow | null => {
        const p = players[id];
        const v = fcValues[id];
        if (!p) return null;
        return {
          id,
          name: nameOf(p),
          position: p.position ?? v?.position ?? "FLEX",
          team: p.team ?? null,
          value: v?.value ?? 0,
          overallRank: v?.overallRank ?? 0,
          positionRank: v?.positionRank ?? 0,
          age: typeof p.age === "number" ? p.age : null,
          photoUrl: v?.photoUrl ?? null,
          buyLow: v?.buyLow ?? false,
          sellHigh: v?.sellHigh ?? false,
          breakout: v?.breakout ?? false,
          marketValue: v?.marketValue,
          marketPositionRank: v?.marketPositionRank,
          jinglesRank: v?.jinglesRank,
          jinglesPositionRank: v?.jinglesPositionRank,
        };
      })
      .filter((x): x is PlayerRow => x !== null)
      .sort((a, b) => b.value - a.value);

    const positionTotals: Record<string, number> = {};
    for (const pos of POSITIONS) positionTotals[pos] = 0;
    for (const pl of playerRows) {
      if (KNOWN_POSITIONS.has(pl.position)) {
        positionTotals[pl.position] += pl.value;
      }
    }
    const totalValue = Object.values(positionTotals).reduce((a, b) => a + b, 0);

    return {
      rosterId: r.roster_id,
      ownerName: ownerName(r, usersById),
      totalValue,
      positionTotals,
      positionRanks: {},
      players: playerRows,
    };
  });

  for (const pos of POSITIONS) {
    const sorted = [...summaries].sort(
      (a, b) => (b.positionTotals[pos] ?? 0) - (a.positionTotals[pos] ?? 0),
    );
    sorted.forEach((s, idx) => {
      s.positionRanks[pos] = idx + 1;
    });
  }

  return summaries;
}

