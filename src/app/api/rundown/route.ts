import { assembleRundown, isDate, yesterdayEt } from "@/lib/rundown/assemble";
import { loadRundownInputs } from "@/lib/rundown/store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET /api/rundown?date=YYYY-MM-DD: one night's results across every market,
// read-only, for command-center's daily email. `date` is the Eastern day the
// games settled; it defaults to yesterday in America/New_York. Its own bearer
// token (RUNDOWN_READ_TOKEN), so the email can't reach the cron routes.
// A reader that fails is skipped and named in the X-Rundown-Problems header.

const authed = (r: Request) => !!process.env.RUNDOWN_READ_TOKEN && r.headers.get("authorization") === `Bearer ${process.env.RUNDOWN_READ_TOKEN}`;

export async function GET(request: Request) {
  if (!process.env.RUNDOWN_READ_TOKEN) return Response.json({ ok: false, error: "RUNDOWN_READ_TOKEN is not set" }, { status: 503 });
  if (!authed(request)) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const now = new Date();
  const date = new URL(request.url).searchParams.get("date") ?? yesterdayEt(now);
  if (!isDate(date)) return Response.json({ ok: false, error: "date must be YYYY-MM-DD" }, { status: 400 });
  const { sources, events, problems } = await loadRundownInputs(date);
  const body = assembleRundown({ date, now, baseUrl: process.env.NEXT_PUBLIC_APP_URL ?? "https://fantasy-hub-tan.vercel.app", sources, events });
  const headers: Record<string, string> = { "cache-control": "no-store" };
  if (problems.length) headers["x-rundown-problems"] = problems.join(" | ").replace(/[^\x20-\x7e]/g, "").slice(0, 1000);
  return Response.json(body, { headers });
}
