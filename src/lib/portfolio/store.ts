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
