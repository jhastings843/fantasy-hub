import { runFirstTd } from "@/lib/firsttd/store";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// GET /api/firsttd: saves this week's pregame first TD pages from Sam's
// models and grades any final games from ESPN. Called by the game-day GitHub
// workflow (first-td.yml) and the daily snapshot cron. Same bearer secret as
// the other cron routes.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const report = await runFirstTd();
  return Response.json({ ok: report.problems.length === 0, report });
}
