import { runLineupWatch } from "@/lib/watch/run";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET /api/lineup-watch - the daily lineup check. The pulse calls it on its
// schedule (Thu to Sat noon, Sunday 12:15); this route is for doing it by hand.
//
//   ?dry=1    render what would go, or say nothing would, without sending
//   ?force=1  skip the once-a-day and Wednesday-email gates
//   ?seed=1   mark every pending change as already emailed, send nothing

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  return runLineupWatch({
    force: params.get("force") === "1", dry: params.get("dry") === "1",
    seed: params.get("seed") === "1",
  });
}
