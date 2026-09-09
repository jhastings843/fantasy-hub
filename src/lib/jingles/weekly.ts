import { detectScoring, htmlToLines, type Scoring } from "./parse";

// Reading his weekly rankings post, which is a different document from the
// Lab 300 and could not be read by the parser built for that one.
//
// A Lab 300 row is "1: Jahmyr Gibbs | RB1 | DET": rank, position rank, team.
// A weekly row is "1: Joe Burrow | CIN vs TB": rank, team, opponent. The rank
// IS the position rank, because the list is already split into a section per
// position, and what the third field carries is the matchup rather than the
// position. Run parseRankings() over the real Week 1 post and it returns zero
// rows, which is exactly what production would have stored.
//
// Verified against the real 2026-09-08 post: seven sections, 407 rows.
//
//   QB Rankings              32 rows
//   RB Rankings              65
//   WR Rankings              80
//   TE Rankings              32
//   D/ST Rankings            24
//   Kicker Rankings          24
//   Top 150 FLEX Rankings   150   "1: Jahmyr Gibbs | RB | DET vs NO"
//
// The FLEX list is the interesting one. It contains only RB, WR and TE, no
// quarterbacks, and it is the only cross-position ordering he publishes, which
// makes it the only honest way to fill a FLEX slot from his work rather than
// from a number we made up.
//
// Nothing here touches the network, so all of it is testable.

/** Section headings, as he writes them, mapped to Sleeper's position codes. */
const SECTION_POSITION: Record<string, string> = {
  QB: "QB",
  RB: "RB",
  WR: "WR",
  TE: "TE",
  "D/ST": "DEF",
  DST: "DEF",
  Kicker: "K",
  K: "K",
};

const SECTION_HEADER = /^(QB|RB|WR|TE|D\/ST|DST|Kicker|K)\s+Rankings$/i;
const FLEX_HEADER = /^Top\s+\d+\s+FLEX\s+Rankings$/i;

// "1: Joe Burrow | CIN vs TB". The name is lazy so it stops at the pipe, which
// keeps periods and apostrophes ("C.J. Stroud", "Ja'Marr Chase") inside it.
const POSITIONAL_ROW =
  /^(\d+):\s*(.+?)\s*\|\s*([A-Z]{2,4})\s+(vs\.?|@)\s+([A-Z]{2,4})\s*$/i;

// "1: Jahmyr Gibbs | RB | DET vs NO". Same, with the position in the middle.
const FLEX_ROW =
  /^(\d+):\s*(.+?)\s*\|\s*([A-Z/]{1,4})\s*\|\s*([A-Z]{2,4})\s+(vs\.?|@)\s+([A-Z]{2,4})\s*$/i;

const LAST_UPDATED = /^Last Updated:\s*(.+?)\s*$/i;

/** "2026 Week 1 Fantasy Football Rankings" -> season 2026, week 1. */
const TITLE_WEEK = /(\d{4}).*?\bweek\s+(\d+)\b/i;

export interface WeeklyRow {
  /** Rank within its own section, which for a positional list is the position rank. */
  rank: number;
  name: string;
  /** Sleeper's code: QB, RB, WR, TE, DEF, K. */
  position: string;
  team: string;
  opponent: string;
  /** True for "vs", false for "@". */
  home: boolean;
}

export interface ParsedWeekly {
  week: number | null;
  season: string | null;
  scoring: Scoring;
  /**
   * His own "Last Updated" line, kept as he wrote it.
   *
   * Deliberately the raw label rather than a parsed timestamp. Its only job is
   * to answer "has this post changed since we read it", and a string compare
   * does that exactly, where a parsed date adds a timezone to get wrong. He
   * edits this post all week, so this is the field that decides whether a
   * re-read is worth storing.
   */
  updatedLabel: string | null;
  /** QB, RB, WR, TE, DEF, K. Absent keys mean the section was not in the post. */
  positional: Record<string, WeeklyRow[]>;
  flex: WeeklyRow[];
  /** Per section, ranks between 1 and the highest seen that no row claimed. */
  missingRanks: Record<string, number[]>;
  /** Per section, ranks claimed more than once. */
  duplicateRanks: Record<string, number[]>;
}

function row(
  rank: string,
  name: string,
  position: string,
  team: string,
  vsOrAt: string,
  opponent: string,
): WeeklyRow {
  return {
    rank: Number(rank),
    name: name.trim(),
    position: position.toUpperCase(),
    team: team.toUpperCase(),
    opponent: opponent.toUpperCase(),
    home: !vsOrAt.startsWith("@"),
  };
}

function integrity(rows: WeeklyRow[]): { missing: number[]; duplicate: number[] } {
  const seen = new Map<number, number>();
  for (const r of rows) seen.set(r.rank, (seen.get(r.rank) ?? 0) + 1);
  const highest = rows.reduce((n, r) => Math.max(n, r.rank), 0);
  const missing: number[] = [];
  for (let i = 1; i <= highest; i++) if (!seen.has(i)) missing.push(i);
  const duplicate = [...seen.entries()].filter(([, n]) => n > 1).map(([rank]) => rank);
  return { missing, duplicate };
}

