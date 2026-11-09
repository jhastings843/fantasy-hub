import { addLine, loadChecks, recentLines } from "@/lib/money/activity";
import { getSnapshot } from "@/lib/money/store";
import { isDesk } from "@/lib/money/schedule";

export const dynamic = "force-dynamic";

// POST /api/money/activity: one line from a desk on the Mac as it works
// (trade-bot tradebot/activity.py), like "Checking 42 stocks for breakouts".
// Same MONEY_INGEST_SECRET as /api/money/ingest: same sender, same app.
// GET: the latest lines and each desk's last check, for the Today page's live
// feed. Plain progress text, nothing the Money page doesn't already show.

const MAX_TEXT = 200;

export async function POST(request: Request) {
  const secret = process.env.MONEY_INGEST_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as { desk?: unknown; text?: unknown; done?: unknown } | null;
  if (!body || !isDesk(body.desk) || typeof body.text !== "string" || !body.text.trim()) {
    return Response.json({ ok: false, error: "Needs desk and text" }, { status: 400 });
  }
  // The server's clock, not the Mac's: every line sorts on one clock.
  await addLine({ at: new Date().toISOString(), desk: body.desk, text: body.text.trim().slice(0, MAX_TEXT), done: body.done === true });
  return Response.json({ ok: true });
}

export async function GET() {
  try {
    const [lines, snap] = await Promise.all([recentLines(60), getSnapshot().catch(() => null)]);
    const checks = await loadChecks(snap);
    return Response.json({ ok: true, now: new Date().toISOString(), lines, checks }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    console.error("[money] activity read:", e);
    return Response.json({ ok: false, error: "Could not read the feed" }, { status: 500 });
  }
}
