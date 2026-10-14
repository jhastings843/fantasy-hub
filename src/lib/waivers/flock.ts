// Reading Flock Fantasy's weekly waiver email, the backup for a week Jingles
// does not post.
//
// Flock sends "Week N Waiver Wire Targets" from beehiiv every Tuesday evening
// (5:30pm ET on 2026-10-13), and the web copy the email links to answers 404,
// so the email in Jack's inbox is the only copy. It is also a different kind of
// document from his: names, a verdict and a paragraph, but NO bids. So Flock
// decides who is worth a claim and the app's own pricing decides what to pay.
//
// The layout has held for Weeks 2 to 6:
//
//   HIGH ROSTER PERCENTAGE ADDS   some weeks: "Name POS · TEAM" + paragraph
//   ADD #1 .. ADD #n              headline, " | Name", "POS TEAM", " | VERDICT"
//   DEEPER LEAGUES                "Name POS · TEAM", a stat line, a paragraph
//   DON'T CHASE                   same shape: players he says not to claim
//   QUARTERBACK STREAMERS         same shape, some weeks
//   DEFENSES TO STREAM            "My pick: Chiefs vs Chargers", "Also in play"
//
// Nothing here touches the network, so all of it is testable.

import { NFL_TEAMS } from "@/lib/survivor/teams";

export type FlockSection = "high-roster" | "add" | "deeper" | "dont-chase" | "qb-stream" | "dst";

export interface FlockRow {
  section: FlockSection;
  /** ADD #n, or the order within the section. */
  rank: number;
  name: string;
  position: string;
  team: string | null;
  /** His label on a top add: MUST ADD, FLEX PLAY, SPOT START, STASH, ... */
  verdict: string | null;
  note: string;
}

export interface ParsedFlock {
  week: number | null;
  rows: FlockRow[];
}

/** "Week 6 Waiver Wire Targets". */
export function flockWeek(subject: string): number | null {
  const m = subject.match(/week (\d+) waiver/i);
  return m ? Number(m[1]) : null;
}

/** Block-strip the email to one line per paragraph or cell. */
export function flockText(html: string): string[] {
  let s = html.replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, "");
  s = s.replace(/<br\s*\/?>|<\/(p|div|tr|h[1-6]|li|table)>/gi, "\n");
  s = s.replace(/<\/t[dh]>/gi, " | ");
  s = s.replace(/<[^>]+>/g, "");
  s = s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&rsquo;|&#8217;/g, "’")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
  return s
    .split("\n")
    .map((l) => l.replace(/[\s ‌͏]+/g, " ").replace(/^[\s|]+|[\s|]+$/g, "").trim())
    .filter(Boolean);
}

