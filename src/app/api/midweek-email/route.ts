import { runMidweekEmail } from "@/lib/midweek/run";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET /api/midweek-email - Wednesday's waiver rundown.
//
// The pulse sends this on a Wednesday morning. This route exists for the same
// two reasons every other send has one: looking at a change without waiting
// for Wednesday (?dry=1), and sending by hand when something went wrong.
//
//   ?dry=1     render and return the HTML without sending
//   ?resend=1  send again even though this week already went out
//   ?test=1    mark the subject [Test]

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;

  const secret = process.env.CRON_SECRET;
  const dry = params.get("dry") === "1";
  if (secret && !dry && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  return runMidweekEmail({
    dry,
    resend: params.get("resend") === "1",
    test: params.get("test") === "1",
  });
}
