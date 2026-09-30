import "server-only";
import { redis } from "@/lib/redis/client";

// Dynasty Nerds' weekly "Waiver Wire & FAAB Guide", the lead source for the
// dynasty league's waiver list.
//
// Chosen because it is written for exactly this league's shape (12-team
// superflex PPR dynasty, roster percentages from Sleeper dynasty leagues),
// lives at the same address every week with only the number changing, is
// free, and publishes one plain table with a FAAB range per player. Jingles
// writes for redraft, and his lists are kept out of dynasty entirely.
//
// Read directly and parsed, no model involved. A week they have not posted,
// or a page whose table no longer parses, returns null and the dynasty
// research pass takes over.

const url = (season: string, week: number) =>
  `https://www.dynastynerds.com/waiver-wire/week-${week}-waiver-wire-faab-guide-${season}/`;

const KEY = (season: string, week: number) => `dynastynerds:v1:${season}:w${week}`;
const TTL = 5 * 24 * 60 * 60;

export interface DynastyNerdsRow {
  name: string;
  position: string;
  team: string;
  rostered: number | null;
  /** Their FAAB range as a percent of the season budget, low and high. */
  faabLow: number;
  faabHigh: number;
}

export interface DynastyNerdsGuide {
  season: string;
  week: number;
  url: string;
  fetchedAt: string;
  rows: DynastyNerdsRow[];
}

const decode = (s: string) =>
  s
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&#8217;|&rsquo;/g, "’")
    .replace(/&#039;|&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Their FAAB table: Player | Pos | Team | Roster % | FAAB. "Tyson Bagent /
 * Case Keenum" is one row about a job; both names are kept.
 */
export function parseDynastyNerds(html: string): DynastyNerdsRow[] {
  const rows: DynastyNerdsRow[] = [];
  for (const tr of html.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) ?? []) {
    const cells = (tr.match(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g) ?? []).map(decode);
    if (cells.length !== 5) continue;
    const [player, position, team, rostered, faab] = cells;
    const range = faab.match(/(\d+(?:\.\d+)?)\s*(?:-\s*(\d+(?:\.\d+)?))?\s*%/);
    if (!range || !/^(QB|RB|WR|TE|K|DEF|DST)$/i.test(position)) continue;
    const low = Number(range[1]);
    const high = Number(range[2] ?? range[1]);
    const pct = rostered.match(/(\d+(?:\.\d+)?)\s*%/);
    for (const name of player.split(/\s+\/\s+/)) {
      rows.push({
        name: name.trim(),
        position: position.toUpperCase() === "DST" ? "DEF" : position.toUpperCase(),
        team: team.toUpperCase(),
        rostered: pct ? Number(pct[1]) : null,
        faabLow: low,
        faabHigh: high,
      });
    }
  }
  return rows;
}

/** This week's guide, cached once found. Null when they have not posted it. */
export async function readDynastyNerds(season: string, week: number): Promise<DynastyNerdsGuide | null> {
  try {
    const cached = await redis.get<DynastyNerdsGuide>(KEY(season, week));
    if (cached) return cached;
  } catch {
    // A cache miss is not a reason to skip the source.
  }
  try {
    const res = await fetch(url(season, week), {
      headers: { "User-Agent": "Mozilla/5.0 (fantasy-hub; weekly waiver read)" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const rows = parseDynastyNerds(await res.text());
    if (rows.length < 5) return null;
    const guide: DynastyNerdsGuide = {
      season,
      week,
      url: url(season, week),
      fetchedAt: new Date().toISOString(),
      rows,
    };
    await redis.set(KEY(season, week), guide, { ex: TTL }).catch(() => undefined);
    return guide;
  } catch {
    return null;
  }
}
