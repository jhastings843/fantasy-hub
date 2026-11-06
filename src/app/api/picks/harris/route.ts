import { harrisNow, harrisWeeks, ingestHarris, ingestHarrisFeed } from "@/lib/picks/harris";
import { isContestPost } from "@/lib/picks/harris-sheet";
import { harrisSummary } from "@/lib/picks/harris-track";
import { ingestHarrisCbb } from "@/lib/models/cbb/harris-store";

export const dynamic = "force-dynamic";
// One feed request at most; no model calls.
export const maxDuration = 60;

// POST /api/picks/harris - John Harris's weekly contest post, tracked only.
//
// Bodies:
//   { tweetId, text, postedAt }    his X post (scripts/pem-relay.mjs): picks only
//   { feed: true, week, season? }  re-read one week from his website feed (week 0 included)
//   { cbb: true, date }            re-read one day of his college basketball sheet (YYYY-MM-DD)
//   { season, week, sheet, text? } a week typed in by hand
// The hourly pulse reads his feed on its own (harrisFeedIfDue). Needs the
// cron secret or the relay's own secret. GET returns the tracker and what is
// on file.

function authorized(request: Request): boolean {
  const given = request.headers.get("authorization");
  const secrets = [process.env.CRON_SECRET, process.env.PEM_RELAY_SECRET].filter(Boolean);
  return secrets.some((s) => given === `Bearer ${s}`);
}

export async function POST(request: Request) {
  if (!authorized(request)) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as (Parameters<typeof ingestHarris>[0] & { feed?: boolean; cbb?: boolean; date?: string }) | null;
  if (!body) return Response.json({ ok: false, error: "Send JSON." }, { status: 400 });
  const season = body.season ?? new Date().getUTCFullYear();
  try {
    if (body.cbb) {
      if (typeof body.date !== "string") return Response.json({ ok: false, error: "Send the date to read (YYYY-MM-DD)." }, { status: 400 });
      const r = await ingestHarrisCbb(body.date);
      if ("skipped" in r) return Response.json({ ok: true, skipped: true, reason: r.skipped });
      return Response.json({ ok: true, date: r.date, games: r.rows.length, matched: r.rows.filter((x) => x.event).length, pregame: r.rows.filter((x) => x.pre).length, verified: r.verified, problems: r.problems, unpriced: r.unpriced ?? [] });
    }
    if (body.feed) {
      // Week 0 is a real college week: only a missing week is refused.
      if (body.week === undefined || body.week === null) return Response.json({ ok: false, error: "Send the week to read." }, { status: 400 });
      const r = await ingestHarrisFeed(season, body.week);
      if ("skipped" in r) return Response.json({ ok: true, skipped: true, reason: r.skipped });
      return Response.json({ ok: true, week: r.week, games: r.rows.length, verified: r.verified, problems: r.problems });
    }
    if (!body.sheet && !(body.text && isContestPost(body.text))) return Response.json({ ok: true, skipped: true, reason: "Not a contest picks post." });
    const r = await ingestHarris({ ...body, season });
    if ("skipped" in r) return Response.json({ ok: true, skipped: true, reason: r.skipped });
    // A post carries his picks only; the sheet's games and verified state belong to the feed, so they are reported apart (the relay does not retry a post over them).
    if (!body.sheet) return Response.json({ ok: true, week: r.week, picks: r.picks.length, sheet: { games: r.rows.length, verified: r.verified } });
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
