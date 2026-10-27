import { runOurNflProps } from "@/lib/models/nfl/store";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// GET /api/props/nfl/ours: our own NFL props model. Reads nflverse's weekly
// stats, projects this week's games against DraftKings' lines,
// grades finals and runs our section's learning review. Called by the first
// TD and props workflow (first-td.yml). Same bearer secret as the other cron routes.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const report = await runOurNflProps();
  return Response.json({ ok: report.problems.length === 0, report });
}
