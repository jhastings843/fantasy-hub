import { NextResponse } from "next/server";
import { z } from "zod";
import { buildReport, SEASON } from "@/lib/survivor/report";
import { getPool, savePool } from "@/lib/survivor/state";

export const dynamic = "force-dynamic";

/**
 * GET  /api/survivor  -> the full weekly report
 * POST /api/survivor  -> update the pool, then return the report rebuilt on it
 *
 * Same report object the page renders, so an answer read here and an answer
 * read on screen cannot disagree.
 */
export async function GET() {
  try {
    const report = await buildReport();
    return NextResponse.json(report);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "failed to build report" },
      { status: 500 },
    );
  }
}

const patchSchema = z.object({
  poolSize: z.number().int().min(1).max(1_000_000).optional(),
  entriesAlive: z.number().int().min(1).max(1_000_000).nullable().optional(),
  strikes: z.number().int().min(1).max(5).optional(),
  canRebuy: z.boolean().optional(),
  tieAdvances: z.boolean().optional(),
  usedTeams: z.array(z.string().max(4)).max(32).optional(),
  // An empty string clears that week's pick, which savePool strips.
  myPicks: z.record(z.string(), z.string().max(4)).optional(),
  horizon: z.number().int().min(1).max(12).optional(),
  weeklyPicks: z
    .record(z.string(), z.record(z.string(), z.number().min(0).max(100)))
    .optional(),
});

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid pool config", detail: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    await savePool(SEASON, parsed.data);
    const report = await buildReport();
    return NextResponse.json(report);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "failed to save" },
      { status: 500 },
    );
  }
}

/** The stored pool on its own, for the config form. */
export async function PUT() {
  return NextResponse.json(await getPool(SEASON));
}
