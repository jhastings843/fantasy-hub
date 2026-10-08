import { runStrategyReview } from "@/lib/picks/learning/run";
import { appendJournal } from "@/lib/picks/learning/store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET  /api/picks/review?dry=1   run the strategy review without writing anything (needs the cron secret)
// GET  /api/picks/review         run it for real (the pulse normally does this)
// POST /api/picks/review         record a UI check result in the journal: { title, why, evidence }

/** Fails closed: with no secret configured, nobody can run or write. */
function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  return !!secret && request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!authorized(request)) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const dry = new URL(request.url).searchParams.get("dry") === "1";
  const r = await runStrategyReview({ dryRun: dry, reason: dry ? "dry run" : "manual" });
  return Response.json({
    ok: true,
    dryRun: dry,
    outcome: r.state.lastOutcome,
    activated: r.activated ?? null,
    rolledBack: r.rolledBack ?? null,
    registered: r.registered,
    decisions: r.decisions,
    journal: r.journal,
  });
}

export async function POST(request: Request) {
  if (!authorized(request)) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { title?: string; why?: string; evidence?: unknown };
  if (!body.title || !body.why) return Response.json({ ok: false, error: "title and why are required" }, { status: 400 });
  await appendJournal({ at: new Date().toISOString(), kind: "ui", title: String(body.title).slice(0, 200), why: String(body.why).slice(0, 2000), evidence: body.evidence });
  return Response.json({ ok: true });
}
