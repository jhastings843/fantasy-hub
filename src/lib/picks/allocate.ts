// One allocator for every stake: spreads and totals, the Tuesday card and
// game-day additions. Pure.
//
// Each candidate arrives with the stake its policy wants (already capped at
// MAX_STAKE) and a priority (its estimated edge per unit risked). The
// allocator fits them, in priority order, inside whatever room the protected
// envelope leaves after what has already been issued:
//
//   room = min(WEEKLY_CAP - this sport's issued this week,
//              OUTSTANDING_CAP - everything issued and unsettled - reserved)
//
// and per game, PER_GAME_CAP less what is already on that game. When the
// wanted total does not fit, every stake is scaled down by one factor and
// rounded DOWN to the quarter unit; if that leaves any stake under
// MIN_STAKE, the lowest-priority play is deferred and the rest rescaled,
// until every stake is worth placing. The result can never exceed the room:
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
  /** This sport, this week, already issued (all slots). */
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
  room: number;
  used: number;
}

const floorQ = (x: number) => Math.floor(x * 4 + 1e-9) / 4;

export function allocate(cands: Candidate[], ex: Exposure): Allocation {
  const room = Math.max(
    0,
    Math.min(WEEKLY_CAP - ex.weekly, OUTSTANDING_CAP - ex.outstanding - (ex.reserved ?? 0)),
  );
  const order = cands
    .filter((c) => c.want >= MIN_STAKE)
    .slice()
    .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
  const deferred: { id: string; reason: string }[] = cands
    .filter((c) => c.want < MIN_STAKE)
    .map((c) => ({ id: c.id, reason: "price leaves under a quarter unit" }));

  // Per-game room first: a game already carrying exposure gets less.
  const gameLeft = new Map<string, number>();
  const wants = order.map((c) => {
    const left = gameLeft.get(c.game) ?? PER_GAME_CAP - (ex.perGame.get(c.game) ?? 0);
    const w = Math.min(c.want, MAX_STAKE, Math.max(0, left));
    gameLeft.set(c.game, left - w);
    return { c, w };
  });
  for (const x of wants) if (x.w < MIN_STAKE) deferred.push({ id: x.c.id, reason: "game already at its exposure limit" });
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
    deferred.push({ id: drop.c.id, reason: "weekly budget full" });
    sized = [];
  }
  let used = sized.reduce((t, x) => t + x.s, 0);
  // Belt and braces: never over the room.
  while (used > room + 1e-9 && sized.length) {
    const drop = sized.pop()!;
    used -= drop.s;
    deferred.push({ id: drop.c.id, reason: "weekly budget full" });
  }
  return { stakes: new Map(sized.map((x) => [x.c.id, x.s])), deferred, room, used: Math.round(used * 100) / 100 };
}
