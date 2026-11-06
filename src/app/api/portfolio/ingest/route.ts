import { sameString } from "@/lib/auth/session";
import { savePortfolio } from "@/lib/portfolio/store";
import { isPortfolioSnapshot } from "@/lib/portfolio/types";

export const dynamic = "force-dynamic";

// POST /api/portfolio/ingest: the daily run on Jack's Mac (stocks repo,
// scripts/post.py) posts the latest portfolio snapshot. Its own secret,
// PORTFOLIO_INGEST_SECRET. Fails closed: no secret set, nothing gets in.
// POST only on purpose: no route reads this data back out.
export async function POST(request: Request) {
  const secret = process.env.PORTFOLIO_INGEST_SECRET;
  if (!secret || !sameString(request.headers.get("authorization") ?? "", `Bearer ${secret}`)) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json().catch(() => null);
  if (!isPortfolioSnapshot(body)) return Response.json({ ok: false, error: "Not a version 1 portfolio snapshot" }, { status: 400 });
  await savePortfolio(body);
  return Response.json({ ok: true, asOf: body.asOf });
}
