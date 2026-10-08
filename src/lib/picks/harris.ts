import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { redis } from "@/lib/redis/client";
import { friendlyAiError } from "@/lib/ai-errors";
import { getPicksCore } from "./report";
import { weekOf } from "./parse";
import { type HarrisWeek, type SheetRow, parsePicks, toHarrisRows } from "./harris-sheet";
import { type HarrisReport, harrisReport, harrisSummary } from "./harris-track";
import { redisStore } from "./learning/store";

// John Harris (@jhnhrris): tracked, never used for a bet (Jack, 2026-10-08).
//
// scripts/pem-relay.mjs on Jack's Mac finds his weekly "CONTEST PICKS" post
// on X (no free API) and sends the text and image URLs here. The picks come
// from the text; the full sheet is a picture, so reading it is the one step
// that needs a model. Haiku reads each image; any row that fails its own
// arithmetic (Average + Spread = Diff) sends that image to Sonnet. Rows that
// still fail are left out and listed. A few cents a week (estimate).

const FAST = "claude-haiku-4-5-20251001";
const CAREFUL = "claude-sonnet-5";

const PROMPT = `This image is part of a college football spreadsheet. Games come in blocks: a green header row (Game 1 | Team Score | Average | Open | ... | Spread | Spread | Diff | ... | Adj Diff | Notes ...), then the AWAY team's row, then the HOME team's row.

For every block whose two team rows are fully visible, read from the HOME (second) row:
- "average": the Average column (column C), e.g. 4.245 or -11.701
- "spread": the betting line under the "Spread" heading that looks like a point spread (e.g. -3.5, 10.5, 0). NOT the 0.3-0.7 decimal in the next "Spread" column, and NOT the Open column.
- "diff": the Diff column (just after the decimal Spread column; NOT Adj Diff), e.g. 1.24 or -4.64

Return ONLY a JSON array, top to bottom: {"away": "away team as printed", "home": "home team as printed", "average": n, "spread": n, "diff": n}
Copy numbers exactly as printed with their signs. Skip any block cut off at the image edge, or showing #REF!, #NUM! or a blank team name. Never compute or guess a number.`;

const keyFor = (season: number, week: number) => `picks:v1:cfb:harris:${season}:w${week}`;
const indexKey = (season: number) => `picks:v1:cfb:harris:${season}:weeks`;
const seenKey = (tweetId: string) => `picks:v1:cfb:harris:tweet:${tweetId}`;
const PROPOSED = "picks:v2:harris:proposed";

async function readImage(client: Anthropic, model: string, imageUrl: string): Promise<SheetRow[]> {
  const url = imageUrl.includes("?") ? imageUrl : `${imageUrl}?name=large`;
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`sheet image answered ${res.status}`);
  const data = Buffer.from(await res.arrayBuffer()).toString("base64");
  const media = (res.headers.get("content-type") ?? "image/jpeg").includes("png") ? "image/png" : "image/jpeg";
  const out = await client.messages.create({
    model,
    max_tokens: 6000,
    system: "You transcribe spreadsheet screenshots exactly as printed and return only JSON.",
    messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: media, data } }, { type: "text", text: PROMPT }] }],
  });
  const text = out.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  return JSON.parse(text.slice(text.indexOf("["), text.lastIndexOf("]") + 1)) as SheetRow[];
}

/** The games a sheet for `week` can match: that week's finished games and, for the current week, the board. */
async function gamesFor(week: number): Promise<{ away: string; home: string }[]> {
  const core = (await getPicksCore("cfb")).value;
  if (!core) return [];
  const out = new Map<string, { away: string; home: string }>();
  for (const [k] of core.finals) {
    const [w, rest] = [Number(k.split(":")[0]), k.slice(k.indexOf(":") + 1)];
    if (w !== week) continue;
    const [away, home] = rest.split("@");
    out.set(rest, { away, home });
  }
  if (core.week === week) for (const r of core.rows) out.set(`${r.away}@${r.home}`, { away: r.away, home: r.home });
  return [...out.values()];
}

