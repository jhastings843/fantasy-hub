import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { canSeePortfolio } from "@/lib/portfolio/lock";
import { requestRefresh } from "@/lib/portfolio/store";

export const dynamic = "force-dynamic";

// POST /api/portfolio/refresh: the Portfolio page's Refresh button. Same lock as
// the page itself (signed hh_session cookie, fails closed). It only sets a flag;
// Jack's Mac picks it up within a minute and posts a fresh snapshot.
export async function POST() {
  const open = await canSeePortfolio({
    secret: process.env.HH_SESSION_SECRET,
    token: (await cookies()).get(SESSION_COOKIE)?.value,
    nodeEnv: process.env.NODE_ENV,
  });
  if (!open) return Response.json({ ok: false, error: "This device isn't unlocked." }, { status: 401 });
  const requestedAt = await requestRefresh();
  return Response.json({ ok: true, requestedAt });
}
