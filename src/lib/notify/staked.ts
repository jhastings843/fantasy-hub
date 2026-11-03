import "server-only";
import { redis } from "@/lib/redis/client";
import { push } from "./pushover";
import { stakedToday } from "@/lib/props/staked";
import { pushable, stakedPush, type StakedBet } from "@/lib/props/staked-core";

// One Pushover push per staked prop or NBA bet, before lock (Jack,
// 2026-11-02). Runs on every pulse (15 minutes): a bet is pushed the first
// time it shows as staked with its game more than 5 minutes off, and
// remembered under notify:v1:staked:{id} so no rerun repeats it. A bet first
// seen inside those 5 minutes is never pushed: too late to place.

const KEEP = 3 * 24 * 3600;
const appUrl = () => process.env.NEXT_PUBLIC_APP_URL ?? "https://fantasy-hub-tan.vercel.app";

export const stakedKey = (id: string) => `notify:v1:staked:${id}`;

/** Pushes the bets not pushed before. Returns how many went. Never throws. */
export async function pushStakedBets(bets: StakedBet[], now: Date): Promise<{ pushed: number; skipped: number }> {
  let pushed = 0;
  let skipped = 0;
  for (const b of bets) {
    if (!pushable(b, now)) {
      skipped++;
      continue;
    }
    try {
      if ((await redis.set(stakedKey(b.id), now.toISOString(), { nx: true, ex: KEEP })) !== "OK") continue;
      if ((await push(stakedPush(b, appUrl()))).pushed) pushed++;
    } catch {
      /* the next bet still gets its chance */
    }
  }
  return { pushed, skipped };
}

/** The pulse job: today's staked bets, each pushed once. */
export async function runStakedPushes(now = new Date()): Promise<string> {
  const { bets, problems } = await stakedToday(now);
  const r = await pushStakedBets(bets, now);
  return `${bets.length} staked today, ${r.pushed} pushed${problems.length ? `; unread: ${problems.join("; ")}` : ""}`;
}
