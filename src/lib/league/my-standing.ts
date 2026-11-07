import type { SleeperRoster } from "@/lib/sleeper/types";

// My line on the Fantasy league list (UX pass, 2026-11-06): record and place.
// Same order as the league page's Standings table: wins, then ties, then
// points for. Guillotine leagues have no head-to-head record (Sleeper leaves
// 0-0), so they only say alive or chopped; a chopped roster is emptied.

export type MyStanding =
  | { kind: "h2h"; w: number; l: number; t: number; rank: number; of: number }
  | { kind: "guillotine"; alive: boolean; aliveCount: number; of: number };

const pf = (r: SleeperRoster) => (r.settings?.fpts ?? 0) + (r.settings?.fpts_decimal ?? 0) / 100;

export function myStanding(rosters: SleeperRoster[], myUserId: string, guillotine: boolean): MyStanding | null {
  const mine = rosters.find((r) => r.owner_id === myUserId);
  if (!mine) return null;
  if (guillotine) {
    const alive = (r: SleeperRoster) => (r.players ?? []).length > 0;
    return { kind: "guillotine", alive: alive(mine), aliveCount: rosters.filter(alive).length, of: rosters.length };
  }
  const order = [...rosters].sort((a, b) => {
    const dw = (b.settings?.wins ?? 0) - (a.settings?.wins ?? 0);
    if (dw) return dw;
    const dt = (b.settings?.ties ?? 0) - (a.settings?.ties ?? 0);
    if (dt) return dt;
    return pf(b) - pf(a);
  });
  const s = mine.settings ?? {};
  return { kind: "h2h", w: s.wins ?? 0, l: s.losses ?? 0, t: s.ties ?? 0, rank: order.indexOf(mine) + 1, of: rosters.length };
}

const ORD = (n: number) => (n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th");

/** "6-2, 1st of 12" or "Alive, 11 of 16 left" or "Chopped". */
export function standingText(s: MyStanding): string {
  if (s.kind === "guillotine") return s.alive ? `Alive, ${s.aliveCount} of ${s.of} left` : "Chopped";
  return `${s.w}-${s.l}${s.t ? `-${s.t}` : ""}, ${s.rank}${ORD(s.rank)} of ${s.of}`;
}