const HEADERS: [RegExp, FlockSection | "stop"][] = [
  [/^HIGH ROSTER PERCENTAGE ADDS?$/, "high-roster"],
  [/^Top Waiver Adds$/i, "add"],
  [/^THE SEASON PASS$/, "stop"],
  [/^DEEPER LEAGUES$/, "deeper"],
  [/^DON[’']T CHASE$/, "dont-chase"],
  [/^QUARTERBACK STREAMERS$/, "qb-stream"],
  [/^DEFENSES TO STREAM$/, "dst"],
  [/^NEW: /, "stop"],
];

/** "Germie Bernard WR · PIT" */
const PLAYER_LINE = /^(.+?) (QB|RB|WR|TE|K) · ([A-Z]{2,3})$/;
/** "RB HOU" under a top add's name. */
const POS_TEAM = /^(QB|RB|WR|TE|K) ([A-Z]{2,3})$/;

function teamFromNickname(word: string): string | null {
  const w = word.trim().toLowerCase();
  return NFL_TEAMS.find((t) => t.name.toLowerCase() === w)?.abbr ?? null;
}

export function parseFlock(html: string, subject = ""): ParsedFlock {
  const lines = flockText(html);
  const rows: FlockRow[] = [];
  let section: FlockSection | null = null;
  const count: Partial<Record<FlockSection, number>> = {};
  const push = (r: Omit<FlockRow, "rank">) => {
    count[r.section] = (count[r.section] ?? 0) + 1;
    rows.push({ ...r, rank: count[r.section]! });
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const header = HEADERS.find(([re]) => re.test(line));
    if (header) {
      section = header[1] === "stop" ? null : header[1];
      continue;
    }
    if (/^ADD #\d+$/.test(line)) {
      section = "add";
      // headline, name, "POS TEAM", verdict; then stats, then his paragraphs.
      const headline = lines[i + 1] ?? "";
      const name = lines[i + 2] ?? "";
      const pt = (lines[i + 3] ?? "").match(POS_TEAM);
      if (!pt) continue;
      const verdict = lines[i + 4] && /^[A-Z][A-Z ]+$/.test(lines[i + 4]) ? lines[i + 4] : null;
      // The first real paragraph after the stat block.
      let note = "";
      for (let j = i + 5; j < lines.length && !/^ADD #\d+$/.test(lines[j]) && !HEADERS.some(([re]) => re.test(lines[j])); j++) {
        if (lines[j].length > 80) {
          note = lines[j];
          break;
        }
      }
      push({ section: "add", name, position: pt[1], team: pt[2], verdict, note: note || headline });
      i += 4;
      continue;
    }
    if (!section || section === "add") continue;

    if (section === "dst") {
      const pick = line.match(/^My pick: (\S+(?: \S+)?) (?:vs|at) /);
      if (pick) {
        const team = teamFromNickname(pick[1]);
        const note = lines[i + 1] ?? "";
        if (team) push({ section, name: pick[1], position: "DEF", team, verdict: "MY PICK", note });
        continue;
      }
      if (/^Also in play$/i.test(line)) {
        for (const game of (lines[i + 1] ?? "").split(" · ")) {
          const nick = game.match(/^(\S+(?: \S+)?) (?:vs|at) /)?.[1];
          const team = nick ? teamFromNickname(nick) : null;
          if (team) push({ section, name: nick!, position: "DEF", team, verdict: "ALSO IN PLAY", note: "" });
        }
        i += 1;
      }
      continue;
    }

    const m = line.match(PLAYER_LINE);
    if (!m) continue;
    // Deeper, don't chase and streamers carry a stat line before the paragraph;
    // the high-roster block goes straight to it.
    const next = lines.slice(i + 1, i + 3).find((l) => l.length > 80) ?? "";
    push({ section, name: m[1], position: m[2], team: m[3], verdict: null, note: next });
  }

  return { week: flockWeek(subject), rows };
}

/**
 * How far his verdict lifts a claim's tier.
 *
 * Deliberately low. A research tier can only RAISE what the app's lineup math
 * finds (price.ts strongerTier), so a modest floor never overpays, and Flock
 * prices nothing itself: "MUST ADD" on Woody Marks came with "keep the
 * expectations to 2 weeks". Null means no lift: the player is on the board and
 * the app's own math alone sizes him.
 */
export function flockTier(row: FlockRow): "multiweek" | "streamer" | "filler" | "stash" | null {
  if (row.section === "high-roster") return "multiweek";
  if (row.section === "qb-stream" || row.section === "dst") return "streamer";
  if (row.section === "deeper") return "stash";
  if (row.section !== "add") return null;
  const v = (row.verdict ?? "").toUpperCase();
  if (v === "MUST ADD") return "multiweek";
  if (v === "STASH" || v === "PREMIUM HANDCUFF") return "stash";
  return "filler";
}

/** The line the email and the page show for him. */
export function flockNote(row: FlockRow): string {
  const label =
    row.section === "add"
      ? `Add #${row.rank}${row.verdict ? `, ${row.verdict.toLowerCase()}` : ""}`
      : row.section === "high-roster"
        ? "likely rostered, claim if free"
        : row.section === "deeper"
          ? "deeper leagues"
          : row.section === "qb-stream"
            ? "QB stream"
            : row.section === "dst"
              ? row.verdict === "MY PICK" ? "his defense stream" : "defense also in play"
              : "don't chase";
  const first = row.note.split(/(?<=\.)\s/)[0] ?? "";
  return `Flock Fantasy (${label})${first ? `: ${first}` : "."}`;
}
