import { lastPulse, runPulse } from "@/lib/pulse/run";
import { tempoFor } from "@/lib/pulse/tempo";

export const dynamic = "force-dynamic";
// The live tier rebuilds two survivor boards, four lineups and the Jingles
// ingest in one call. Sixty seconds is Vercel's ceiling on this plan and the
// jobs time out at 25 apiece, so a bad upstream cannot hold the whole run.
export const maxDuration = 60;

// GET /api/pulse - the heartbeat.
//
// Called every fifteen minutes by a QStash schedule (scripts/qstash-pulse.mjs),
// with .github/workflows/pulse.yml as a backstop that GitHub fires a few times
// a day. What it does depends on the Eastern clock, which is decided in
// lib/pulse/tempo.ts and tested there rather than being expressed in cron.
//
//   (no args)   do whatever is due now
//   ?peek=1     say what would happen, do nothing. No auth: it reads a clock
//   ?tier=live  force a tier, for proving a window works out of season
//   ?sends=0    refresh only, send nothing

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;

  // Before the auth guard, and for the same reason the FAAB readiness check
  // is: Vercel will not hand CRON_SECRET back, so without this there is no way
  // to ask from a browser whether the schedule is right. It reads a clock and
  // nothing else.
  if (params.get("peek") === "1") {
    const tempo = tempoFor(new Date());
    return Response.json({ ok: true, tempo, last: await lastPulse() });
  }

  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const tier = params.get("tier");
  const receipt = await runPulse({
    tier:
      tier === "live" || tier === "hourly" || tier === "overnight" || tier === "idle"
        ? tier
        : undefined,
    sends: params.get("sends") !== "0",
  });

  // Always 200. A failing job is reported in the receipt, and a non-200 here
  // would put a red cross on the Actions run for a Yahoo outage nobody can do
  // anything about.
  return Response.json(receipt);
}
