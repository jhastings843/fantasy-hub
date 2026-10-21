import { runOurNbaProps } from "@/lib/models/nba/store";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// GET /api/props/nba/ours: our own NBA props model. Folds finished games into
// the model's tables, projects tonight's games against DraftKings' lines,
// grades finals and runs our section's learning review. Called by the NBA
// props GitHub workflow (nba-props.yml). Same bearer secret as the other cron routes.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const report = await runOurNbaProps();
  return Response.json({ ok: report.problems.length === 0, report });
}
