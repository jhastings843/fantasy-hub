import "server-only";
import { redis } from "@/lib/redis/client";
import type { PortfolioSnapshot } from "./types";

// The Portfolio page's memory: one key, the latest snapshot Jack's Mac posted
// (stocks repo, scripts/post.py). Read only by the locked /portfolio page; no
// route hands it out.
const SNAPSHOT = "portfolio:v1:snapshot";

export async function savePortfolio(s: PortfolioSnapshot) {
  await redis.set(SNAPSHOT, s);
}

export async function getPortfolio(): Promise<PortfolioSnapshot | null> {
  return (await redis.get<PortfolioSnapshot>(SNAPSHOT)) ?? null;
}

// Manual refresh (Jack, 2026-11-06): the Portfolio page's Refresh button sets a
// short-lived flag; Jack's Mac checks it once a minute (stocks repo,
// scripts/refresh_poll.py), runs the price script on the newest Fidelity export
// and posts a new snapshot. The flag expires after 10 minutes so a request made
// while the Mac sleeps doesn't fire hours later.
const REFRESH = "portfolio:v1:refresh";
const REFRESH_TTL_S = 600;

export async function requestRefresh(now = new Date()): Promise<string> {
  const at = now.toISOString();
  await redis.set(REFRESH, at, { ex: REFRESH_TTL_S });
  return at;
}

/** The Mac's poll: returns the pending request time (and clears it), or null. */
export async function claimRefresh(): Promise<string | null> {
  return (await redis.getdel<string>(REFRESH)) ?? null;
}
