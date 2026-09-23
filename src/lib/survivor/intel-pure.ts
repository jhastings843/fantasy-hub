import { NFL_TEAMS } from "./teams";
import type { InjuryNote } from "./types";

// Positions where a body being out moves a team's win probability enough to
// change a survivor pick. This list was WR and RB wide to begin with, and the
// first live run put three or four injury flags on every single candidate,
// which is the same as putting none on any of them. A running back being out
// does not turn an 82% favourite into a coin flip; a quarterback does, and a
// left tackle sometimes does.
export const PREMIUM_POSITIONS = new Set(["LT", "OT", "T"]);

export const OUT_STATUSES = new Set([
  "out",
  "injured reserve",
  "doubtful",
  "suspension",
]);

const BY_DISPLAY_NAME = new Map(
  NFL_TEAMS.map((t) => [`${t.city} ${t.name}`.toLowerCase(), t.abbr]),
);

export function abbrForDisplayName(name: string): string | null {
  return BY_DISPLAY_NAME.get(name.trim().toLowerCase()) ?? null;
}

export function isPremium(position: string, status: string): boolean {
  return PREMIUM_POSITIONS.has(position) && OUT_STATUSES.has(status.toLowerCase());
}

/**
 * The notes worth putting on a candidate card. A quarterback at any status
 * short of Active is always worth a line, because that is the one absence the
 * market can be slow on. Everyone else has to be a tackle who is actually out.
 * Two per team at most: a card with four warnings on it warns about nothing.
 */
export function notesForTeam(all: InjuryNote[], team: string): InjuryNote[] {
  return all
    .filter((n) => n.team === team)
    .filter((n) => n.position === "QB" || n.premium)
    .sort((a, b) => {
      const rank = (n: InjuryNote) =>
        (n.position === "QB" ? 0 : 2) +
        (OUT_STATUSES.has(n.status.toLowerCase()) ? 0 : 1);
      return rank(a) - rank(b);
    })
    .slice(0, 2);
}

export interface EspnInjuryFeed {
  injuries?: Array<{
    displayName?: string;
    injuries?: Array<{
      status?: string;
      shortComment?: string;
      athlete?: {
        displayName?: string;
        position?: { abbreviation?: string };
      };
    }>;
  }>;
}

/** ESPN's league-wide injury feed into our notes. Skips anyone listed Active. */
/**
 * `includeActive` keeps the entries ESPN files on players who are fine again.
 *
 * The survivor picks do not want them: a flag reading "QB is Active" is noise
 * on a card about win probabilities. The bid card wants them badly, because an
 * ESPN entry reading Active on a player Sleeper still has tagged Out is the
 * clearing, and dropping it here is what made Kyler Murray invisible.
 */
export function parseInjuries(data: EspnInjuryFeed, includeActive = false): InjuryNote[] {
  const out: InjuryNote[] = [];
  for (const block of data.injuries ?? []) {
    const abbr = abbrForDisplayName(block.displayName ?? "");
    if (!abbr) continue;
    for (const inj of block.injuries ?? []) {
      const status = (inj.status ?? "").trim();
      if (!status || (!includeActive && status.toLowerCase() === "active")) continue;
      const player = inj.athlete?.displayName ?? "";
      if (!player) continue;
      const position = inj.athlete?.position?.abbreviation ?? "";
      out.push({
        team: abbr,
        player,
        position,
        status,
        comment: inj.shortComment ?? "",
        premium: isPremium(position, status),
      });
    }
  }
  return out;
}
