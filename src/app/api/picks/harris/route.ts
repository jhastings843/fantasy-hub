import { harrisNow, harrisWeeks, ingestHarris } from "@/lib/picks/harris";
import { isContestPost } from "@/lib/picks/harris-sheet";
import { harrisSummary } from "@/lib/picks/harris-track";

export const dynamic = "force-dynamic";
// Up to four image reads, plus a Sonnet retry on any that fail their check.
export const maxDuration = 300;

// POST /api/picks/harris - John Harris's weekly contest post, tracked only.
//
// Called by scripts/pem-relay.mjs on Jack's Mac. Body: { tweetId, text,
// postedAt, imageUrls } for a post, or { season, week, sheet, text? } for a
// week typed in by hand. Needs the cron secret or the relay's own secret.
// GET returns the tracker and what is on file.

function authorized(request: Request): boolean {
  const given = request.headers.get("authorization");
  const secrets = [process.env.CRON_SECRET, process.env.PEM_RELAY_SECRET].filter(Boolean);
  return secrets.length === 0 || secrets.some((s) => given === `Bearer ${s}`);
}

export async function POST(request: Request) {
  if (!authorized(request)) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as Parameters<typeof ingestHarris>[0] | null;
  if (!body) return Response.json({ ok: false, error: "Send JSON." }, { status: 400 });
  if (!body.sheet && !(body.text && isContestPost(body.text))) return Response.json({ ok: true, skipped: true, reason: "Not a contest picks post." });
  try {
    const r = await ingestHarris({ ...body, season: body.season ?? new Date().getUTCFullYear() });
    if ("skipped" in r) return Response.json({ ok: true, skipped: true, reason: r.skipped });
    return Response.json({ ok: true, week: r.week, games: r.rows.length, picks: r.picks.length, verified: r.verified, problems: r.problems });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function GET(request: Request) {
  if (!authorized(request)) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const season = Number(new URL(request.url).searchParams.get("season")) || new Date().getUTCFullYear();
  const [weeks, report] = await Promise.all([harrisWeeks(season), harrisNow()]);
  return Response.json({
    ok: true,
    summary: report ? harrisSummary(report) : null,
    report,
    weeks: weeks.map((w) => ({ week: w.week, games: w.rows.length, picks: w.picks.length, verified: w.verified, problems: w.problems.length, source: w.source, at: w.at })),
  });
}
