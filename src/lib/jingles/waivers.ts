import { htmlToLines } from "./parse";

// Reading his waiver wire post, which is the one document he publishes with
// actual bids in it.
//
// The weekly rankings tell you who is better. This tells you what to pay, and
// nothing else the app reads carries that number: the web research run comes
// back with a name and a tier and, most weeks, a blank where the bid should be.
// He posts it Tuesday, waivers run Wednesday, so a week of it missed is a week
// of bidding blind.
//
// The post has two halves and the parser leans on the second one. The top half
// is a section per position where a handful of players get a bold header line
// and a paragraph of his reasoning. The bottom half is one flat ranked list of
// every player he named, with the position, the bid and the rostered percent on
// each row. The ranked list is the complete, unambiguous version of the same
// information, so it is the spine here, and the prose from the top half is
// folded onto whichever rows have it.

/** A section header: the position its rows belong to. */
const SECTION_POSITION: [RegExp, string][] = [
  [/^quarterbacks?$|^other qb adds$/i, "QB"],
  [/^running backs?$|^other rb adds$/i, "RB"],
  [/^wide receivers?$|^other wr adds$/i, "WR"],
  [/^tight ends?$|^other te adds$/i, "TE"],
  [/^kickers?$|^other k adds$/i, "K"],
  [/^defenses?$|^d\/?st$|^other (def|dst|d\/st) adds$/i, "DEF"],
];

/** "30 Waiver Adds Ranked", and whatever number he lands on in another week. */
const RANKED_HEADER = /^\d{1,3}\s+waiver\s+adds\s+ranked$/i;

/** "1: RB Jonah Coleman | $25 | 29%" */
const RANKED_ROW = /^(\d{1,3}):\s*(QB|RB|WR|TE|K|DEF|D\/ST)\s+(.+?)\s*\|\s*\$(\d+)\s*\|\s*(\d+)\s*%/i;

/** "Tyler Shough | $5 | 47% Rostered", and the shorter "Malik Willis | $3 | 35%". */
const NAMED_ROW = /^(.+?)\s*\|\s*\$(\d+)\s*\|\s*(\d+)\s*%(\s*rostered)?\s*$/i;

/** "based on the standard $100 salary cap". A $1000 league is priced differently. */
const BUDGET = /\$(\d{2,5})\s*(?:salary cap|budget|faab|fab\b)/i;

const TITLE_WEEK = /\bweek\s+(\d{1,2})\b/i;
const TITLE_SEASON = /\b(20\d{2})\b/;

export interface ParsedWaiverRow {
  /** His own rank in the ranked list, or null for a player only named above it. */
  rank: number | null;
  name: string;
  position: string;
  /** The dollars he wrote, against the budget the post is priced for. */
  faab: number;
  /** The same bid as a percent of that budget, which is what the app prices in. */
  faabPercent: number;
  /** Consensus rostered percent across ESPN, Yahoo and Sleeper, where he gave one. */
  rostered: number | null;
  /** His reasoning, quoted. Only the players he wrote a paragraph about have one. */
  note: string | null;
}

export interface ParsedWaivers {
  season: string | null;
  week: number | null;
  /** The budget his dollars are priced against. $100 unless the post says otherwise. */
  budget: number;
  rows: ParsedWaiverRow[];
  /** How many of the rows came from the ranked list rather than the prose above it. */
  rankedRows: number;
}

/**
 * True for his waiver post and false for everything else he publishes.
 *
 * Deliberately narrow. "Waiver" in the title is the whole test, because the
 * weekly rankings post is also titled with a week number and the two must never
 * land in the same store.
 */
export function isWaiverPostTitle(title: string): boolean {
  return /\bwaiver/i.test(title) && !/\brankings?\b/i.test(title.replace(/waiver adds ranked/i, ""));
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z ]/g, "")
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();

/** A line that is prose rather than a row or a header. */
function isProse(line: string): boolean {
  return line.length > 80 && !NAMED_ROW.test(line);
}

/**
 * Parse a waiver post.
 *
 * Returns whatever it could read rather than throwing: a week where he changes
 * the shape of the top half should still yield the ranked list, and the caller
 * decides whether what came back is enough to store.
 */
