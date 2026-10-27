import { runNbaPicks } from "@/lib/picks/nba-track-store";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// GET /api/picks/nba: saves Sam's pregame NBA reads at the DraftKings line,
// settles finished games from ESPN and runs the weekly NBA learning review
// when due. Called by the NBA GitHub workflow (nba-props.yml) and the daily
// snapshot rider. Same bearer secret as the other cron routes.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const report = await runNbaPicks();
  return Response.json({ ok: report.problems.length === 0, report });
}
