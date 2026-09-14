import { runSundayBrief } from "@/lib/sunday/run";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET /api/sunday-email - the 9am Sunday brief.
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

  return runSundayBrief({
    dry,
    resend: params.get("resend") === "1",
    test: params.get("test") === "1",
  });
}
