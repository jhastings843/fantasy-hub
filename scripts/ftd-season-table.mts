// This season's First TD record per rule, before and after voids (ftd-void.ts):
// reads our graded boards from Redis (read only), reads each game's ESPN
// game-day roster and box score as the grading run does, and grades with
// bestBets, once without the participation record and once with it.
//
//   npx tsx --tsconfig scripts/tsconfig.json --env-file=.env.local scripts/ftd-season-table.mts [season]
import { Redis } from "@upstash/redis";
import { bestBets, ftdEdge } from "../src/lib/models/nfl/ftd-price";
import { boxPlayed, rosterPlayed, type Played } from "../src/lib/models/nfl/ftd-void";
import { samTeam } from "../src/lib/firsttd/grade";
import type { EspnBoxTeam } from "../src/lib/props/grade";
import type { OurFtdStored } from "../src/lib/models/nfl/ftd-store";

const season = Number(process.argv[2] ?? 2026);
const redis = new Redis({ url: process.env.UPSTASH_REDIS_REST_URL!, token: process.env.UPSTASH_REDIS_REST_TOKEN! });
const SITE = "https://site.api.espn.com/apis/site/v2/sports/football/nfl";
const CORE = (ev: string) => `https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/events/${ev}/competitions/${ev}/competitors`;
const get = async <T,>(u: string) => (await (await fetch(u, { signal: AbortSignal.timeout(15_000) })).json()) as T;

const graded: (OurFtdStored & { result: NonNullable<OurFtdStored["result"]> })[] = [];
for (const w of ((await redis.smembers(`ftd:v1:ours:${season}:weeks`)) as string[]).map(Number).sort((a, b) => a - b))
  for (const g of Object.values((await redis.hgetall<{ [slug: string]: OurFtdStored }>(`ftd:v1:ours:${season}:w${w}`)) ?? {})) if (g.result) graded.push(g as never);

const withPlayed = [];
for (const g of graded) {
  let played: Played | undefined = g.played;
  if (!played) {
    played = {};
    const add = (t: string, n: string[]) => (played![t] = [...new Set([...(played![t] ?? []), ...n])]);
    for (const c of (await get<{ items?: { id: string; homeAway: string }[] }>(CORE(g.espnId))).items ?? [])
      add(c.homeAway === "home" ? g.game.home : g.game.away, rosterPlayed((await get<{ entries?: { displayName?: string; didNotPlay?: boolean }[] }>(`${CORE(g.espnId)}/${c.id}/roster`)).entries ?? []));
    for (const t of (await get<{ boxscore?: { players?: EspnBoxTeam[] } }>(`${SITE}/summary?event=${g.espnId}`)).boxscore?.players ?? []) if (t.team?.abbreviation) add(samTeam(t.team.abbreviation), boxPlayed(t));
  }
  withPlayed.push({ ...g, played });
}
const before = graded.map((g) => ({ ...g, played: undefined }));
const rec = (bs: ReturnType<typeof bestBets>) => {
  const w = bs.filter((b) => b.win).length;
  const u = bs.reduce((a, b) => a + b.net, 0);
  return `${w}-${bs.length - w}, ${u >= 0 ? "+" : ""}${u.toFixed(1)}u`;
};
console.log(`${graded.length} graded games, season ${season}; ${withPlayed.filter((g) => Object.keys(g.played ?? {}).length).length} with a participation record`);
for (const [label, keep] of [
  ["any edge (ours > best price)", (p: { p: number }, c: number) => p.p > c],
  ["ftdEdge (price 6%+, ours 2+ pts above)", (p: { p: number }, c: number) => ftdEdge(p.p, c)],
  ["every priced player", () => true],
] as const) {
  const a = bestBets(before, keep);
  const b = bestBets(withPlayed, keep);
  console.log(`${label}: before ${rec(a)}; after voids ${rec(b)} (${a.length - b.length} void)`);
}
