import "server-only";
import { redis } from "@/lib/redis/client";
import { type DecisionRecord, latestDecisions } from "./learning/replay";

// What each 9am game-day run decided over (learning/replay.ts). Every
// attempt is its own field ("<sendKey>|<league>|<at>"), written just before
// the send; the replay uses the latest attempt per send and sport. A send
// that failed and is retried from its claimed intent never composes again,
// so its decision stays the latest; a send the provider refused outright is
// decided again, and that later decision wins. A slow write that lands late
// can't overwrite a newer one.
//
// Each run that reaches its decision also writes a day marker
// ("<sendKey>|day"), even with no sport loaded, so a morning with no record
// at all is a detectable gap rather than a silent one. Started 2026-10-12:
// sends before then have no decision, so the sizing replay starts after them.

const KEY = (season: number) => `picks:v2:${season}:decisions`;

export async function saveDecisions(ds: DecisionRecord[], day: { season: number; sendKey: string; at: string }): Promise<void> {
  await redis.hset(KEY(day.season), {
    ...Object.fromEntries(ds.map((d) => [`${d.sendKey}|${d.league}|${d.at}`, JSON.stringify(d)])),
    [`${day.sendKey}|day`]: day.at,
  });
}

/** The latest decision per send and sport, and the send keys that reached a decision (day markers). */
export async function loadDecisions(season: number): Promise<{ decisions: DecisionRecord[]; days: string[] }> {
  try {
    const all = ((await redis.hgetall<Record<string, unknown>>(KEY(season))) ?? {}) as Record<string, unknown>;
    const days = Object.keys(all).filter((f) => f.endsWith("|day")).map((f) => f.slice(0, -"|day".length));
    const decisions = Object.entries(all)
      .filter(([f]) => !f.endsWith("|day"))
      .map(([, x]) => (typeof x === "string" ? (JSON.parse(x) as DecisionRecord) : (x as DecisionRecord)));
    return { decisions: latestDecisions(decisions), days };
  } catch {
    return { decisions: [], days: [] };
  }
}
