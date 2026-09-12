import { NextResponse } from "next/server";
import { z } from "zod";
import { buildReport, buildReports, SEASON } from "@/lib/survivor/report";
import { getPool, savePool } from "@/lib/survivor/state";
import { DEFAULT_POOL_ID, isPoolId } from "@/lib/survivor/pools";

export const dynamic = "force-dynamic";

/**
 * GET  /api/survivor            -> the main pool's report
 * GET  /api/survivor?pool=<id>  -> that pool's report
 * GET  /api/survivor?pool=all   -> { pools: [...] }, one entry per pool
 * POST /api/survivor?pool=<id>  -> update that pool, then return it rebuilt
 *
 * The bare GET keeps returning a single report so anything already reading it
 * (the Atlas endpoint, a bookmark) did not break when the second pool arrived.
 *
 * Same report object the page renders, so an answer read here and an answer
 * read on screen cannot disagree.
 */

/** Query string to pool id, or an error message for a 400. */
function requestedPool(req: Request): { id: string } | { error: string } {
  const raw = new URL(req.url).searchParams.get("pool");
  if (!raw) return { id: DEFAULT_POOL_ID };
  if (!isPoolId(raw)) return { error: `unknown pool "${raw}"` };
  return { id: raw };
}

export async function GET(req: Request) {
  const wantsAll = new URL(req.url).searchParams.get("pool") === "all";
  const target = wantsAll ? { id: "all" } : requestedPool(req);
  if ("error" in target) {
    return NextResponse.json({ error: target.error }, { status: 400 });
  }

  try {
    if (wantsAll) {
      return NextResponse.json({ pools: await buildReports() });
    }
    return NextResponse.json(await buildReport(target.id));
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "failed to build report" },
      { status: 500 },
    );
  }
}

const patchSchema = z.object({
  name: z.string().min(1).max(60).optional(),
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
  const target = requestedPool(req);
  if ("error" in target) {
    return NextResponse.json({ error: target.error }, { status: 400 });
  }

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
    await savePool(SEASON, target.id, parsed.data);
    const report = await buildReport(target.id);
    return NextResponse.json(report);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "failed to save" },
      { status: 500 },
    );
  }
}

/** The stored pool on its own, for the config form. */
export async function PUT(req: Request) {
  const target = requestedPool(req);
  if ("error" in target) {
    return NextResponse.json({ error: target.error }, { status: 400 });
  }
  return NextResponse.json(await getPool(SEASON, target.id));
}
