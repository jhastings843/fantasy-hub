import { configuredSendDay, DAYS, dayInNewYork, runFaabEmail } from "@/lib/guillotine/run";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET /api/faab-email - the Tuesday guide, in Jack's inbox.
//
// Vercel Hobby runs one cron a day, so this runs daily and decides for itself
// whether today is the day. It is no longer the only caller: the pulse runs
// every fifteen minutes and calls the same job the moment its send window
// opens, which is why the job itself moved to lib/guillotine/run.ts. This
// route is the backstop for a GitHub Actions outage and the way to trigger a
// send by hand.
//
//   ?check=1   readiness, no auth, no send
//   ?dry=1     render and return the HTML without sending
//   ?force=1   ignore the day gate
//   ?resend=1  send again even though this week already went out
//   ?league=   name the league rather than finding the guillotine one

/** jackhastings00@gmail.com becomes ja***@gmail.com. */
function maskAddress(value: string | null): string {
  if (!value) return "MISSING";
  return value.replace(/([^@<\s]{1,2})[^@<\s]*@/g, "$1***@");
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;

  // The readiness check runs BEFORE the cron guard on purpose. Vercel will not
  // hand back a sensitive variable's value, so CRON_SECRET cannot be read back
  // out to call this route by hand, which would leave the one question that
  // matters ("will Tuesday work") unanswerable from a browser. It reports
  // presence only, and masks the addresses, so what it exposes is that this app
  // sends mail, which is not worth protecting.
  if (params.get("check") === "1") {
    const to = process.env.FAAB_EMAIL_TO ?? null;
    const sendDay = configuredSendDay();
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
        sendDay: DAYS[sendDay],
        today: DAYS[dayInNewYork(new Date())],
      },
    });
  }

  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  return runFaabEmail({
    force: params.get("force") === "1",
    dry: params.get("dry") === "1",
    // Deliberately separate from force. Force means "ignore the schedule";
    // resend means "yes, send this week's guide a second time", which is a
    // rarer and more annoying thing to do by accident.
    resend: params.get("resend") === "1",
    leagueId: params.get("league") ?? undefined,
  });
}
