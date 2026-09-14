import { runLockAlarm } from "@/lib/sunday/run";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET /api/lock-alarm - the 11:45 exception check.
//
// Sends only when something is actually wrong, so a bare call on a healthy
// Sunday answers "nothing is wrong" and sends nothing. That is the normal
// result and is worth being able to ask for on demand.
//
//   ?dry=1     render the alarm if there is one, send nothing
//   ?resend=1  send again even though an alarm already went out this week

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;

  const secret = process.env.CRON_SECRET;
  const dry = params.get("dry") === "1";
  if (secret && !dry && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  return runLockAlarm({
    dry,
    resend: params.get("resend") === "1",
    test: params.get("test") === "1",
  });
}
