import { runPicksEmail, runPicksToday } from "@/lib/picks/run";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET /api/picks-email - the Tuesday update (no stakes).
//
//   ?update=day  today's bets instead (9am game-day email + push); "sat" is an old alias
//   ?dry=1       render and return the HTML without sending
//   ?resend=1    send again even though this week already went out
//   ?test=1      mark the subject [Test] and record nothing as issued

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const secret = process.env.CRON_SECRET;
  const dry = params.get("dry") === "1";
  if (secret && !dry && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const options = { dry, resend: params.get("resend") === "1", test: params.get("test") === "1" };
  const update = params.get("update");
  return update === "day" || update === "sat" ? runPicksToday(options) : runPicksEmail(options);
}
