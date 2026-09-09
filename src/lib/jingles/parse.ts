// Reading a Jingles Labs post.
//
// His rankings are a list, and a list can be parsed honestly: block-strip the
// HTML, then one regex per row. Verified against the real 2026-08-31 post,
// which yields 300 of 300 rows with no gaps and no duplicates.
//
// His other posts are prose, and prose is where automated extraction starts
// inventing things. The old hand-curated file said so and it was right: some
// calls give an exact rank against ADP ("ADP WR23 / 51 Overall -> My Rank WR34
// / 73 Overall"), others give a range ("Top 20 WR"), and the inconsistency is
// itself information. So prose posts are classified and linked, and what is
// pulled out of them is labelled an extract rather than asserted as his rank.
//
// Nothing here touches the network, so all of it is testable.

export type PostKind =
  | "rankings"
  /** His weekly list: one section per position plus a FLEX 150. */
  | "weekly_rankings"
  | "targets_fades"
  | "deep_dive"
  | "betting"
  | "other";

export type Scoring = "half_ppr" | "full_ppr" | "standard" | "unknown";

export interface ParsedRankingRow {
  rank: number;
  name: string;
  position: string;
  positionRank: number;
  team: string;
  tier: string | null;
}

export interface ParsedRankings {
  scoring: Scoring;
  rows: ParsedRankingRow[];
  tiers: string[];
  /** Ranks between 1 and the highest seen that no row claimed. */
  missingRanks: number[];
  /** Ranks claimed more than once. */
  duplicateRanks: number[];
}

/**
 * Strip HTML to text, keeping line structure.
 *
 * Block elements end a line and inline elements disappear. Doing it the naive
 * way (every tag becomes a newline) breaks each ranking row into three pieces,
 * because he bolds the position: "1: Jahmyr Gibbs |", "RB1", "| DET".
 */
export function htmlToLines(html: string): string[] {
  const withBreaks = html
    .replace(/<\s*(script|style)[^>]*>[\s\S]*?<\/\s*\1\s*>/gi, "")
    // A newline in the source is whitespace, not a line break: HTML says so,
    // and a row wrapped across two source lines would otherwise be split in
    // half and silently dropped. Flatten first, then let the tags decide where
    // lines actually end.
    .replace(/\r\n|\r|\n/g, " ")
    .replace(/<\s*(br|hr)\s*\/?>/gi, "\n")
    .replace(/<\/\s*(p|div|li|h[1-6]|tr|blockquote|section)\s*>/gi, "\n");

  const text = decodeEntities(withBreaks.replace(/<[^>]+>/g, ""));

  return text
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  rsquo: "’",
  lsquo: "‘",
  ldquo: "“",
  rdquo: "”",
};

export function decodeEntities(input: string): string {
  return input
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[String(name).toLowerCase()] ?? m);
}

/** "1: Jahmyr Gibbs | RB1 | DET" */
const ROW = /^(\d{1,3})\s*[:.]\s*(.+?)\s*\|\s*([A-Z]{1,4})(\d{1,3})\s*\|\s*([A-Z]{2,4})$/;

/**
 * "Tier 3: 2nd Round" on the web, and bare "Tier 1" in the email.
 *
 * Substack's email build of the same post drops the label: the web version
 * writes `<h4>Tier 1: Top 4</h4>` and the emailed one writes
 * `<p><strong>Tier 1</strong></p>`. Requiring the colon meant every row read
 * from an email came back with no tier at all, which is not a parse failure
 * anything would have noticed: 300 rows, all correct, and the tier chips empty.
 *
 * The label is optional now, and a heading with none is called by its number.
 * Anchored at both ends so a sentence beginning "Tier 1 is where I would..."
 * is prose, not a heading.
 */
const TIER = /^Tier\s+(\d+)\s*(?:[:.]\s*(.+))?$/i;

/**
 * Which scoring a rankings post is for.
 *
 * Read from the title first because he puts it there ("The Lab 300: Half-PPR
 * Rankings"), then from the body, which usually restates it ("These are my
 * current preseason Half PPR rankings"). Unknown is a real answer: a list
 * applied to the wrong league is worse than no list.
 */
export function detectScoring(title: string, body = ""): Scoring {
  const haystack = `${title}\n${body.slice(0, 2000)}`.toLowerCase();
  if (/\bfull[\s-]?ppr\b/.test(haystack)) return "full_ppr";
  if (/\bhalf[\s-]?ppr\b/.test(haystack)) return "half_ppr";
  if (/\b(standard|non[\s-]?ppr|0\.?0\s?ppr)\b/.test(haystack)) return "standard";
  if (/\bppr\b/.test(haystack)) return "full_ppr";
  return "unknown";
}

export function classifyPost(title: string, body = ""): PostKind {
  const t = title.toLowerCase();
  // Checked BEFORE the generic rankings branch, which would otherwise swallow
  // it: "2026 Week 1 Fantasy Football Rankings" contains "rankings". They are
  // different documents with different row shapes and different lifetimes, and
  // they must never share a store. See weekly.ts.
  if (/\bweek\s+\d+\b/.test(t) && /\brankings?\b/.test(t)) return "weekly_rankings";
  if (/\blab\s*\d{2,3}\b|\brankings?\b|\btiers?\b/.test(t)) return "rankings";
  if (/\bbet|odds|picks?\b|\bpreview\b|\bpredictions?\b|spread|parlay|units?\b/.test(t)) {
    return "betting";
  }
  if (/taking everywhere|avoiding|fades?|targets?|high on|low on|under the microscope/.test(t)) {
    return "targets_fades";
  }
  if (/lab notes|league winner|deep dive|lab certified/.test(t)) return "deep_dive";

  // Title was not enough. A body that is mostly ranking rows is a rankings post
  // whatever he called it.
  const lines = htmlToLines(body);
  const rows = lines.filter((l) => ROW.test(l)).length;
  if (rows >= 25) return "rankings";

  return "other";
}