export interface HarrisIngest {
  season: number;
  /** Defaults to the college week of the post date. */
  week?: number;
  tweetId?: string;
  text?: string;
  postedAt?: string;
  imageUrls?: string[];
  /** Rows typed in by hand (the backfill), instead of images. */
  sheet?: SheetRow[];
}

export async function ingestHarris(input: HarrisIngest): Promise<HarrisWeek | { skipped: string }> {
  if (input.tweetId && (await redis.get(seenKey(input.tweetId)))) return { skipped: "already read this post" };
  const day = (input.postedAt ? new Date(input.postedAt) : new Date()).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const week = input.week ?? weekOf("cfb", day);
  const games = await gamesFor(week);
  if (!games.length) throw new Error(`No college games on file for week ${week} to match the sheet against.`);

  let sheet: SheetRow[] = [];
  const problems: string[] = [];
  if (input.sheet) sheet = input.sheet;
  else if (input.imageUrls?.length) {
    const client = new Anthropic({ timeout: 120_000 });
    try {
      const reads = await Promise.all(
        input.imageUrls.map(async (u) => {
          const first = await readImage(client, FAST, u);
          const bad = toHarrisRows(first, games).problems.some((p) => /not diff|missing|range/.test(p));
          return bad ? readImage(client, CAREFUL, u) : first;
        }),
      );
      sheet = reads.flat();
    } catch (e) {
      throw new Error(friendlyAiError(e) ?? (e instanceof Error ? e.message : String(e)));
    }
  }
  const { rows, problems: rowProblems } = toHarrisRows(sheet, games);
  problems.push(...rowProblems);
  const picks = input.text ? parsePicks(input.text) : [];
  const out: HarrisWeek = {
    season: input.season,
    week,
    rows,
    picks,
    // Every kept row passed its own arithmetic; a week with none is not usable.
    verified: rows.length > 0,
    problems,
    source: input.tweetId ? `https://x.com/jhnhrris/status/${input.tweetId}` : "typed in",
    at: new Date().toISOString(),
  };
  await redis.set(keyFor(input.season, week), out);
  await redis.sadd(indexKey(input.season), week);
  if (input.tweetId && out.verified) await redis.set(seenKey(input.tweetId), 1, { ex: 60 * 60 * 24 * 60 });
  return out;
}

export async function harrisWeeks(season: number): Promise<HarrisWeek[]> {
  try {
    const weeks = (await redis.smembers(indexKey(season))).map(Number).sort((a, b) => a - b);
    const all = await Promise.all(weeks.map((w) => redis.get<HarrisWeek>(keyFor(season, w))));
    return all.filter((w): w is HarrisWeek => !!w);
  } catch {
    return [];
  }
}

/** The tracker as of now, from the stored sheets and the college core's finals and graded games. */
export async function harrisNow(): Promise<HarrisReport | null> {
  const core = (await getPicksCore("cfb")).value;
  if (!core) return null;
  return harrisReport(await harrisWeeks(core.season), new Map(core.finals), core.graded);
}

/**
 * Run with each strategy review: if either question clears the bar, file a
 * proposal once (a person decides; nothing changes a bet). Returns the summary.
 */
export async function harrisReview(now = new Date()): Promise<string> {
  const r = await harrisNow();
  if (!r) return "Harris tracker: college core unavailable.";
  const summary = harrisSummary(r);
  const which = r.clears.agreement ? "agreement" : r.clears.edge ? "edge" : null;
  if (which && (await redis.set(PROPOSED, now.toISOString(), { nx: true })) === "OK") {
    await redisStore.append({
      at: now.toISOString(),
      kind: "proposal",
      title: which === "agreement" ? "Proposal: use Harris agreement as a college filter" : "Proposal: Harris's 3+ point edges as a college signal",
      why: `${summary} A person decides whether to add it to the rule; nothing changes on its own.`,
      evidence: r,
    });
  }
  return summary;
}
