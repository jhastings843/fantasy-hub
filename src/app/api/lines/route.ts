import { runLineArchive } from "@/lib/models/archive";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// GET /api/lines: archives DraftKings' NBA and NFL player prop lines (ESPN's
// odds feed) and Kalshi's first TD and first basket prices for every game not
// yet started, and closes games that have. Called by the NBA props and first
// TD GitHub workflows on their slots. Same bearer secret as the other cron routes.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const report = await runLineArchive();
  return Response.json({ ok: report.problems.length === 0, report });
}
