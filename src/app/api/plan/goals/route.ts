import { NextResponse } from "next/server";
import { z } from "zod";
import { goalsSchema, leagueIdSchema, readGoals, saveGoals } from "@/lib/plan/goals-store";

export const dynamic = "force-dynamic";

// GET  /api/plan/goals?league=<id>  -> { goals }
// PUT  /api/plan/goals              { league, goals } -> { goals }
// Writes need the unlock cookie (src/proxy.ts matcher).

export async function GET(req: Request) {
  const league = leagueIdSchema.safeParse(new URL(req.url).searchParams.get("league"));
  if (!league.success) return NextResponse.json({ error: "unknown league" }, { status: 400 });
  const read = await readGoals(league.data);
  if (!read.ok) return NextResponse.json({ error: "Couldn't load goals right now." }, { status: 503 });
  return NextResponse.json({ goals: read.goals });
}

const bodySchema = z.object({ league: leagueIdSchema, goals: goalsSchema });

export async function PUT(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success && !leagueIdSchema.safeParse((body as { league?: unknown })?.league).success) return NextResponse.json({ error: "unknown league" }, { status: 400 });
  if (!parsed.success) return NextResponse.json({ error: "Those goals didn't look right (200 characters each, 50 at most)." }, { status: 400 });
  try {
    await saveGoals(parsed.data.league, parsed.data.goals);
  } catch (err) {
    console.error("plan goals save failed", parsed.data.league, err);
    return NextResponse.json({ error: "Couldn't save goals right now. Try again in a minute." }, { status: 503 });
  }
  return NextResponse.json({ goals: parsed.data.goals });
}
