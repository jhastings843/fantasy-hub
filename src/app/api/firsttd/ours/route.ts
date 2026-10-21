import { runOurFirstTd } from "@/lib/models/nfl/ftd-store";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// GET /api/firsttd/ours: our own NFL First TD model. Builds this week's
// boards (nflverse TD history, the market's total and spread, Kalshi's
// prices), grades finals from ESPN's scoring plays and runs our section's
// learning review. Called by the first TD workflow (first-td.yml). Same
// bearer secret as the other cron routes.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const report = await runOurFirstTd();
  return Response.json({ ok: report.problems.length === 0, report });
}
