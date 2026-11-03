import { formatsFor, runWaiverResearch } from "@/lib/waivers/run-research";

export const dynamic = "force-dynamic";

// A web-search turn runs a minute or two, sometimes past three. The weekly
// job now runs the research on the GitHub runner (scripts/waiver-research.mts)
// and only falls back to this route when the runner lacks its secrets.
export const maxDuration = 300;

// POST /api/waiver-research?format=all|dynasty|redraft[&force=1]
//
// Researches this week's waiver consensus and caches it for the waiver
// pages. Runs once per format per week unless forced.
export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const params = new URL(request.url).searchParams;
  const out = await runWaiverResearch(formatsFor(params.get("format")), { force: params.get("force") === "1" });
  return Response.json(out, { status: out.ok ? 200 : 500 });
}