/**
 * Parse a rankings post.
 *
 * Reports gaps and duplicates rather than quietly returning a short list. A
 * ranking list that lost forty players is not a smaller ranking list, it is a
 * broken one, and the caller has to be able to tell the difference.
 */
export function parseRankings(html: string, title = ""): ParsedRankings {
  const lines = htmlToLines(html);
  const rows: ParsedRankingRow[] = [];
  const tiers: string[] = [];
  let currentTier: string | null = null;

  for (const line of lines) {
    const tierMatch = line.match(TIER);
    if (tierMatch) {
      currentTier = tierMatch[2]?.trim() || `Tier ${tierMatch[1]}`;
      if (!tiers.includes(currentTier)) tiers.push(currentTier);
      continue;
    }

    const rowMatch = line.match(ROW);
    if (!rowMatch) continue;

    rows.push({
      rank: Number(rowMatch[1]),
      name: rowMatch[2].replace(/\s+/g, " ").trim(),
      position: rowMatch[3].toUpperCase(),
      positionRank: Number(rowMatch[4]),
      team: rowMatch[5].toUpperCase(),
      tier: currentTier,
    });
  }

  const seen = new Map<number, number>();
  for (const row of rows) seen.set(row.rank, (seen.get(row.rank) ?? 0) + 1);

  const highest = rows.reduce((max, r) => Math.max(max, r.rank), 0);
  const missingRanks: number[] = [];
  for (let i = 1; i <= highest; i++) if (!seen.has(i)) missingRanks.push(i);

  const duplicateRanks = [...seen.entries()]
    .filter(([, count]) => count > 1)
    .map(([rank]) => rank)
    .sort((a, b) => a - b);

  return {
    scoring: detectScoring(title, lines.slice(0, 40).join("\n")),
    rows,
    tiers,
    missingRanks,
    duplicateRanks,
  };
}

// --- Prose posts ---

export interface ParsedMention {
  name: string;
  /** The sentence he said it in, for attribution. */
  context: string;
  /** His stated ADP, verbatim, when the line carries one. */
  adp?: string;
  /** His own rank, verbatim, when the line carries one. */
  jinglesRank?: string;
}

/** "ADP WR23 / 51 Overall -> My Rank WR34 / 73 Overall" and its variants. */
const ADP_LINE =
  /ADP[:\s]+([A-Z]{1,4}\d{1,3}(?:\s*\/\s*\d{1,3}\s*Overall)?)[^A-Za-z0-9]{0,12}(?:My\s+Rank|Rank)[:\s]+([A-Za-z0-9\s/]{2,40}?)(?:$|[.\n|])/i;

/**
 * Pull the players a prose post names, with any rank line attached.
 *
 * Deliberately shallow. It finds who he is talking about and quotes him; it
 * does not try to decide whether he likes them, because the post title already
 * says that and a sentence-level sentiment guess would be the kind of confident
 * wrongness this file exists to avoid.
 */
export function parseMentions(html: string, knownNames: Set<string>): ParsedMention[] {
  const lines = htmlToLines(html);
  const out = new Map<string, ParsedMention>();

  for (const line of lines) {
    if (line.length < 3 || line.length > 600) continue;

    for (const name of knownNames) {
      if (!line.includes(name)) continue;

      const existing = out.get(name);
      const adpMatch = line.match(ADP_LINE);

      // Prefer the line that carries a rank; otherwise keep the first mention.
      if (existing && !adpMatch) continue;

      out.set(name, {
        name,
        context: line,
        ...(adpMatch
          ? { adp: adpMatch[1].trim(), jinglesRank: adpMatch[2].trim() }
          : {}),
      });
    }
  }

  return [...out.values()];
}

// --- Betting posts ---

export interface ParsedPlay {
  /** The bet as he wrote it, minus the unit sizing. */
  bet: string;
  /** Units risked. Null for a stated lean with no size. */
  units: number | null;
  /** True when he called it a lean rather than a sized play. */
  lean: boolean;
}

/** "Malachi Hosley Over 40.5 Rushing Yards | 1 Unit" / "... | 0.5 Units" / "... | LEAN" */
const PLAY = /^(.{4,160}?)\s*\|\s*(?:(\d+(?:\.\d+)?)\s*units?|(lean))\s*$/i;

/**
 * Pull the sized plays out of a betting post.
 *
 * Only lines that carry an explicit stake count. He writes plenty of analysis
 * that mentions a number, and a bot that texted every number it found would be
 * worse than useless on a Saturday morning.
 */
export function parsePlays(html: string): ParsedPlay[] {
  const lines = htmlToLines(html);
  const plays: ParsedPlay[] = [];
  const seen = new Set<string>();

  for (const line of lines) {
    const m = line.match(PLAY);
    if (!m) continue;

    const bet = m[1].replace(/\s+/g, " ").trim();
    if (!bet || seen.has(bet.toLowerCase())) continue;
    seen.add(bet.toLowerCase());

    plays.push({
      bet,
      units: m[2] ? Number(m[2]) : null,
      lean: Boolean(m[3]),
    });
  }

  return plays;
}
