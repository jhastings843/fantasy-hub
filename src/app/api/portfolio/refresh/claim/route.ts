import { sameString } from "@/lib/auth/session";
import { claimRefresh } from "@/lib/portfolio/store";

export const dynamic = "force-dynamic";

// POST /api/portfolio/refresh/claim: Jack's Mac asks once a minute whether the
// Refresh button was pressed (stocks repo, scripts/refresh_poll.py). Same secret
// as the ingest route. Returns the request time and clears it, so one tap means
// one refresh. Fails closed: no secret set, nothing gets in.
export async function POST(request: Request) {
  const secret = process.env.PORTFOLIO_INGEST_SECRET;
  if (!secret || !sameString(request.headers.get("authorization") ?? "", `Bearer ${secret}`)) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const requestedAt = await claimRefresh();
  return Response.json({ ok: true, requested: requestedAt !== null, requestedAt });
}
