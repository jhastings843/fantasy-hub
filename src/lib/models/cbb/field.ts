import "server-only";
import { REGIONS, type BracketField, type BracketTeam, type Region } from "./bracket-types";
import { CBB_PARAMS, teamStrengths } from "./store";

// The bracket optimizer's field. Until Selection Sunday it is projected from
// today's blended ratings, the way the committee builds a bracket:
//   1. 68 teams: the best team in each conference takes its auto bid, the
//      best of the rest fill the at-large spots.
//   2. First Four: the four lowest-rated auto bids play for two 16 lines and
//      the four lowest-rated at-larges for two 11-ish lines; the better-rated
//      side of each game advances (they are near coin flips, so this is a
//      projection, not a pick). That leaves 64.
//   3. Seeded 1-64 on the S-curve and dealt into four regions so each seed
//      line is balanced (1st, 8th, 9th and 16th overall in one region).
//   4. Final Four: the regions holding the 1st and 4th overall meet, and
//      the 2nd and 3rd, so the top two can only meet in the title game.
// Public pick shares are left to the optimizer's estimate until Yahoo and
// ESPN post theirs.

/** Region for the nth team (0-based) on the S-curve: rows of four snake back and forth. */
export function sCurveRegion(n: number): Region {
  const row = Math.floor(n / 4);
  const i = n % 4;
  return REGIONS[row % 2 === 0 ? i : 3 - i];
}

export function projectField(
  teams: { id: string; location: string; short: string; abbr: string; logo?: string; rating: number; tempo?: number; conf: string }[],
  meta: { season: number; asOf: string; sigma: number },
): BracketField {
  const rated = teams.filter((t) => t.conf && Number.isFinite(t.rating)).sort((a, b) => b.rating - a.rating);
  const auto = new Map<string, (typeof rated)[number]>();
  for (const t of rated) if (!auto.has(t.conf)) auto.set(t.conf, t);
  const autos = [...auto.values()];
  const autoIds = new Set(autos.map((t) => t.id));
  const atLarge = rated.filter((t) => !autoIds.has(t.id)).slice(0, Math.max(0, 68 - autos.length));
  // First Four: drop the loser (lower rating) of the two games among the four weakest autos, and of the two among the four weakest at-larges.
  const firstFourLosers = (xs: (typeof rated)[number][]) => {
    const four = [...xs].sort((a, b) => a.rating - b.rating).slice(0, 4);
    if (four.length < 4) return [];
    // Pair 1st with 4th weakest and 2nd with 3rd, as close to even as the four allow; each game's weaker side goes home.
    return [four[0], four[1]].map((t) => t.id);
  };
  const out68 = [...autos, ...atLarge];
  const gone = new Set(out68.length >= 68 ? [...firstFourLosers(autos), ...firstFourLosers(atLarge)] : []);
  const field = out68.filter((t) => !gone.has(t.id)).sort((a, b) => b.rating - a.rating).slice(0, 64);
  const out: BracketTeam[] = field.map((t, n) => ({
    id: t.id,
    name: t.location,
    short: t.short,
    abbr: t.abbr,
    conf: t.conf,
    seed: Math.floor(n / 4) + 1,
    region: sCurveRegion(n),
    rating: t.rating,
    tempo: t.tempo,
    logo: t.logo ?? `https://a.espncdn.com/i/teamlogos/ncaa/500/${t.id}.png`,
  }));
  // Overall 1 is in REGIONS[0], 2 in [1], 3 in [2], 4 in [3]: 1 meets 4 and 2 meets 3 in the semis.
  return { source: "projected", season: meta.season, asOf: meta.asOf, teams: out, sigma: meta.sigma, publicSource: "estimate", semis: [[REGIONS[0], REGIONS[3]], [REGIONS[1], REGIONS[2]]] };
}

export async function getBracketField(now = new Date()): Promise<BracketField> {
  const s = await teamStrengths(now);
  return projectField(s.teams, { season: s.season, asOf: s.trankAt ?? now.toISOString(), sigma: CBB_PARAMS.sigma });
}
