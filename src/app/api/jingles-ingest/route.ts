import { ingestJingles, lastRun, latestWaivers, readRankings } from "@/lib/jingles/ingest";
import type { Scoring } from "@/lib/jingles/parse";

export const dynamic = "force-dynamic";

// GET /api/jingles-ingest - pull his latest posts into the app.
//
// Runs from the daily snapshot cron rather than a schedule of its own, because
// Vercel Hobby allows two cron jobs and both are spoken for. He posts a few
// times a week, so daily is ample; ?force=1 reprocesses posts already seen,
// which is what you want after changing a parser.
//
// GET without arguments reports the last run instead of triggering one, so
// checking on it is free.
//
// ?ifNeeded=1 is what the Tuesday-to-Thursday schedule sends: work only if his
// rankings or his waiver post for the coming week are still missing. Several
// runs a day catch him whenever he publishes, and the ones after that cost two
// reads and stop.
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const run = params.get("run") === "1" || params.get("force") === "1";
  const force = params.get("force") === "1";
  const ifNeeded = params.get("ifNeeded") === "1";

  if (!run) {
    const previous = await lastRun();
    const stored = await Promise.all(
      (["half_ppr", "full_ppr", "standard"] as Scoring[]).map(async (scoring) => {
        const r = await readRankings(scoring);
        return r
          ? {
              scoring,
              title: r.title,
              postedAt: r.postedAt,
              players: r.entries.length,
              tiers: r.tiers.length,
              // The players his list names that the app could not key to
              // Sleeper. Shown in full: a count is a shrug, a list is a fix.
              unresolved: r.unresolved,
            }
          : null;
      }),
    );
    const waivers = await latestWaivers();
    return Response.json({
      ok: true,
      rankings: stored.filter(Boolean),
      // His bids for the week, summarised. The rows themselves are large and
      // the point of showing them here is answering "did tonight's run get
      // them" without reading Redis by hand.
      waivers: waivers
        ? {
            season: waivers.season,
            week: waivers.week,
            budget: waivers.budget,
            players: waivers.rows.length,
            unresolved: waivers.unresolved,
            ingestedAt: waivers.ingestedAt,
            top: waivers.rows.slice(0, 5).map((r) => `${r.name} $${r.faab}`),
          }
        : null,
      lastRun: previous,
      hint: previous
        ? "Add ?run=1 to pull again, or ?force=1 to reprocess posts already seen."
        : "Nothing ingested yet. Add ?run=1 to pull his posts.",
    });
  }

  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    // Reading the last run is harmless; triggering work is not.
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const report = await ingestJingles({ force, ifNeeded });
    return Response.json({ ok: true, report });
  } catch (e) {
    return Response.json(
      { ok: false, error: `Ingest failed: ${(e as Error).message}` },
      { status: 502 },
    );
  }
}
