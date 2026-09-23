import { NextResponse } from "next/server";
import { z } from "zod";
import { buildReport, currentWeek, SEASON } from "@/lib/survivor/report";
import { getSeasonGames } from "@/lib/survivor/odds";
import { getPool, savePool } from "@/lib/survivor/state";
import { isPoolId, DEFAULT_POOL_ID } from "@/lib/survivor/pools";
import { parseEntries, deriveFromEntries } from "@/lib/survivor/entries";
import { readBoardImage } from "@/lib/survivor/board-image";
import type { PoolConfig } from "@/lib/survivor/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/survivor/entries?pool=<id> - who picked what, entry by entry.
//
// Two ways in, one destination. `text` is a paste of the board; `image` is a
// screenshot of it, which is the only export the 30-entry pool has, since its
// picks are logos in a grid. The screenshot is transcribed and then goes
// through the same parser as a paste, so there is one definition of a row.
//
// Nothing is stored until it parses. A half-read board is worse than no board:
// it would read as entries that have burned nothing.

const bodySchema = z.object({
  text: z.string().min(1).max(20_000).optional(),
  image: z.string().min(100).max(8_000_000).optional(),
  /** Which week the first column is. Boards that scroll do not start at 1. */
  startWeek: z.number().int().min(1).max(18).optional(),
  /** Read it back without saving, which is what the upload box does first. */
  preview: z.boolean().optional(),
});

const MEDIA: Record<string, "image/png" | "image/jpeg" | "image/webp"> = {
  png: "image/png",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  webp: "image/webp",
};

export async function POST(req: Request) {
  const raw = new URL(req.url).searchParams.get("pool");
  const poolId = raw == null || raw === "" ? DEFAULT_POOL_ID : raw;
  if (!isPoolId(poolId)) {
    return NextResponse.json({ error: `unknown pool "${poolId}"` }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body", detail: parsed.error.issues }, { status: 400 });
  }
  const { text, image, startWeek = 1, preview = false } = parsed.data;
  if (!text && !image) {
    return NextResponse.json({ error: "Send either text or image." }, { status: 400 });
  }

  let board = text ?? "";
  let unreadable = 0;

  if (!text && image) {
    // data:image/png;base64,AAAA... or bare base64.
    const match = image.match(/^data:image\/(png|jpe?g|webp);base64,(.+)$/i);
    const media = MEDIA[(match?.[1] ?? "png").toLowerCase()] ?? "image/png";
    const data = match ? match[2] : image;
    const read = await readBoardImage(data, media);
    if (!read.ok) return NextResponse.json({ error: read.error }, { status: 502 });
    board = read.text ?? "";
    unreadable = read.unreadable ?? 0;
  }

  const rows = parseEntries(board, startWeek);
  if (!rows.ok) {
    return NextResponse.json({ error: rows.error, read: board.slice(0, 500) }, { status: 422 });
  }

  const week = currentWeek((await getSeasonGames(SEASON)).games);
  const derived = deriveFromEntries(rows.entries, Math.max(0, week - 1), week);

  if (preview) {
    return NextResponse.json({
      preview: true,
      entries: rows.entries,
      weeks: rows.weeks,
      derived,
      unreadable,
      ok: true,
    });
  }

  const patch: Partial<PoolConfig> = {
    entries: rows.entries,
    entriesWeek: week,
    // The board is also the truest count of who is left, so it sets that too
    // rather than leaving two numbers to disagree.
    entriesAlive: derived.alive,
    entriesAliveWeek: week,
  };
  await savePool(SEASON, poolId, patch);

  return NextResponse.json({
    ok: true,
    stored: rows.entries.length,
    alive: derived.alive,
    unreadable,
    report: await buildReport(poolId),
  });
}

/** The rows currently stored, for the upload box to show what it is replacing. */
export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get("pool");
  const poolId = raw == null || raw === "" ? DEFAULT_POOL_ID : raw;
  if (!isPoolId(poolId)) {
    return NextResponse.json({ error: `unknown pool "${poolId}"` }, { status: 400 });
  }
  const pool = await getPool(SEASON, poolId);
  return NextResponse.json({
    ok: true,
    entries: pool.entries ?? [],
    entriesWeek: pool.entriesWeek ?? null,
  });
}
