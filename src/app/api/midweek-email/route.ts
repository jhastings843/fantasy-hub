import { runMidweekEmail } from "@/lib/midweek/run";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET /api/midweek-email - the other leagues' waiver rundown.
//
// Normally it goes out as a reply to Jingles' Tuesday waiver email (POST,
// below). The pulse sends it at 10pm Tuesday as the backstop when that relay
// never called. This route exists for the same
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

// POST /api/midweek-email - the relay on Jack's Mac, the moment Jingles' waiver
// email lands. Body: { messageId, subject, force? }. The email then goes out as
// a reply in his thread. Until his post is stored it answers { retry: true }
// and the relay calls again; force sends on what is stored.
//
// Its own secret (RELAY_SECRET), so the Mac never holds CRON_SECRET.
export async function POST(request: Request) {
  const secret = process.env.RELAY_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const body = (await request.json().catch(() => ({}))) as {
    messageId?: string;
    subject?: string;
    force?: boolean;
    /** Send this week's reply again, e.g. after a fix. Never set by the relay's own schedule. */
    resend?: boolean;
  };
  if (!body.messageId || !body.subject) {
    return Response.json({ ok: false, error: "messageId and subject are required" }, { status: 400 });
  }
  return runMidweekEmail({
    replyTo: { messageId: body.messageId, subject: body.subject },
    requireWaiverPost: !body.force,
    resend: body.resend === true,
  });
}
