// John Harris (@jhnhrris): his weekly college sheet and contest picks, as
// rows. Pure: parsing, matching to our games, the self-check. No network.
//
// Tracked, not used (Jack, 2026-10-08): his numbers never touch a bet. The
// tracker (harris-track.ts) grades them every week and the strategy review
// files a proposal only if his agreement with Sam and David clears the same
// bar any change must.
//
// The sheet is a picture of a spreadsheet. Each game is a block: a header
// row, the AWAY row, then the HOME row, which carries:
//   Average  his projected home margin (positive = home wins by that much)
//   Spread   the home team's line when he posted (e.g. -3.5)
//   Diff     his edge for the home side = Average + Spread
// So his line on our home-side scale is -Average, and every row checks
// itself: Average + Spread must equal Diff.

import { teamKey } from "./parse";

/** One game as a vision read (or a hand transcription) returns it. */
export interface SheetRow {
  away: string;
  home: string;
  average: number;
  spread: number;
  /** The home row's Diff; null when not read (hand transcriptions). */
  diff?: number | null;
}

/** Stored form, keyed like Sam and David, home-side lines. */
export interface HarrisRow {
  away: string;
  home: string;
  awayName: string;
  homeName: string;
  /** His line, home side (= -Average). */
  model: number;
  /** The line on his sheet, home side. */
  market: number;
}

export type PickTier = "best" | "strong" | "gow" | "other";

/** One of his posted contest picks, at the line he listed. */
export interface HarrisPick {
  tier: PickTier;
  /** As printed ("Iowa", "San Diego St"). */
  team: string;
  /** The line for that team as printed (+3.5). */
  line: number;
}

export interface HarrisWeek {
  season: number;
  week: number;
  rows: HarrisRow[];
  picks: HarrisPick[];
  verified: boolean;
  problems: string[];
  source: string;
  at: string;
}

/** Average + Spread must equal the Diff he printed, to rounding. */
export function checkRow(r: SheetRow): string | null {
  if (!Number.isFinite(r.average) || !Number.isFinite(r.spread)) return "missing number";
  if (Math.abs(r.spread) > 70 || Math.abs(r.average) > 80) return "number out of range";
  if (r.diff === undefined || r.diff === null) return null;
  return Math.abs(r.average + r.spread - r.diff) <= 0.06 ? null : `average ${r.average} + spread ${r.spread} is not diff ${r.diff}`;
}

// His abbreviations, expanded before matching ("Ga. Southern", "BGSU").
const WORDS: { [w: string]: string } = {
  s: "south", n: "north", w: "west", e: "east", c: "central", ga: "georgia", wash: "washington", st: "state", so: "southern",
  coll: "college", va: "virginia", app: "appalachian", miss: "mississippi", mich: "michigan", caro: "carolina", la: "louisiana",
  fla: "florida", tenn: "tennessee", ky: "kentucky", jville: "jacksonville", intl: "international",
};
const WHOLE: { [w: string]: string } = {
  bgsu: "bowling green", cmu: "central michigan", wmu: "western michigan", emu: "eastern michigan", niu: "northern illinois",
  pitt: "pittsburgh", usf: "south florida", ecu: "east carolina", fiu: "florida international", fau: "florida atlantic",
  sdsu: "san diego state", sjsu: "san jose state", nmsu: "new mexico state", odu: "old dominion", mtsu: "middle tennessee",
  jmu: "james madison", wku: "western kentucky", uconn: "uconn", ul: "louisiana", umass: "massachusetts", "miami oh": "miami oh", "miami-oh": "miami oh", "ole miss": "ole miss",
  "miss st": "mississippi state", "miss state": "mississippi state", "so miss": "southern miss", "ul monroe": "louisiana monroe", ulm: "louisiana monroe",
  "texas a&m": "texas a and m", "boston coll": "boston college", "j'ville st": "jacksonville state",
};

