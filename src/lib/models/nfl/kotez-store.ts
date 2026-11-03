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
import { backers, parsePayout, payoutLine, sameWinner, trackingLinks, trackingUrl, type KotezPayout } from "./kotez-payout";
import { etDate } from "@/lib/props/parse";
import { nameKey } from "@/lib/props/grade";
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
  /** What DraftKings paid each winning bettor, from DK Network's tracking post (games graded from 2026-11-03 on). */
  payout?: KotezPayout;
}

/** A DK Network page's HTML, or null when it can't be read. */
async function page(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { cache: "no-store", headers: { "user-agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(10_000) });
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
}

/** Hub titles naming a game, lower-cased. Empty when the page can't be read. */
async function hubTitles(): Promise<string[]> {
  const html = await page(HUB);
  return html ? [...html.matchAll(/King of the End Zone Picks for ([^<"]{5,80})/gi)].map((m) => m[1].toLowerCase()) : [];
}

/** Keep asking DK Network for the payout this long after kickoff (the bonus amount is sometimes posted the next day). */
const PAYOUT_DAYS = 7;

/**
 * The promo's payout for a graded game, from its DK Network tracking post
 * (found on the hub by the game's ET date, else at the address built from it).
 * Null until the post gives a per-bettor amount, or when it names someone who
 * didn't score the longest TD (the wrong post). Also records our crowd share
 * for the winner beside the actual count, to calibrate the estimate later.
 */
async function readPayout(x: KotezSaved, now: Date, hub: Promise<string | null>): Promise<KotezPayout | null> {
  if (!x.result) return null;
  const date = etDate(new Date(x.kickoff));
  const url = trackingLinks((await hub) ?? "").find((l) => l.date === date)?.url ?? trackingUrl(date);
  const html = await page(url);
  if (!html) return null;
  const p = parsePayout(html);
  if (!p.perBettor) return null;
  const winner = x.result.winners.find((w) => !w.dst) ?? x.result.winners[0];
  if (p.winner && !x.result.winners.some((w) => sameWinner(p.winner!, w.name))) return null;
  const out: KotezPayout = { perBettor: p.perBettor, ...(p.pool ? { pool: p.pool } : {}), ...(p.bettors ? { bettors: p.bettors } : {}), source: url, at: now.toISOString() };
  const row = winner ? x.rows.find((r) => nameKey(r.name) === nameKey(winner.name)) : undefined;
  const n = backers(out);
  if (row?.crowd) out.est = { name: row.name, share: row.crowd, ...(n ? { impliedEntrants: Math.round(n / row.crowd) } : {}) };
  return out;
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

/** Grade finished promo games from ESPN's scoring plays, then log DK's payout once its post gives one. */
export async function gradeKotez(season: number, now: Date): Promise<string[]> {
  const out: string[] = [];
  const weeks = ((await redis.smembers(WEEKS(season))) ?? []).map(Number);
  let hub: Promise<string | null> | null = null;
  for (const w of weeks)
    for (let x of Object.values((await redis.hgetall<{ [slug: string]: KotezSaved }>(KEY(season, w))) ?? {})) {
      if (Date.parse(x.kickoff) > now.getTime()) continue;
      if (!x.gradedAt) {
        const res = await fetch(`${SITE}/summary?event=${x.espnId}`, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
        if (!res.ok) continue;
        const sum = (await res.json()) as { header?: { competitions?: { status?: { type?: { completed?: boolean } } }[] }; scoringPlays?: EspnScoringPlay[] };
        if (!sum.header?.competitions?.[0]?.status?.type?.completed) continue;
        const result = longestTd(sum.scoringPlays ?? []);
        x = { ...x, result, gradedAt: now.toISOString() };
        await redis.hset(KEY(season, w), { [x.slug]: x });
        out.push(`KOTEZ graded ${x.game}: ${result ? `${result.winners.map((p) => p.name).join(", ")} ${result.yards} yd` : "no TD"}`);
      }
      if (x.payout || !x.result || now.getTime() - Date.parse(x.kickoff) > PAYOUT_DAYS * 86_400_000) continue;
      hub ??= page(HUB);
      const payout = await readPayout(x, now, hub);
      if (!payout) continue;
      await redis.hset(KEY(season, w), { [x.slug]: { ...x, payout } });
      out.push(`KOTEZ payout ${x.game}: ${payoutLine(payout)}`);
    }
  return out;
}

export async function loadKotez(season: number): Promise<(KotezSaved & { week: number })[]> {
  const weeks = ((await redis.smembers(WEEKS(season)).catch(() => [])) ?? []).map(Number).sort((a, b) => b - a);
  const all = await Promise.all(weeks.map(async (w) => Object.values((await redis.hgetall<{ [slug: string]: KotezSaved }>(KEY(season, w)).catch(() => null)) ?? {}).map((x) => ({ ...x, week: w }))));
  return all.flat();
}
