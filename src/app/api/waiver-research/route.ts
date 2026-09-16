import { getNflState } from "@/lib/sleeper/client";
import {
  readWaiverResearch,
  researchWaiverTargets,
  type ResearchFormat,
} from "@/lib/waivers/research";

export const dynamic = "force-dynamic";

// A web-search turn runs a minute or two. This route is called from its own
// scheduled workflow on Tuesdays, not from the pulse, whose 50-second budget
// is shared with everything else.
export const maxDuration = 300;

// POST /api/waiver-research?format=all|dynasty|redraft[&force=1]
//
// Researches this week's waiver consensus and caches it for the waiver
// pages. Runs once per format per week unless forced.
export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const params = new URL(request.url).searchParams;
  const wanted = params.get("format") ?? "all";
  const force = params.get("force") === "1";
  const formats: ResearchFormat[] =
    wanted === "dynasty" ? ["dynasty"] : wanted === "redraft" ? ["redraft"] : ["dynasty", "redraft"];

  const state = await getNflState();
  const results: Record<string, unknown> = {};
  for (const format of formats) {
    try {
      const existing = force ? null : await readWaiverResearch(state.season, state.week, format);
      const research = existing ?? (await researchWaiverTargets(format, state.season, state.week));
      results[format] = {
        ok: true,
        cached: Boolean(existing),
        week: research.week,
        targets: research.targets.length,
        generatedAt: research.generatedAt,
        top: research.targets.slice(0, 5).map((t) => `${t.name} ${t.faabPercent}%`),
      };
    } catch (e) {
      results[format] = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }
  const ok = Object.values(results).every((r) => (r as { ok: boolean }).ok);
  return Response.json({ ok, week: state.week, results }, { status: ok ? 200 : 500 });
}
