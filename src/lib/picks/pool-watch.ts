import "server-only";
import { redis } from "@/lib/redis/client";
import { push } from "@/lib/notify/pushover";
import { getPoolView, type PoolView } from "./pool-store";

// Pick'em entry push. Was: one push every time a pick changed mid-slate
// (2026-11-01). Now (Jack, 2026-11-04): one push a week, Sunday at 11:00
// Eastern, with the whole entry for the games still to kick off and which
// picks moved since the entry was first read that week. Every pulse still
// seeds the week's first read so the Sunday push can show what moved.

export type EntryPicks = { [game: string]: string };

const SEED = (week: number) => `picks:v1:pool-watch:w${week}`;
const SENT = (week: number) => `picks:v1:pool-watch:sent:w${week}`;

/** The entry's team for every game still to kick off. Pure. */
export function openPicks(v: Pick<PoolView, "games">, now: Date): EntryPicks {
  const out: EntryPicks = {};
  for (const g of v.games) if (!g.kickoff || Date.parse(g.kickoff) > now.getTime()) out[g.key] = g.pick === "home" ? g.home : g.away;
  return out;
}

/** Games still open in both reads whose pick changed. Pure. */
export function pickChanges(before: EntryPicks, after: EntryPicks): { game: string; from: string; to: string }[] {
  return Object.entries(after)
    .filter(([g, t]) => before[g] !== undefined && before[g] !== t)
    .map(([game, to]) => ({ game, from: before[game], to }));
}

/** True from Sunday 11:00 to 12:59 Eastern: the push window, before the 1pm kickoffs. Pure. */
export function inSundayWindow(now: Date): boolean {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", hourCycle: "h23" }).formatToParts(now).map((x) => [x.type, x.value]),
  );
  const h = Number(p.hour);
  return p.weekday === "Sun" && h >= 11 && h < 13;
}

export async function runPoolWatch(now = new Date()): Promise<string> {
  const v = (await getPoolView().catch(() => null))?.value ?? null;
  if (!v) return "no open pool games";
  const after = openPicks(v, now);
  if (!Object.keys(after).length) return "every game has started";
  const seed = await redis.get<EntryPicks>(SEED(v.week));
  if (!seed) await redis.set(SEED(v.week), after, { ex: 14 * 86_400 });
  if (!inSundayWindow(now)) return seed ? "waiting for Sunday 11:00" : `seeded week ${v.week}: ${Object.keys(after).length} open games`;
  // One push per week, even with several pulses inside the window.
  const claimed = await redis.set(SENT(v.week), now.toISOString(), { nx: true, ex: 14 * 86_400 });
  if (claimed !== "OK") return "Sunday push already sent";
  const moved = new Map(pickChanges(seed ?? {}, after).map((c) => [c.game, c.from]));
  const lines = Object.entries(after).map(([game, team]) => `${game}: ${team}${moved.has(game) ? ` (was ${moved.get(game)})` : ""}`);
  const st = v.standings ? `You have ${v.standings.mine} right, the leader ${v.standings.leader}.\n` : "";
  const res = await push({
    title: `Pick'em week ${v.week}: ${moved.size ? `${moved.size} pick${moved.size === 1 ? "" : "s"} changed` : "entry set, no changes"}`,
    message: `${st}${lines.join("\n")}\nEntry ${(v.result.winChance * 100).toFixed(1)}% to win the week. Change it in Sleeper before kickoff.`,
    url: `${process.env.NEXT_PUBLIC_APP_URL ?? "https://fantasy-hub-tan.vercel.app"}/picks`,
    urlTitle: "Pool entry",
  });
  if (!res.pushed) await redis.del(SENT(v.week)); // let the next pulse in the window retry
  return `Sunday push: ${lines.length} open games, ${moved.size} changed, ${res.pushed ? "pushed" : `not pushed: ${res.reason}`}`;
}
