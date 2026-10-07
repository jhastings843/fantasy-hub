import { getPicksReport, refreshPicks } from "@/lib/picks/report";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET /api/picks - the Picks tab's report as JSON.
//
//   ?league=nfl|cfb  which board (default nfl)
//   ?refresh=1       refetch both sites now (needs the cron secret)

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const league = params.get("league") === "cfb" ? "cfb" : "nfl";
  if (params.get("refresh") === "1") {
    const secret = process.env.CRON_SECRET;
    if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
      return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    return Response.json({ ok: true, report: await refreshPicks(league) });
  }
  const fresh = await getPicksReport(league);
  return Response.json({ ok: !!fresh.value, stale: fresh.stale, at: fresh.at, report: fresh.value });
}
