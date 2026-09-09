import { configuredSendDay, DAYS, dayInNewYork, runThursdayEmail } from "@/lib/thursday/run";

export const dynamic = "force-dynamic";

// GET /api/thursday-email - the survivor pick and the lineups, before kickoff.
//
// Called by the daily snapshot cron rather than having a schedule of its own.
// Vercel Hobby allows two cron jobs and both are spoken for, so this decides
// for itself whether today is the day, exactly as the FAAB guide does. The
// snapshot runs at 12:00 UTC, which is 8am in New York, and Thursday night
// kickoff is twelve hours after that.
//
// Running daily also means a missed Thursday is not a missed week: ?force=1
// sends on demand.
//
//   ?check=1   readiness, no auth, no send
//   ?dry=1     render and return the HTML without sending
//   ?force=1   ignore the day gate
//   ?resend=1  send again even though this week already went out
//   ?test=1    mark the subject [Test], for looking at a change

/** jackhastings00@gmail.com becomes ja***@gmail.com. */
function maskAddress(value: string | null): string {
  if (!value) return "MISSING";
  return value.replace(/([^@<\s]{1,2})[^@<\s]*@/g, "$1***@");
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;

  // Before the cron guard on purpose, and for the same reason the FAAB guide
  // does it: Vercel will not hand back a secret's value, so CRON_SECRET cannot
  // be read out to call this by hand, and "will Thursday work" would otherwise
  // be unanswerable from a browser. Presence only, addresses masked.
  if (params.get("check") === "1") {
    const to = process.env.FAAB_EMAIL_TO ?? null;
    return Response.json({
      ok: true,
      willSend: Boolean(process.env.RESEND_API_KEY && to),
      config: {
        resendKey: process.env.RESEND_API_KEY ? "set" : "MISSING",
        to: maskAddress(to),
        from: maskAddress(process.env.FAAB_EMAIL_FROM ?? null),
        appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "(default)",
        cronSecret: process.env.CRON_SECRET ? "set" : "open",
      },
      schedule: {
        sendDay: DAYS[configuredSendDay()],
        today: DAYS[dayInNewYork(new Date())],
      },
    });
  }

  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  return runThursdayEmail({
    force: params.get("force") === "1",
    dry: params.get("dry") === "1",
    resend: params.get("resend") === "1",
    test: params.get("test") === "1",
  });
}