/**
 * Which scoring this weekly list is for.
 *
 * detectScoring() is wrong here, and wrong in a way that reads as right, which
 * is worse. It takes the first scoring word it finds anywhere, and this post
 * names all three: "Everything below is ranked for Half-PPR. If you play Full
 * PPR or Standard, you can still use these rankings", followed by a paragraph
 * headed "Full PPR:" telling you how to adjust. Run detectScoring over it and
 * it answers full PPR, because that is the phrase it happens to reach first.
 * A half-PPR list labelled full PPR would then be quoted to three of Jack's
 * four leagues as if it already matched their scoring, and the mismatch warning
 * they need would go quiet.
 *
 * So this looks for him DECLARING the list's scoring rather than mentioning a
 * format: "my Half-PPR rankings", "ranked for Half-PPR". His advice about other
 * formats never takes that shape.
 *
 * Defaults to half PPR rather than unknown, because he publishes one weekly
 * list, has said so in it every week so far, and a default that stops the
 * pipeline is worse than a default that is right. detectScoring is still the
 * last resort, so a post that changes shape entirely is not silently mislabelled
 * half PPR when it says something else in its title.
 */
const DECLARED_SCORING =
  /\b(?:ranked for|rankings? for|my)\s+(full[\s-]?ppr|half[\s-]?ppr|standard|non[\s-]?ppr)\b/i;

export function weeklyScoring(lines: string[]): Scoring {
  for (const line of lines) {
    const m = line.match(DECLARED_SCORING);
    if (!m) continue;
    const said = m[1].toLowerCase().replace(/[\s-]/g, "");
    if (said === "fullppr") return "full_ppr";
    if (said === "halfppr") return "half_ppr";
    return "standard";
  }
  const fallback = detectScoring("", lines.join("\n"));
  return fallback === "unknown" ? "half_ppr" : fallback;
}

/**
 * Parse a weekly rankings post.
 *
 * Reports gaps and duplicates per section rather than quietly returning a short
 * list, the same contract parseRankings() holds. A section that lost twenty
 * players is not a smaller section, it is a broken one, and the caller has to
 * be able to tell which it is looking at.
 */
export function parseWeekly(html: string, title = ""): ParsedWeekly {
  const lines = htmlToLines(html);

  const positional: Record<string, WeeklyRow[]> = {};
  const flex: WeeklyRow[] = [];
  let section: string | null = null;
  let inFlex = false;
  let updatedLabel: string | null = null;

  for (const line of lines) {
    if (!updatedLabel) {
      const stamped = line.match(LAST_UPDATED);
      if (stamped) {
        updatedLabel = stamped[1];
        continue;
      }
    }

    if (FLEX_HEADER.test(line)) {
      inFlex = true;
      section = null;
      continue;
    }

    const header = line.match(SECTION_HEADER);
    if (header) {
      const mapped = SECTION_POSITION[header[1].toUpperCase()] ?? SECTION_POSITION[header[1]];
      section = mapped ?? null;
      inFlex = false;
      if (section) positional[section] ??= [];
      continue;
    }

    if (inFlex) {
      const m = line.match(FLEX_ROW);
      // A flex row without its middle field is not a flex row. Skipped rather
      // than guessed at: the position is the whole reason this list is useful.
      if (m) flex.push(row(m[1], m[2], m[3], m[4], m[5], m[6]));
      continue;
    }

    if (section) {
      const m = line.match(POSITIONAL_ROW);
      if (m) positional[section].push(row(m[1], m[2], section, m[3], m[4], m[5]));
    }
  }

  const missingRanks: Record<string, number[]> = {};
  const duplicateRanks: Record<string, number[]> = {};
  for (const [pos, rows] of Object.entries(positional)) {
    const { missing, duplicate } = integrity(rows);
    if (missing.length) missingRanks[pos] = missing;
    if (duplicate.length) duplicateRanks[pos] = duplicate;
  }
  const flexIntegrity = integrity(flex);
  if (flexIntegrity.missing.length) missingRanks.FLEX = flexIntegrity.missing;
  if (flexIntegrity.duplicate.length) duplicateRanks.FLEX = flexIntegrity.duplicate;

  const titled = title.match(TITLE_WEEK);

  return {
    week: titled ? Number(titled[2]) : null,
    season: titled ? titled[1] : null,
    scoring: weeklyScoring(lines),
    updatedLabel,
    positional,
    flex,
    missingRanks,
    duplicateRanks,
  };
}

/** True when this post is his weekly list rather than a season-long one. */
export function isWeeklyRankingsTitle(title: string): boolean {
  return /\bweek\s+\d+\b/i.test(title) && /\brankings?\b/i.test(title);
}
