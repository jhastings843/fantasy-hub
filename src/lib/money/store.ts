import "server-only";
import { redis } from "@/lib/redis/client";
import { boxStats, type EspnBoxTeam } from "@/lib/props/grade";
import { gradeBet, netUnits, summarize, type BetSummary, type FinalGame, type MoneyBet } from "./bets";
import type { MoneySnapshot } from "./types";
import { getSportsView, type SportsView } from "./sports";

// The Money page's memory. Two keys:
// - money:v1:snapshot  the latest Phil and paper-book snapshot, posted by
//   trade-bot on Jack's Mac after each run (tradebot/money_export.py).
// - money:v1:bets      Jack's own bets, a hash keyed by bet id.
// Bets are graded when the page is read, for games ESPN reports final. A read
// that cannot reach ESPN just shows them pending; nothing is lost.

const SNAPSHOT = "money:v1:snapshot";
const BETS = "money:v1:bets";
const ESPN = { nfl: "football/nfl", cfb: "football/college-football" } as const;

export async function saveSnapshot(s: MoneySnapshot) {
  await redis.set(SNAPSHOT, s);
}
export async function getSnapshot(): Promise<MoneySnapshot | null> {
  return (await redis.get<MoneySnapshot>(SNAPSHOT)) ?? null;
}

export async function saveBet(b: MoneyBet) {
  await redis.hset(BETS, { [b.id]: b });
}
export async function deleteBet(id: string) {
  return redis.hdel(BETS, id);
}
export async function getBets(): Promise<MoneyBet[]> {
  const all = (await redis.hgetall<Record<string, MoneyBet>>(BETS)) ?? {};
  return Object.values(all).sort((a, b) => (b.date + b.placedAt).localeCompare(a.date + a.placedAt));
}

async function json<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return (await res.json()) as T;
}

interface Competitor {
  homeAway?: string;
  score?: string;
  team?: { abbreviation?: string };
  linescores?: { value?: number; displayValue?: string }[];
}
interface Event {
  id: string;
  competitions?: { competitors?: Competitor[]; status?: { type?: { completed?: boolean } } }[];
  status?: { type?: { completed?: boolean } };
}

/** The game a bet is on, final scores and box score included, or null. */
async function findGame(b: MoneyBet): Promise<FinalGame | null> {
  const day = b.date.replaceAll("-", "");
  const board = await json<{ events?: Event[] }>(
    `https://site.api.espn.com/apis/site/v2/sports/${ESPN[b.sport]}/scoreboard?dates=${day}${b.sport === "cfb" ? "&groups=80&limit=400" : ""}`,
  );
  const ev = (board.events ?? []).find((e) => {
    const cs = e.competitions?.[0]?.competitors ?? [];
    const ab = (side: string) => cs.find((c) => c.homeAway === side)?.team?.abbreviation;
    return ab("away") === b.away && ab("home") === b.home;
  });
  if (!ev) return null;
  const completed = !!(ev.status?.type?.completed ?? ev.competitions?.[0]?.status?.type?.completed);
  if (!completed) return { final: false, away: { abbr: b.away, score: 0, h1: null }, home: { abbr: b.home, score: 0, h1: null }, box: null };
  const sum = await json<{
    header?: { competitions?: { competitors?: Competitor[] }[] };
    boxscore?: { players?: EspnBoxTeam[] };
  }>(`https://site.api.espn.com/apis/site/v2/sports/${ESPN[b.sport]}/summary?event=${ev.id}`);
  const cs = sum.header?.competitions?.[0]?.competitors ?? ev.competitions?.[0]?.competitors ?? [];
  const side = (s: string) => {
    const c = cs.find((x) => x.homeAway === s);
    const ls = c?.linescores ?? [];
    const q = ls.map((l) => Number(l.value ?? l.displayValue));
    return {
      abbr: c?.team?.abbreviation ?? "",
      score: Number(c?.score ?? NaN),
      h1: q.length >= 2 && q.slice(0, 2).every(Number.isFinite) ? q[0] + q[1] : null,
    };
  };
  const away = side("away");
  const home = side("home");
  if (!Number.isFinite(away.score) || !Number.isFinite(home.score)) return null;
  return { final: true, away, home, box: sum.boxscore?.players ? boxStats(sum.boxscore.players) : null };
}

/** Grade every pending bet whose game is final. Returns the bets, graded where possible. */
export async function gradePending(bets: MoneyBet[], now = new Date()): Promise<{ bets: MoneyBet[]; problems: string[] }> {
  const problems: string[] = [];
  // ET calendar date; a bet's game can't be final before its own date.
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(now);
  const open = bets.filter((b) => !b.result && b.date <= today);
  const games = new Map<string, Promise<FinalGame | null>>();
  for (const b of open) {
    const key = `${b.sport}|${b.date}|${b.away}@${b.home}`;
    if (!games.has(key)) games.set(key, findGame(b).catch((e) => (problems.push(`${b.away} at ${b.home}: ${e instanceof Error ? e.message : e}`), null)));
    const g = await games.get(key)!;
    if (!g) continue;
    const r = gradeBet(b, g);
    if (!r) continue;
    b.result = { outcome: r.outcome, actual: r.actual, net: netUnits(r.outcome, b.units, b.price), gradedAt: now.toISOString(), by: "espn" };
    await saveBet(b);
  }
  return { bets, problems };
}

export interface MoneyView {
  snapshot: MoneySnapshot | null;
  bets: MoneyBet[];
  summary: BetSummary;
  problems: string[];
  /** Picks and props results for the overview charts; null if they could not be read. */
  sports: SportsView | null;
}

export async function getMoneyView(): Promise<MoneyView> {
  const [snapshot, raw, sports] = await Promise.all([getSnapshot(), getBets(), getSportsView().catch(() => null)]);
  const { bets, problems } = await gradePending(raw);
  return { snapshot, bets, summary: summarize(bets), problems, sports };
}
