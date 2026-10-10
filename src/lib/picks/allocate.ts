// One allocator for every stake: spreads and totals, the Tuesday card and
// game-day additions. Pure.
//
// Each candidate arrives with the stake its policy wants (already capped at
// MAX_STAKE) and a priority (its estimated edge per unit risked). The
// allocator fits them, in priority order, inside whatever room the protected
// envelope leaves after what has already been issued:
//
//   room = min(WEEKLY_CAP - both sports' issued this week - reserved,
//              OUTSTANDING_CAP - everything issued and unsettled - reserved)
//
// `reserved` is the other sport's stakes in the same send, not yet issued, so
// it counts against both caps: on 2026-10-10 the weekly side ignored it, and a
// week with settled bets (weekly above outstanding) let the two cards in one
// send together pass 30u.
//
// and per game, PER_GAME_CAP less what is already on that game. When the
// wanted total does not fit, every stake is scaled down by one factor and
// rounded DOWN to the quarter unit; if that leaves any stake under
// MIN_STAKE, the lowest-priority play is deferred and the rest rescaled,
// until every stake is worth placing. Room left over after rounding goes to
// the best dropped plays at MIN_STAKE. The result can never exceed the room:
// the cap holds even with 61 qualifying games, and the best of them are bet.

import { MAX_STAKE, MIN_STAKE, OUTSTANDING_CAP, PER_GAME_CAP, WEEKLY_CAP } from "./limits";

export interface Candidate {
  id: string;
  /** Game key: bets on one game share PER_GAME_CAP. */
  game: string;
  /** Units the policy wants to risk, before limits. */
  want: number;
  /** Higher goes first: estimated edge per unit risked. */
  priority: number;
}

export interface Exposure {
  /** Both sports, this calendar week, already issued (all slots). */
  weekly: number;
  /** Both sports, issued and not yet settled. */
  outstanding: number;
  /** Units already issued per game key. */
  perGame: Map<string, number>;
  /** Units another part of the same send has already claimed (the other sport's card). */
  reserved?: number;
}

export interface Allocation {
  stakes: Map<string, number>;
  /** Wanted a bet but did not get one, and why. */
  deferred: { id: string; reason: string }[];
  /** Got a bet smaller than it wanted, and which limit cut it. */
  reduced: { id: string; want: number; stake: number; reason: string }[];
  room: number;
  used: number;
}

const floorQ = (x: number) => Math.floor(x * 4 + 1e-9) / 4;

export function allocate(cands: Candidate[], ex: Exposure): Allocation {
  const reserved = ex.reserved ?? 0;
  const weeklyRoom = WEEKLY_CAP - ex.weekly - reserved;
  const openRoom = OUTSTANDING_CAP - ex.outstanding - reserved;
  const room = Math.max(0, Math.min(weeklyRoom, openRoom));
  // Named for whichever cap binds, so a card can say which one it hit.
  const full = weeklyRoom <= openRoom
    ? `this week's ${WEEKLY_CAP}u budget (both sports) is used by higher-edge bets`
    : `the ${OUTSTANDING_CAP}u limit on open bets (both sports) is used by higher-edge bets`;
  const order = cands
    .filter((c) => c.want >= MIN_STAKE)
    .slice()
    .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
  const deferred: { id: string; reason: string }[] = cands
    .filter((c) => c.want < MIN_STAKE)
    .map((c) => ({ id: c.id, reason: "sizes under the 1u minimum" }));

  // Per-game room first: a game already carrying exposure gets less.
  const gameLeft = new Map<string, number>();
  const wants = order.map((c) => {
    const left = gameLeft.get(c.game) ?? PER_GAME_CAP - (ex.perGame.get(c.game) ?? 0);
    const w = Math.min(c.want, MAX_STAKE, Math.max(0, left));
    gameLeft.set(c.game, left - w);
    return { c, w };
  });
  const gameFull = `this game is at its ${PER_GAME_CAP}u limit`;
  for (const x of wants) if (x.w < MIN_STAKE) deferred.push({ id: x.c.id, reason: gameFull });
  const live = wants.filter((x) => x.w >= MIN_STAKE);

  // Scale everyone by one factor; if that puts any stake under a quarter
  // unit, drop the lowest-priority play and rescale, until every remaining
  // stake is worth placing. Rounding is down, so the total never exceeds room.
  const pool = live.slice();
  let sized: { c: Candidate; w: number; s: number }[] = [];
  while (pool.length) {
    const total = pool.reduce((t, x) => t + x.w, 0);
    const k = total > room ? room / total : 1;
    sized = pool.map((x) => ({ ...x, s: k < 1 ? floorQ(x.w * k) : x.w }));
    if (sized.every((x) => x.s >= MIN_STAKE)) break;
    const drop = pool.pop()!;
    deferred.push({ id: drop.c.id, reason: full });
    sized = [];
  }
  let used = sized.reduce((t, x) => t + x.s, 0);
  // Belt and braces: never over the room.
  while (used > room + 1e-9 && sized.length) {
    const drop = sized.pop()!;
    used -= drop.s;
    deferred.push({ id: drop.c.id, reason: full });
  }
  // Scaling rounds down and drops whole plays, so room can be left over
  // while a play that only wanted the minimum sits out. Give each dropped
  // play the minimum, best first, while the room (and its game) still fit it.
  const stakes = new Map(sized.map((x) => [x.c.id, x.s]));
  for (const x of live.filter((x) => !stakes.has(x.c.id))) {
    if (room - used < MIN_STAKE - 1e-9) break;
    stakes.set(x.c.id, MIN_STAKE);
    used += MIN_STAKE;
    deferred.splice(deferred.findIndex((d) => d.id === x.c.id), 1);
  }
  const reduced = live.flatMap((x) => {
    const stake = stakes.get(x.c.id);
    if (stake === undefined || stake >= x.c.want) return [];
    // The game's own limit if that alone cut it; otherwise the shared room did.
    return [{ id: x.c.id, want: x.c.want, stake, reason: stake === x.w ? gameFull : full }];
  });
  return { stakes, deferred, reduced, room, used: Math.round(used * 100) / 100 };
}
