import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, validToken } from "@/lib/auth/session";

// Routes that write or spend money refuse callers without Jack's signed cookie
// (security audit, 2026-11-04): survivor saves, the survivor screenshot reader
// (a paid Anthropic call) and the cache refresh. Reads stay open. Fails closed:
// with no HH_SESSION_SECRET set, nothing gets through (local dev excepted).
export async function proxy(req: NextRequest) {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return NextResponse.next();
  if (process.env.NODE_ENV === "development" && !process.env.HH_SESSION_SECRET) return NextResponse.next();
  if (await validToken(process.env.HH_SESSION_SECRET, req.cookies.get(SESSION_COOKIE)?.value)) return NextResponse.next();
  return NextResponse.json({ error: "This device isn't unlocked. Open /unlock on Hobby Hub, enter the passphrase, then try again." }, { status: 401 });
}

export const config = {
  matcher: ["/api/survivor/:path*", "/api/refresh"],
};
