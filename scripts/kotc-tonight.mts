// Tonight's King of the Court board from our props model's saved boards
// (props:v1:ours:nba), for a slate the live page hasn't covered yet. PRA =
// our points + rebounds + assists means; a player needs all three markets.
//
//   npx tsx --tsconfig scripts/tsconfig.json --env-file=.env.local scripts/kotc-tonight.mts [YYYY-MM-DD]
import { readFileSync } from "node:fs";
import { Redis } from "@upstash/redis";
import { simulateSlate, type KotcGame, type KotcParams, type KotcPlayer } from "../src/lib/models/nba/kotc";
import { etDate, nbaSeasonOfDate, nbaWeek } from "../src/lib/props/parse";
import type { OurStoredProps } from "../src/lib/models/nba/store";

const P = JSON.parse(readFileSync("src/lib/models/nba/kotc-params.json", "utf8")) as KotcParams;
const now = new Date();
const day = process.argv[2] ?? etDate(now);
const season = nbaSeasonOfDate(now);
const redis = new Redis({ url: process.env.UPSTASH_REDIS_REST_URL!, token: process.env.UPSTASH_REDIS_REST_TOKEN! });
const wk = nbaWeek(new Date(`${day}T20:00:00-04:00`), season);
const saved = Object.values((await redis.hgetall<{ [id: string]: OurStoredProps }>(`props:v1:ours:nba:${season}:w${wk}`)) ?? {}).filter(
  (g) => g.kickoff && etDate(new Date(g.kickoff)) === day,
);

async function homeSpread(ev: string): Promise<number | null> {
  const r = await fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=${ev}`);
  const s = (await r.json()) as { pickcenter?: { provider?: { name?: string }; spread?: number; homeTeamOdds?: { favorite?: boolean } }[] };
  const pc = s.pickcenter?.find((p) => p.provider?.name === "DraftKings") ?? s.pickcenter?.[0];
  if (typeof pc?.spread !== "number") return null;
  return pc.homeTeamOdds?.favorite === false ? Math.abs(pc.spread) : -Math.abs(pc.spread);
}

const games: KotcGame[] = [];
const players: KotcPlayer[] = [];
for (const g of saved) {
  games.push({ id: g.espnId!, home: g.home, away: g.away, homeSpread: await homeSpread(g.espnId!) });
  const by = new Map<string, { team: string; pts?: number; reb?: number; ast?: number; min?: number }>();
  for (const m of g.game.markets) {
    if (m.stat !== "pts" && m.stat !== "reb" && m.stat !== "ast") continue;
    const e = by.get(m.player) ?? { team: m.team };
    e[m.stat] = m.model ?? undefined;
    e.min = g.extra[m.id]?.min ?? e.min;
    by.set(m.player, e);
  }
  for (const [name, e] of by)
    if (e.pts !== undefined && e.reb !== undefined && e.ast !== undefined)
      players.push({ id: name, name, team: e.team, game: g.espnId!, min: e.min ?? 0, pra: e.pts + e.reb + e.ast, starter: (e.min ?? 0) >= 26 });
}
console.log(`${day}: ${games.length} games saved, ${players.length} players with PRA`);
for (const g of games) console.log(`  ${g.away} @ ${g.home}  home spread ${g.homeSpread ?? "n/a"}`);
const b = simulateSlate(games, players, P);
console.log(`winning PRA: 10% ${b.winning.p10}, median ${b.winning.p50}, 90% ${b.winning.p90}`);
console.log("player                     team  min   PRA   win%  top3%  p90");
for (const r of b.rows.slice(0, 25))
  console.log(`${r.name.padEnd(26)} ${r.team.padEnd(5)} ${r.min.toFixed(1).padStart(4)} ${r.pra.toFixed(1).padStart(5)} ${(r.p * 100).toFixed(1).padStart(6)} ${(r.top3 * 100).toFixed(1).padStart(6)} ${String(r.p90).padStart(4)}`);
