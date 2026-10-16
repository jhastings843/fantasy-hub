import { saveSnapshot } from "@/lib/money/store";
import { isSnapshot } from "@/lib/money/types";

export const dynamic = "force-dynamic";

// POST /api/money/ingest: trade-bot on Jack's Mac posts the latest Phil and
// paper-book snapshot after each run (tradebot/money_export.py). Its own
// secret, MONEY_INGEST_SECRET, so the Mac never holds this app's cron key.
export async function POST(request: Request) {
  const secret = process.env.MONEY_INGEST_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json().catch(() => null);
  if (!isSnapshot(body)) return Response.json({ ok: false, error: "Not a version 1 snapshot" }, { status: 400 });
  await saveSnapshot(body);
  return Response.json({ ok: true, books: body.books.length, phil: !!body.phil, generatedAt: body.generatedAt });
}
