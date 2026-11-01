import "server-only";
import { redis } from "@/lib/redis/client";
import { push } from "@/lib/notify/pushover";
import { getPoolView, type PoolView } from "./pool-store";

// Pick'em entry watch (Jack, 2026-11-01: "analyze current games and maybe
// notify if something changes after the 1pm slate"). Every pulse re-reads the
// pool entry, which is re-solved from the real scores and picks once a slate
// finishes. When the pick changes on a game that has not kicked off, one phone
// push says what to switch in Sleeper. The first read of a week only seeds.

export type EntryPicks = { [game: string]: string };

const KEY = (week: number) => `picks:v1:pool-watch:w${week}`;

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

export async function runPoolWatch(now = new Date()): Promise<string> {
  const v = (await getPoolView().catch(() => null))?.value ?? null;
  if (!v) return "no open pool games";
  const after = openPicks(v, now);
  if (!Object.keys(after).length) return "every game has started";
  const before = await redis.get<EntryPicks>(KEY(v.week));
  await redis.set(KEY(v.week), after, { ex: 14 * 86_400 });
  if (!before) return `seeded week ${v.week}: ${Object.keys(after).length} open games`;
  const ch = pickChanges(before, after);
  if (!ch.length) return "no change";
  const st = v.standings ? `You have ${v.standings.mine} right, the leader ${v.standings.leader}. ` : "";
  const res = await push({
    title: `Pick'em: switch ${ch.map((c) => `${c.from} to ${c.to}`).join(", ")}`,
    message: `${st}Updated after the latest finals. ${ch.map((c) => `${c.game}: take ${c.to} (was ${c.from})`).join("\n")}\nEntry now ${(v.result.winChance * 100).toFixed(1)}% to win the week. Change it in Sleeper before kickoff.`,
    url: `${process.env.NEXT_PUBLIC_APP_URL ?? "https://fantasy-hub-tan.vercel.app"}/picks`,
    urlTitle: "Pool entry",
  });
  return `${ch.length} change${ch.length === 1 ? "" : "s"}, ${res.pushed ? "pushed" : `not pushed: ${res.reason}`}`;
}
