import { ingestPem, pemWeeks } from "@/lib/picks/pem";
import { cardKind } from "@/lib/picks/pem-card";
import { refreshPicks } from "@/lib/picks/report";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/picks/pem - a PEM card for the college tab.
//
// Called by scripts/pem-relay.mjs on Jack's Mac, which finds Jay's weekly
// card post on X. Body: { tweetId, text, imageUrl, season? } for a post, or
// { season, week, rows } to load a week typed in by hand. Needs the cron
// secret. GET lists what is on file.

/** The cron secret, or the PEM relay's own narrower one. */
function authorized(request: Request): boolean {
  const given = request.headers.get("authorization");
  const secrets = [process.env.CRON_SECRET, process.env.PEM_RELAY_SECRET].filter(Boolean);
  return secrets.length === 0 || secrets.some((s) => given === `Bearer ${s}`);
}

export async function POST(request: Request) {
  if (!authorized(request)) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as {
    tweetId?: string;
    text?: string;
    imageUrl?: string;
    season?: number;
    week?: number;
    rows?: Parameters<typeof ingestPem>[0]["rows"];
  } | null;
  if (!body) return Response.json({ ok: false, error: "Send JSON." }, { status: 400 });

  const kind = body.text ? cardKind(body.text) : null;
  const week = body.week ?? kind?.week;
  if (!week) return Response.json({ ok: true, skipped: true, reason: "Not a weekly card post." });
  // Only the picks card goes in from a post. The results card repeats the
  // lines after the fact; the grading already comes from the final scores.
  if (!body.rows && kind?.kind !== "picks") {
    return Response.json({ ok: true, skipped: true, reason: `Week ${week} ${kind?.kind ?? "post"} card, not a picks card.` });
  }
  const season = body.season ?? new Date().getUTCFullYear();
  try {
    const result = await ingestPem({ season, week, tweetId: body.tweetId, text: body.text, imageUrl: body.imageUrl, rows: body.rows });
    if ("skipped" in result) return Response.json({ ok: true, skipped: true, reason: result.skipped });
    await refreshPicks("cfb").catch(() => null);
    return Response.json({
      ok: true,
      week: result.week,
      games: result.rows.length,
      verified: result.verified,
      problems: result.problems,
    });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function GET(request: Request) {
  if (!authorized(request)) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const season = Number(new URL(request.url).searchParams.get("season")) || new Date().getUTCFullYear();
  const weeks = await pemWeeks(season);
  return Response.json({
    ok: true,
    weeks: weeks.map((w) => ({ week: w.week, games: w.rows.length, verified: w.verified, problems: w.problems, source: w.source, at: w.at })),
  });
}
