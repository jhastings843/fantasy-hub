import "server-only";
import { redis } from "@/lib/redis/client";
import { etDate } from "@/lib/props/parse";
import { compactGame, type EspnNbaSummary } from "./box";
import { kingLogLoss, kingsOf, simulateSlate, type KotcBoard, type KotcParams, type KotcPlayer } from "./kotc";
import type { OurStoredProps, SbGame } from "./store";
import KOTC_PARAMS from "./kotc-params.json";
import { live, primeParams } from "@/lib/models/params-store";
import { fetchMostBet, type KotcCrowd } from "./kotc-crowd";

// King of the Court, live. Inside every run of our NBA props model
// (runOurNbaProps), after the boards are saved:
// 1. For each Eastern date on the scoreboard with no game started yet, run the
//    slate from the saved boards' projections and save the night. The copy
//    stops changing at the first tip: that is the board the promo is bet on
//    and the one that gets graded.
// 2. Once every game of a saved night is final, read each box score, find the
//    king(s) and grade the board (the chance we gave him, his rank, log loss).
//
// Redis: kotc:v1:nba:{season}:nights  hash date (YYYY-MM-DD, Eastern) -> KotcNight

const P = live("nba-kotc", KOTC_PARAMS as KotcParams);
const SITE = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba";
const KEY = (s: number) => `kotc:v1:nba:${s}:nights`;

export interface KotcGameInput {
  spread: number | null;
  players: Omit<KotcPlayer, "game">[];
}

export interface KotcNight {
  date: string;
  at: string;
  firstTip: string;
  games: { id: string; away: string; home: string; tip: string; spread: number | null }[];
  /** Games on the scoreboard that night; more than `games.length` means some had no board yet. */
  slateGames: number;
  /** Every scoreboard game that night (missing on nights saved before 2026-10-21 late): grading reads all of them, so a king from a game we had no board for still counts. */
  slateIds?: string[];
  board: KotcBoard;
  /** DK Network's most-bet NBA props at the last save before the first tip (kotc-crowd.ts); tonight's slate only. */
  crowd?: KotcCrowd;
  result?: {
    kings: { id: string; name: string; team: string }[];
    pra: number;
    /** The chance we gave the king(s), his rank on our board (0 when he wasn't on it), and log loss. */
    p: number;
    rank: number;
    logLoss: number;
    /** The player we made likeliest, and his PRA. */
    favorite: { name: string; p: number; pra: number | null };
    gradedAt: string;
  };
}

/** One night from the saved boards of that date's games (pure). */
export function nightOf(date: string, boards: OurStoredProps[], slateGames: number, now: Date, p: KotcParams = P): KotcNight | null {
  const mine = boards.filter((b) => b.kotc && b.kickoff && b.espnId && etDate(new Date(b.kickoff)) === date);
  if (!mine.length) return null;
  const games = mine.map((b) => ({ id: b.espnId!, away: b.away, home: b.home, tip: b.kickoff!, spread: b.kotc!.spread }));
  const players: KotcPlayer[] = mine.flatMap((b) => b.kotc!.players.map((x) => ({ ...x, game: b.espnId! })));
  const board = simulateSlate(
    games.map((g) => ({ id: g.id, home: g.home, away: g.away, homeSpread: g.spread })),
    players,
    p,
  );
  return { date, at: now.toISOString(), firstTip: games.map((g) => g.tip).sort()[0], games, slateGames, board };
}

async function summary(id: string): Promise<EspnNbaSummary> {
  const res = await fetch(`${SITE}/summary?event=${id}`, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`ESPN summary ${id} answered ${res.status}`);
  return (await res.json()) as EspnNbaSummary;
}

/** Save tonight's boards and grade finished nights. Returns one line per thing done. */
export async function runKotc(season: number, now: Date, games: SbGame[], boards: OurStoredProps[]): Promise<string[]> {
  await primeParams();
  const out: string[] = [];
  const nights = (await redis.hgetall<{ [date: string]: KotcNight }>(KEY(season))) ?? {};
  const byDate = new Map<string, SbGame[]>();
  for (const g of games) if (g.tip) byDate.set(etDate(new Date(g.tip)), [...(byDate.get(etDate(new Date(g.tip))) ?? []), g]);

  for (const [date, gs] of byDate) {
    // Frozen once anything on the slate has started.
    if (gs.some((g) => g.state !== "pre" || (g.tip && new Date(g.tip) <= now))) continue;
    const n = nightOf(date, boards, gs.length, now);
    if (!n || !n.board.rows.length) continue;
    // The run can take a while: check the first tip again right before writing.
    // The crowd list only covers today's games; a failed read keeps the last one saved.
    let crowd = nights[date]?.crowd;
    if (date === etDate(now))
      try {
        crowd = await fetchMostBet(now);
      } catch (e) {
        out.push(`${date} crowd: ${e instanceof Error ? e.message : String(e)}`);
      }
    if (gs.some((g) => g.tip && new Date(g.tip) <= new Date())) continue;
    await redis.hset(KEY(season), { [date]: { ...n, slateIds: gs.map((g) => g.id), ...(crowd ? { crowd } : {}) } });
    const top = n.board.rows[0];
    out.push(`${date}: ${n.games.length} of ${gs.length} games, ${n.board.rows.length} players, favorite ${top?.name} ${Math.round((top?.p ?? 0) * 100)}%`);
  }

  for (const n of Object.values(nights)) {
    if (n.result || new Date(n.firstTip) > now) continue;
    try {
      const actual: { id: string; name: string; team: string; pra: number }[] = [];
      let done = true;
      for (const id of n.slateIds ?? n.games.map((g) => g.id)) {
        const s = await summary(id);
        if (!s.header?.competitions?.[0]?.status?.type?.completed) {
          done = false;
          break;
        }
        const box = compactGame(id, s);
        if (!box) throw new Error(`no box score for ${id}`);
        for (const l of box.players) actual.push({ id: l.id, name: l.name, team: l.team, pra: l.pts + l.reb + l.ast });
      }
      if (!done || !actual.length) continue;
      const k = kingsOf(actual);
      const rows = n.board.rows;
      const ranks = k.ids.map((id) => rows.findIndex((r) => r.id === id) + 1).filter((x) => x > 0);
      const fav = rows[0];
      const result: KotcNight["result"] = {
        kings: actual.filter((a) => k.ids.includes(a.id)).map((a) => ({ id: a.id, name: a.name, team: a.team })),
        pra: k.pra,
        p: rows.filter((r) => k.ids.includes(r.id)).reduce((a, r) => a + r.p, 0),
        rank: ranks.length ? Math.min(...ranks) : 0,
        logLoss: kingLogLoss(rows, k.ids),
        favorite: { name: fav?.name ?? "", p: fav?.p ?? 0, pra: actual.find((a) => a.id === fav?.id)?.pra ?? null },
        gradedAt: now.toISOString(),
      };
      await redis.hset(KEY(season), { [n.date]: { ...n, result } });
      out.push(`graded ${n.date}: ${result.kings.map((x) => x.name).join(" and ")} ${k.pra} PRA, we had ${(result.p * 100).toFixed(1)}% (rank ${result.rank || "off the board"})`);
    } catch (e) {
      out.push(`grade ${n.date}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return out;
}

export async function getKotcNights(season: number): Promise<KotcNight[]> {
  await primeParams();
  const h = (await redis.hgetall<{ [date: string]: KotcNight }>(KEY(season))) ?? {};
  return Object.values(h).sort((a, b) => b.date.localeCompare(a.date));
}
