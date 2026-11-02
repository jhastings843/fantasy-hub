import "server-only";
import { redis } from "@/lib/redis/client";
import { push } from "@/lib/notify/pushover";

// Sam's college basketball page (samthemodelman.smmodel.workers.dev/cbb/) read
// "CBB coming soon" on 2026-11-02. The pulse checks it (free, one request) and
// pushes once the day it shows anything else, so his number can be added
// beside ours and tracked like NBA. Stops checking after the alert.
export const SAM_CBB = "https://samthemodelman.smmodel.workers.dev/cbb/";
const DONE = "models:v1:cbb:sam-watch:alerted";
const LAST = "models:v1:cbb:sam-watch:checked";

/** True when the page holds more than the placeholder. Pure. */
export function samCbbPosted(html: string): boolean {
  const text = html.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " ");
  return !/coming soon/i.test(text);
}

export async function runSamCbbWatch(now = new Date()): Promise<string> {
  if (await redis.get(DONE)) return "already alerted";
  // Once an hour is plenty.
  if ((await redis.set(LAST, now.toISOString(), { nx: true, ex: 3600 })) !== "OK") return "checked this hour";
  const r = await fetch(SAM_CBB, { cache: "no-store", signal: AbortSignal.timeout(8_000) });
  if (!r.ok) return `Sam CBB answered ${r.status}`;
  if (!samCbbPosted(await r.text())) return "still coming soon";
  const res = await push({
    title: "Sam posted college basketball",
    message: "His CBB page is up. Ask Claude to add his number beside ours on the CBB board and track it like NBA.",
    url: SAM_CBB,
    urlTitle: "Sam's CBB page",
  });
  if (res.pushed) await redis.set(DONE, now.toISOString());
  return res.pushed ? "posted: alert pushed" : `posted, push failed: ${res.reason}`;
}