/** Our folded key for one of his team names. */
export function harrisKey(name: string): string {
  const raw = name.trim().toLowerCase().replace(/\s+/g, " ");
  const whole = WHOLE[raw.replace(/\./g, "")] ?? WHOLE[raw];
  if (whole) return teamKey("cfb", whole);
  const expanded = raw
    .replace(/'/g, "")
    .split(/[\s.]+/)
    .filter(Boolean)
    .map((w) => WHOLE[w] ?? WORDS[w] ?? w)
    .join(" ");
  return teamKey("cfb", expanded);
}

/** Sorensen-Dice on letter pairs: 1 = same, 0 = nothing shared. */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  const pairs = (s: string) => {
    const t = s.replace(/ /g, "");
    const m = new Map<string, number>();
    for (let i = 0; i < t.length - 1; i++) m.set(t.slice(i, i + 2), (m.get(t.slice(i, i + 2)) ?? 0) + 1);
    return m;
  };
  const pa = pairs(a);
  const pb = pairs(b);
  let hit = 0;
  for (const [k, n] of pa) hit += Math.min(n, pb.get(k) ?? 0);
  const total = [...pa.values()].reduce((s, n) => s + n, 0) + [...pb.values()].reduce((s, n) => s + n, 0);
  return total ? (2 * hit) / total : 0;
}

/**
 * His game to one of ours. Both teams must match (0.75+ each); a game
 * listed the other way round (neutral site) matches with home and away
 * swapped. Returns null when nothing clears the bar or two games tie.
 */
export function matchGame(away: string, home: string, games: { away: string; home: string }[]): { away: string; home: string; swapped: boolean } | null {
  const a = harrisKey(away);
  const h = harrisKey(home);
  let best: { away: string; home: string; swapped: boolean; score: number } | null = null;
  let tie = false;
  for (const g of games) {
    for (const swapped of [false, true]) {
      const sa = similarity(a, swapped ? g.home : g.away);
      const sh = similarity(h, swapped ? g.away : g.home);
      if (sa < 0.75 || sh < 0.75) continue;
      const score = sa + sh - (swapped ? 0.01 : 0);
      if (!best || score > best.score + 1e-9) {
        tie = false;
        best = { away: g.away, home: g.home, swapped, score };
      } else if (Math.abs(score - best.score) < 1e-9 && (g.away !== best.away || g.home !== best.home)) tie = true;
    }
  }
  return best && !tie ? { away: best.away, home: best.home, swapped: best.swapped } : null;
}

/** Sheet rows to stored rows, matched to our games for that week. */
export function toHarrisRows(sheet: SheetRow[], games: { away: string; home: string }[]): { rows: HarrisRow[]; problems: string[] } {
  const rows: HarrisRow[] = [];
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const r of sheet) {
    const label = `${r.away} at ${r.home}`;
    const bad = checkRow(r);
    if (bad) {
      problems.push(`${label}: ${bad}`);
      continue;
    }
    const m = matchGame(r.away, r.home, games);
    if (!m) {
      problems.push(`${label}: no matching game this week`);
      continue;
    }
    const k = `${m.away}@${m.home}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const sign = m.swapped ? -1 : 1;
    rows.push({ away: m.away, home: m.home, awayName: r.away, homeName: r.home, model: sign * -r.average, market: sign * r.spread });
  }
  return { rows, problems };
}

/**
 * His contest picks from the post text, by section. The first "Best"
 * heading is Best, a second one is his Strong tier (he tracks them as
 * "Best" and "Strong"); "Not Played" lines and the tracking block are left
 * out.
 */
export function parsePicks(text: string): HarrisPick[] {
  const out: HarrisPick[] = [];
  let tier: PickTier | null = null;
  let bestSeen = false;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const head = line.toLowerCase();
    if (/^(tracking|records?|last week|season)\b/.test(head)) {
      tier = null;
      if (/^(tracking|records?)\b/.test(head)) break;
      continue;
    }
    if (/not played/.test(head) && !/[+-]\d/.test(head)) {
      tier = null;
      continue;
    }
    if (/^best( picks| plays)?$/.test(head)) {
      tier = bestSeen ? "strong" : "best";
      bestSeen = true;
      continue;
    }
    if (/^strong( picks| plays)?$/.test(head)) {
      tier = "strong";
      continue;
    }
    if (/^games? of the week|^gows?$/.test(head)) {
      tier = "gow";
      continue;
    }
    if (/^others?( considered)?$/.test(head)) {
      tier = "other";
      continue;
    }
    if (!tier || /not played/i.test(line)) continue;
    const m = line.match(/^(.+?)\s+([+-]\d+(?:\.\d+)?|PK|pk)(?=\s|\(|$)/);
    if (!m) continue;
    out.push({ tier, team: m[1].trim(), line: /pk/i.test(m[2]) ? 0 : Number(m[2]) });
  }
  return out;
}

/** Is this post his weekly contest picks? */
export const isContestPost = (text: string) => /contest picks/i.test(text) && !/early look/i.test(text) && !text.trim().startsWith("@");