export function parseWaivers(html: string, title = ""): ParsedWaivers {
  const lines = htmlToLines(html);

  const budgetLine = lines.find((l) => BUDGET.test(l));
  const budget = budgetLine ? Number(budgetLine.match(BUDGET)![1]) : 100;

  const ranked: ParsedWaiverRow[] = [];
  const named = new Map<string, ParsedWaiverRow>();
  const notes = new Map<string, string>();

  let position: string | null = null;
  let inRanked = false;
  /** The player the paragraphs under this header belong to. */
  let awaitingNote: string | null = null;

  for (const line of lines) {
    if (RANKED_HEADER.test(line)) {
      inRanked = true;
      awaitingNote = null;
      continue;
    }

    const section = SECTION_POSITION.find(([re]) => re.test(line));
    if (section) {
      position = section[1];
      inRanked = false;
      awaitingNote = null;
      continue;
    }

    const rankedMatch = line.match(RANKED_ROW);
    if (rankedMatch) {
      const [, rank, pos, name, faab, rostered] = rankedMatch;
      ranked.push({
        rank: Number(rank),
        name: name.trim(),
        position: pos.toUpperCase() === "D/ST" ? "DEF" : pos.toUpperCase(),
        faab: Number(faab),
        faabPercent: (Number(faab) / budget) * 100,
        rostered: Number(rostered),
        note: null,
      });
      continue;
    }

    // Only inside a position section. The ranked list is already handled above,
    // and a stray "$5 | 47%" in the intro belongs to nobody.
    const sectionPosition = position;
    const namedMatch = !inRanked && sectionPosition ? line.match(NAMED_ROW) : null;
    if (namedMatch && sectionPosition) {
      const [, name, faab, rostered, rosteredWord] = namedMatch;
      const clean = name.trim();
      // A row is a name, not a sentence. This is what keeps "Kyler Murray is
      // 57% rostered, but he would be my #1 QB add" out of the player list.
      if (clean.length <= 40 && !/\s(is|are|would|and)\s/i.test(clean)) {
        named.set(norm(clean), {
          rank: null,
          name: clean,
          position: sectionPosition,
          faab: Number(faab),
          faabPercent: (Number(faab) / budget) * 100,
          rostered: Number(rostered),
          note: null,
        });
        // Only the players he writes a paragraph about get their header row
        // spelled out with "Rostered", and only those rows are followed by his
        // reasoning. The compact rows under "Other RB Adds" are a list, and the
        // paragraph after the last of them is usually about somebody else
        // entirely: an expensive player who is rostered everywhere and worth a
        // bid only if he is somehow free. Taking a note there hands one
        // player's case to another, which is worse than having no note.
        awaitingNote = rosteredWord ? norm(clean) : null;
      }
      continue;
    }

    // The paragraph under a header row is his case for that player. Only the
    // first one: the second paragraph is usually the matchup ahead, and a note
    // that runs three paragraphs reads as an essay on a waiver page.
    if (awaitingNote && isProse(line)) {
      if (!notes.has(awaitingNote)) notes.set(awaitingNote, line.trim());
      awaitingNote = null;
    }
  }

  const rows: ParsedWaiverRow[] = ranked.map((row) => ({
    ...row,
    note: notes.get(norm(row.name)) ?? null,
  }));

  // Anyone he priced above but left out of the ranked list. Rare, and cheaper
  // to carry than to explain the week a player goes missing.
  const inRankedList = new Set(rows.map((r) => norm(r.name)));
  for (const [key, row] of named) {
    if (inRankedList.has(key)) continue;
    rows.push({ ...row, note: notes.get(key) ?? null });
  }

  rows.sort((a, b) => {
    if (a.rank !== null && b.rank !== null) return a.rank - b.rank;
    if (a.rank !== null) return -1;
    if (b.rank !== null) return 1;
    return b.faab - a.faab;
  });

  const week = title.match(TITLE_WEEK);
  const season = title.match(TITLE_SEASON);

  return {
    season: season ? season[1] : null,
    week: week ? Number(week[1]) : null,
    budget,
    rows,
    rankedRows: ranked.length,
  };
}
