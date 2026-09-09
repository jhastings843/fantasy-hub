import { getMyLeagues } from "@/lib/league/discover";
import { getUser } from "@/lib/sleeper/client";
import { getRosterGrades } from "@/lib/rosteraudit/client";
import { recordGradeSnapshot, snapshotDate } from "@/lib/history/grades";
import { ingestJingles } from "@/lib/jingles/ingest";
import { runThursdayEmail } from "@/lib/thursday/run";

export const dynamic = "force-dynamic";

// GET /api/snapshot — logs today's roster grades for every Sleeper league on
// the account, so rank moves can be explained from history instead of guessed
// at. Runs daily from the Vercel cron in vercel.json; the dashboard also
// records on render, so history keeps filling even if a cron run is missed.
//
// Set CRON_SECRET in the project env to lock this down. Vercel sends it as a
// bearer token on scheduled runs. With no secret set the route stays open,
// which is fine for a single-user app but worth knowing.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const username = process.env.SLEEPER_USERNAME;
  if (!username) {
    return Response.json(
      { ok: false, error: "Missing SLEEPER_USERNAME" },
      { status: 400 },
    );
  }

  try {
    const [me, leagues] = await Promise.all([
      getUser(username),
      getMyLeagues(),
    ]);

    // Manual leagues have no Sleeper id and so no grades to read, and
    // RosterAudit publishes dynasty grades only: asking it about a redraft
    // league answers 400, which is a failure row every day for no reason.
    const sleeperLeagues = leagues.filter(
      (l) => l.source !== "manual" && l.type === "dynasty",
    );

    const results = await Promise.all(
      sleeperLeagues.map(async (league) => {
        try {
          const grades = await getRosterGrades(league.id, me.user_id);
          const recorded = await recordGradeSnapshot(league.id, grades);
          return { league: league.name, id: league.id, recorded };
        } catch (e) {
          return {
            league: league.name,
            id: league.id,
            recorded: false,
            error: e instanceof Error ? e.message : String(e),
          };
        }
      }),
    );

    // Pull anything new from Jingles Labs on the same run. This rides along
    // here rather than on a schedule of its own because Vercel Hobby allows two
    // cron jobs and both are spoken for; he posts a few times a week, so daily
    // is ample. A failure is reported, never fatal: the grade snapshot is the
    // job this route exists to do.
    let jingles: unknown;
    try {
      jingles = await ingestJingles();
    } catch (e) {
      jingles = { error: e instanceof Error ? e.message : String(e) };
    }

    // The Thursday email rides along for the same reason, and it must run AFTER
    // the ingest above: the lineups it sends are read from whatever his weekly
    // list says right now, and he edits that post through the week. Ingest
    // first, then advise, or Thursday's email quotes Monday's ranks.
    //
    // It decides for itself whether today is Thursday and whether this week has
    // already gone out, so calling it daily is correct rather than merely safe.
    let thursday: unknown;
    try {
      const res = await runThursdayEmail();
      thursday = await res.json();
    } catch (e) {
      thursday = { error: e instanceof Error ? e.message : String(e) };
    }

    return Response.json({ ok: true, date: snapshotDate(), results, jingles, thursday });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
