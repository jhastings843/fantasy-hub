import { runNbaProps } from "@/lib/props/nba-props";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// GET /api/props/nba: saves today's pregame NBA player prop pages from Sam's
// models, grades finished games from ESPN's box score and updates the NBA
// system. Called by the NBA props GitHub workflow (nba-props.yml) and the
// daily snapshot rider. Same bearer secret as the other cron routes.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const report = await runNbaProps();
  return Response.json({ ok: report.problems.length === 0, report });
}
