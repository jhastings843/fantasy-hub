import { lastPulse } from "@/lib/pulse/run";

export const dynamic = "force-dynamic";

// GET /api/health - alive, and when the heartbeat last ran.
//
// The pulse is the one part of this app whose failure is silent: nothing looks
// broken when the numbers are simply old. So the last receipt is reported
// here, where it can be checked from a phone without a secret. It says what
// ran and when, never what the data was.

export async function GET() {
  const last = await lastPulse();

  return Response.json({
    ok: true,
    ts: Date.now(),
    pulse: last
      ? {
          at: last.at,
          tier: last.tier,
          window: last.window,
          ok: last.ok,
          ms: last.ms,
          jobs: last.jobs.map((j) => `${j.job}: ${j.ok ? "ok" : `failed, ${j.error}`}`),
          sends: last.sends.map((s) => `${s.id}: ${s.status}`),
          // Minutes rather than a timestamp to read: the question is always
          // "is it still running", and 14 answers it faster than an ISO string.
          minutesAgo: Math.round((Date.now() - Date.parse(last.at)) / 60000),
        }
      : null,
  });
}
