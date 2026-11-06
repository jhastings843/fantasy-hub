import { validToken } from "@/lib/auth/session";

// Who may see /portfolio. The page holds Jack's real balances while the rest of
// Hobby Hub reads stay public, so this fails closed: only a cookie this
// deployment signed opens it. With no HH_SESSION_SECRET set it stays locked,
// except local `next dev` with no secret at all (matching proxy.ts).
export async function canSeePortfolio({
  secret,
  token,
  nodeEnv,
  now = Date.now(),
}: {
  secret: string | undefined;
  token: string | undefined;
  nodeEnv: string | undefined;
  now?: number;
}): Promise<boolean> {
  if (!secret) return nodeEnv === "development";
  return validToken(secret, token, now);
}
