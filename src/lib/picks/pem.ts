import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import sharp from "sharp";
import { redis } from "@/lib/redis/client";
import { friendlyAiError } from "@/lib/ai-errors";
import { type CardRow, type PemRow, type PemWeek, statedCount, toRows } from "./pem-card";

// Jay's PEM (@FansOfCFB), the college tab's third model.
//
// X has no free API, so a job on Jack's Mac (scripts/pem-relay.mjs) finds the
// weekly card post through his logged-in browser and sends its image URL
// here. The image itself is public. This reads it.
//
// Reading the card is the one step here that needs a model: it is a picture
// of a table. Haiku reads it first, one column at a time so the numbers stay
// large; any column that fails its arithmetic check is read again by Sonnet.
// Roughly ten cents a week at most (estimate).

const FAST = "claude-haiku-4-5-20251001";
const CAREFUL = "claude-sonnet-5";

const PROMPT = `This image is one column of a college football picks card from the "PEM" model.
Each game box shows: the matchup "Away @ Home" with full team names; "Line: TEAM -X" (the market line, favorite named by abbreviation or name); "PEM: TEAM -Y" (the model's line); "PEM ATS Pick"; and an EDGE number. Some cards instead show a final score and "ATS: TEAM line PEM: TEAM -Y".

Return ONLY a JSON array, one object per game box fully visible in this image, top to bottom:
{"away": "full away name as printed", "home": "full home name as printed", "lineTeam": "team named in the Line", "line": X, "pemTeam": "team named after PEM:", "pem": Y, "edge": EDGE or null, "awayPts": n or null, "homePts": n or null}

Rules:
- Numbers as positive decimals exactly as printed (line 10.5, pem 17.6). If the line is a pick'em, use "lineTeam": "", "line": 0.
- If a box is cut off at the top or bottom edge of the image, leave it out.
- Copy what is printed. Never compute or guess a number.`;

const keyFor = (season: number, week: number) => `picks:v1:cfb:pem:${season}:w${week}`;
const indexKey = (season: number) => `picks:v1:cfb:pem:${season}:weeks`;
const seenKey = (tweetId: string) => `picks:v1:cfb:pem:tweet:${tweetId}`;

async function tiles(imageUrl: string): Promise<Buffer[]> {
  const url = imageUrl.includes("?") ? imageUrl : `${imageUrl}?name=4096x4096`;
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`card image answered ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const { width = 0, height = 0 } = await sharp(buf).metadata();
  if (!width || !height) throw new Error("card image has no size");
  // The cards are laid out in equal columns: two on a results card, four on
  // a picks card. Split on that, with a little overlap so nothing is cut.
  const cols = Math.max(1, Math.round(width / 1000));
  const w = Math.floor(width / cols);
  const pad = Math.floor(w * 0.03);
  return Promise.all(
    Array.from({ length: cols }, (_, i) => {
      const left = Math.max(0, i * w - pad);
      const right = Math.min(width, (i + 1) * w + pad);
      return sharp(buf)
        .extract({ left, top: 0, width: right - left, height })
        .jpeg({ quality: 90 })
        .toBuffer();
    }),
  );
}

async function readTile(client: Anthropic, model: string, tile: Buffer): Promise<CardRow[]> {
  const res = await client.messages.create({
    model,
    max_tokens: 4000,
    system: "You transcribe sports tables exactly as printed and return only JSON.",
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: tile.toString("base64") } },
          { type: "text", text: PROMPT },
        ],
      },
    ],
  });
  const text = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  const json = text.slice(text.indexOf("["), text.lastIndexOf("]") + 1);
  return JSON.parse(json) as CardRow[];
}

export async function readCard(imageUrl: string): Promise<{ rows: PemRow[]; problems: string[] }> {
  const client = new Anthropic({ timeout: 90_000 });
  const parts = await tiles(imageUrl);
  const all: PemRow[] = [];
  const problems: string[] = [];
  for (const [i, tile] of parts.entries()) {
    let read = toRows(await readTile(client, FAST, tile));
    if (read.problems.length) read = toRows(await readTile(client, CAREFUL, tile));
    all.push(...read.rows);
    problems.push(...read.problems.map((p) => `column ${i + 1}: ${p}`));
  }
  // Overlap between columns can repeat a game; keep the first.
  const seen = new Set<string>();
  const rows = all.filter((r) => {
    const k = `${r.away}@${r.home}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return { rows, problems };
}

export interface IngestInput {
  season: number;
  week: number;
  tweetId?: string;
  text?: string;
  imageUrl?: string;
  /** Rows typed in by hand (the backfill), instead of an image. */
  rows?: PemRow[];
}

export async function ingestPem(input: IngestInput): Promise<PemWeek | { skipped: string }> {
  if (input.tweetId && (await redis.get(seenKey(input.tweetId)))) return { skipped: "already read this post" };
  let rows: PemRow[];
  const problems: string[] = [];
  if (input.rows) rows = input.rows;
  else if (input.imageUrl) {
    try {
      const r = await readCard(input.imageUrl);
      rows = r.rows;
      problems.push(...r.problems);
    } catch (e) {
      throw new Error(friendlyAiError(e) ?? (e instanceof Error ? e.message : String(e)));
    }
  } else throw new Error("Send either an image URL or rows.");

  const stated = input.text ? statedCount(input.text) : null;
  if (stated !== null && rows.length !== stated) problems.push(`read ${rows.length} games, the post says ${stated}`);

  const week: PemWeek = {
    season: input.season,
    week: input.week,
    rows,
    verified: problems.length === 0,
    problems,
    source: input.tweetId ? `https://x.com/FansOfCFB/status/${input.tweetId}` : input.imageUrl ?? "typed in",
    at: new Date().toISOString(),
  };
  await redis.set(keyFor(input.season, input.week), week);
  await redis.sadd(indexKey(input.season), input.week);
  if (input.tweetId) await redis.set(seenKey(input.tweetId), 1, { ex: 60 * 60 * 24 * 60 });
  return week;
}

/** Every stored week of PEM for a season. Unverified weeks come back too; the caller decides. */
export async function pemWeeks(season: number): Promise<PemWeek[]> {
  try {
    const weeks = (await redis.smembers(indexKey(season))).map(Number).sort((a, b) => a - b);
    const all = await Promise.all(weeks.map((w) => redis.get<PemWeek>(keyFor(season, w))));
    return all.filter((w): w is PemWeek => !!w);
  } catch {
    return [];
  }
}
