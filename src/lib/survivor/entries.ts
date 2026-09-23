import { NFL_TEAMS } from "./teams";

// Who picked what, entry by entry.
//
// The pool's own board is the only place this exists. Percentages tell you how
// the field is split this week, which is all the equity maths needs, but they
// cannot tell you which entries are carrying which burned teams, and that is
// the thing that decides the back half of a season: a team forty percent of
// the field has used is a team forty percent of the field cannot follow you
// onto, and knowing WHICH forty percent is the difference between an estimate
// and a fact.
//
// The engine's own model of this is explicit about being an approximation. It
// thins each team's carriers at the overall survival rate, which assumes the
// team an entry burned in week 1 says nothing about whether it survived week
// 4. Entries that took the chalk survived together and share a burn list, so
// the assumption is false in exactly the way that matters. These rows end it.

export interface PoolEntry {
  name: string;
  /** Week number as a string, to the team abbreviation picked. */
  picks: Record<string, string>;
}

export type EntryParse =
  | { ok: true; entries: PoolEntry[]; weeks: number[] }
  | { ok: false; error: string };

const VALID = new Set(NFL_TEAMS.map((t) => t.abbr));

/** Aliases a board might print that are not the Sleeper abbreviation. */
const ALIAS: Record<string, string> = {
  JAC: "JAX",
  WSH: "WAS",
  WFT: "WAS",
  LA: "LAR",
  STL: "LAR",
  SD: "LAC",
  OAK: "LV",
  LVR: "LV",
  TBB: "TB",
  KAN: "KC",
  SFO: "SF",
  GNB: "GB",
  NWE: "NE",
  NOR: "NO",
  ARZ: "ARI",
  CLV: "CLE",
  BLT: "BAL",
  HST: "HOU",
};

const canon = (raw: string): string | null => {
  const key = raw.toUpperCase().replace(/[^A-Z]/g, "");
  const mapped = ALIAS[key] ?? key;
  return VALID.has(mapped) ? mapped : null;
};

/**
 * Read a pool board, one entry per line.
 *
 * Deliberately forgiving about shape, because this text arrives three ways: a
 * copy and paste off the pool's own site, a transcription of a screenshot, and
 * Jack typing it. What it is strict about is the team codes, since a line that
 * yields no team is a line that was never an entry row.
 *
 *   Jack Hastings: JAX, SF
 *   1. Marlon Wiley  JAX  SF
 *   Jordan Carter | PIT | SF | KC
 */
export function parseEntries(text: string, startWeek = 1): EntryParse {
  const entries: PoolEntry[] = [];
  const weeks = new Set<number>();

  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;

    // A leading list number is decoration, not a week.
    const body = line.replace(/^\s*\d{1,3}[.)]\s*/, "");

    // The name runs until the first separator or the first team code. Anything
    // after that is picks, in week order.
    const parts = body
      .split(/[|,\t]|\s{2,}|\s+/)
      .map((p) => p.trim())
      .filter(Boolean);

    const nameParts: string[] = [];
    const picks: string[] = [];
    for (const part of parts) {
      const team = canon(part.replace(/[:;]/g, ""));
      // A short word before any pick is part of the name, not a team, unless it
      // really is a team code: "Jack" is not a team, "NO" is.
      if (team && (picks.length > 0 || nameParts.length > 0)) picks.push(team);
      else nameParts.push(part);
    }

    const name = nameParts.join(" ").replace(/[:|]+$/, "").trim();
    if (!name || picks.length === 0) continue;

    const byWeek: Record<string, string> = {};
    picks.forEach((team, i) => {
      const week = startWeek + i;
      byWeek[String(week)] = team;
      weeks.add(week);
    });
    entries.push({ name, picks: byWeek });
  }

  if (entries.length === 0) {
    return { ok: false, error: "No entries found. One entry per line: a name, then the teams in week order." };
  }

  return { ok: true, entries, weeks: [...weeks].sort((a, b) => a - b) };
}

export interface EntryDerived {
  /** Entries still alive: they have a pick in every week that has been logged. */
  alive: number;
  /** Fraction of the ALIVE entries carrying each team, exactly rather than modelled. */
  burned: Record<string, number>;
  /** This week's distribution, as a fraction of the alive entries. */
  picksThisWeek: Record<string, number>;
  /** Teams no surviving entry has used, which is what the field can still follow you onto. */
  untouched: string[];
}

/**
 * What the rows mean, once you have them.
 *
 * Alive is defined by having a pick in the last completed week rather than by
 * a status column, because every board draws elimination differently and none
 * of them survive a copy and paste, while a missing pick is unambiguous.
 */
export function deriveFromEntries(
  entries: PoolEntry[],
  completedThrough: number,
  week: number,
): EntryDerived {
  const survived = entries.filter((e) => {
    for (let w = 1; w <= completedThrough; w++) {
      if (!e.picks[String(w)]) return false;
    }
    return true;
  });

  const alive = survived.length;
  const carrying: Record<string, number> = {};
  const thisWeek: Record<string, number> = {};

  for (const entry of survived) {
    for (const [w, team] of Object.entries(entry.picks)) {
      if (Number(w) > completedThrough) continue;
      carrying[team] = (carrying[team] ?? 0) + 1;
    }
    const pick = entry.picks[String(week)];
    if (pick) thisWeek[pick] = (thisWeek[pick] ?? 0) + 1;
  }

  const asFraction = (counts: Record<string, number>): Record<string, number> =>
    Object.fromEntries(
      Object.entries(counts).map(([team, n]) => [team, alive > 0 ? n / alive : 0]),
    );

  return {
    alive,
    burned: asFraction(carrying),
    picksThisWeek: asFraction(thisWeek),
    untouched: NFL_TEAMS.map((t) => t.abbr).filter((abbr) => !carrying[abbr]),
  };
}
