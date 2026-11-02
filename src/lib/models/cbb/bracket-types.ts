// The shape the bracket optimizer reads (src/lib/models/cbb/bracket.ts) and
// the field loader writes (src/lib/models/cbb/field.ts). Pure types.

export const REGIONS = ["East", "West", "South", "Midwest"] as const;
export type Region = (typeof REGIONS)[number];

export interface BracketTeam {
  /** ESPN team id. */
  id: string;
  name: string;
  /** Short display name ("Duke", "Michigan St."). */
  short: string;
  abbr: string;
  conf: string;
  seed: number;
  region: Region;
  /**
   * Neutral-floor strength in points over an average Division I team (our
   * blended model). P(A beats B) = phi((A.rating - B.rating) / sigma).
   */
  rating: number;
  /** Expected possessions vs an average team, for display only. */
  tempo?: number;
  /** ESPN logo URL. */
  logo?: string;
  /** Share of the public picking this team to reach each round (index 0 = win first game ... 5 = title), when known. */
  publicPick?: number[];
}

export interface BracketField {
  /** "projected": top 68 by today's ratings, seeded on the S-curve (Nov to Selection Sunday). "official": the real bracket. */
  source: "projected" | "official";
  season: number;
  asOf: string;
  /** 64 teams after the First Four (each region seeds 1-16 once). */
  teams: BracketTeam[];
  /** Margin sigma the win chances use. */
  sigma: number;
  /** Where publicPick came from: "yahoo", "espn", or "estimate" (seed-and-strength model of how the public picks). */
  publicSource: "yahoo" | "espn" | "estimate";
  /** Final Four pairings: [region, region] semis. */
  semis: [[Region, Region], [Region, Region]];
}
