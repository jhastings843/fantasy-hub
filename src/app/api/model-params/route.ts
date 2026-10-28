import KOTC from "@/lib/models/nba/kotc-params.json";
import NBA_GAME from "@/lib/models/nba/game-params.json";
import NBA_PROPS from "@/lib/models/nba/params.json";
import NBA_FB from "@/lib/models/nba/fb-params.json";
import NFL_PROPS from "@/lib/models/nfl/params.json";
import NFL_FTD from "@/lib/models/nfl/ftd-params.json";
import NFL_ATTD from "@/lib/models/nfl/attd-params.json";
import NFL_SPREAD from "@/lib/models/nfl/spread-params.json";
import { MODEL_KEYS, type ModelKey, checkParams, saveParams, storedParams } from "@/lib/models/params-store";

export const dynamic = "force-dynamic";

// POST /api/model-params: the weekly refit job (.github/workflows/model-refit.yml)
// stores a refit that beat the live settings on games the fit never saw.
// GET ?model=: what is stored and why. Same bearer secret as the cron routes.
// The job decides "better"; this route only refuses settings that don't fit
// the model (unknown names, changed shapes) or arrive without the evidence.

const DEFAULTS: Record<ModelKey, Record<string, unknown>> = {
  "nba-props": NBA_PROPS, "nba-fb": NBA_FB, "nba-game": NBA_GAME, "nba-kotc": KOTC,
  "nfl-props": NFL_PROPS, "nfl-ftd": NFL_FTD, "nfl-attd": NFL_ATTD, "nfl-spread": NFL_SPREAD,
};

const authed = (r: Request) => !!process.env.CRON_SECRET && r.headers.get("authorization") === `Bearer ${process.env.CRON_SECRET}`;

export async function GET(request: Request) {
  if (!authed(request)) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const model = new URL(request.url).searchParams.get("model") as ModelKey | null;
  if (!model || !MODEL_KEYS.includes(model)) return Response.json({ ok: false, error: `model must be one of ${MODEL_KEYS.join(", ")}` }, { status: 400 });
  return Response.json({ ok: true, stored: await storedParams(model) });
}

export async function POST(request: Request) {
  if (!authed(request)) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { model?: ModelKey; params?: Record<string, unknown>; evidence?: { before: number; after: number; games: number; se: number; note?: string } } | null;
  if (!body?.model || !MODEL_KEYS.includes(body.model)) return Response.json({ ok: false, error: "unknown model" }, { status: 400 });
  const e = body.evidence;
  if (!body.params || !e || ![e.before, e.after, e.games, e.se].every((x) => typeof x === "number" && Number.isFinite(x))) return Response.json({ ok: false, error: "params and evidence (before, after, games, se) required" }, { status: 400 });
  // The bar every refit is held to: better on held-out games by more than 2 standard errors.
  if (!(e.after < e.before && e.se >= 2)) return Response.json({ ok: false, error: `not better by 2 standard errors (before ${e.before}, after ${e.after}, ${e.se} SE)` }, { status: 422 });
  const problems = checkParams(DEFAULTS[body.model], body.params);
  if (problems.length) return Response.json({ ok: false, error: problems.join("; ") }, { status: 422 });
  await saveParams(body.model, { params: body.params, at: new Date().toISOString(), evidence: e });
  return Response.json({ ok: true, model: body.model });
}
