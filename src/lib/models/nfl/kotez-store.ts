import "server-only";
// King of the End Zone, tracked on the promo game only (Jack, 2026-11-02:
// "if it's one just do the one"). DraftKings runs it on one game a week, its
// pick: the 2026 opener, a Thursday in Week 2, Mondays since. Which game:
// DK Network's King Of hub names it ("King of the End Zone Picks for Bears vs.
// Seahawks Monday Night Football Game"); if it names none of this week's games,
// the week's only Monday game. Our board is re-saved on each run until
// kickoff, then frozen, and graded from ESPN's scoring plays once final.
//
// Redis: kotez:v1:{season}:w{week}  hash slug -> KotezSaved
import { redis } from "@/lib/redis/client";
import type { EspnScoringPlay } from "@/lib/firsttd/grade";
import { kotezGame, longestTd, pickPromo, type KotezCandidate, type KotezResult, type KotezRow } from "./kotez";
import type { PromoSource } from "./kotez";
import ATTD_PARAMS from "./attd-params.json";

const HUB = "https://dknetwork.draftkings.com/draftkings-king-of/";
const SITE = "https://site.api.espn.com/apis/site/v2/sports/football/nfl";
const KEY = (s: number, w: number) => `kotez:v1:${s}:w${w}`;
const WEEKS = (s: number) => `kotez:v1:${s}:weeks`;

export interface KotezSaved {
  slug: string;
  game: string;
  kickoff: string;
  espnId: string;
  /** How we knew it was the promo game. */
  source: PromoSource;
  savedAt: string;
  rows: KotezRow[];
  noTd: number;
  result?: KotezResult | null;
  gradedAt?: string;
}

/** Hub titles naming a game, lower-cased. Empty when the page can't be read. */
async function hubTitles(): Promise<string[]> {
  try {
    const res = await fetch(HUB, { cache: "no-store", headers: { "user-agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return [];
    return [...(await res.text()).matchAll(/King of the End Zone Picks for ([^<"]{5,80})/gi)].map((m) => m[1].toLowerCase());
  } catch {
    return [];
  }
}

/** Save (or refresh) the promo game's board before kickoff. Returns what it did, for the run report. */
export async function saveKotez(season: number, week: number, games: KotezCandidate[], now: Date): Promise<string> {
  const saved = (await redis.hgetall<{ [slug: string]: KotezSaved }>(KEY(season, week))) ?? {};
  const frozen = Object.values(saved).find((x) => Date.parse(x.kickoff) <= now.getTime());
  if (frozen) return `KOTEZ frozen: ${frozen.game}`;
  const promo = pickPromo(games, await hubTitles());
  if (!promo) return "KOTEZ: no promo game found";
  const { g, source } = promo;
  if (Date.parse(g.kickoff) <= now.getTime()) return "KOTEZ: promo game already started";
  const k = kotezGame(g.rows, ATTD_PARAMS.other);
  const rec: KotezSaved = { slug: g.slug, game: `${g.away} at ${g.home}`, kickoff: g.kickoff, espnId: g.espnId, source, savedAt: now.toISOString(), rows: k.rows, noTd: k.noTd };
  // One promo game a week: drop any other game saved earlier this week (the hub named a different one).
  for (const s of Object.keys(saved)) if (s !== g.slug) await redis.hdel(KEY(season, week), s);
  await redis.hset(KEY(season, week), { [g.slug]: rec });
  await redis.sadd(WEEKS(season), String(week));
  return `KOTEZ saved ${rec.game} (${source})`;
}

/** Grade finished promo games from ESPN's scoring plays. */
export async function gradeKotez(season: number, now: Date): Promise<string[]> {
  const out: string[] = [];
  const weeks = ((await redis.smembers(WEEKS(season))) ?? []).map(Number);
  for (const w of weeks)
    for (const x of Object.values((await redis.hgetall<{ [slug: string]: KotezSaved }>(KEY(season, w))) ?? {})) {
      if (x.gradedAt || Date.parse(x.kickoff) > now.getTime()) continue;
      const res = await fetch(`${SITE}/summary?event=${x.espnId}`, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
      if (!res.ok) continue;
      const sum = (await res.json()) as { header?: { competitions?: { status?: { type?: { completed?: boolean } } }[] }; scoringPlays?: EspnScoringPlay[] };
      if (!sum.header?.competitions?.[0]?.status?.type?.completed) continue;
      const result = longestTd(sum.scoringPlays ?? []);
      await redis.hset(KEY(season, w), { [x.slug]: { ...x, result, gradedAt: now.toISOString() } });
      out.push(`KOTEZ graded ${x.game}: ${result ? `${result.winners.map((p) => p.name).join(", ")} ${result.yards} yd` : "no TD"}`);
    }
  return out;
}

export async function loadKotez(season: number): Promise<(KotezSaved & { week: number })[]> {
  const weeks = ((await redis.smembers(WEEKS(season)).catch(() => [])) ?? []).map(Number).sort((a, b) => b - a);
  const all = await Promise.all(weeks.map(async (w) => Object.values((await redis.hgetall<{ [slug: string]: KotezSaved }>(KEY(season, w)).catch(() => null)) ?? {}).map((x) => ({ ...x, week: w }))));
  return all.flat();
}
