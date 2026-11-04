// End-of-season standings projection. Pure.
//
// Plays out the rest of the season many times. Each remaining week, every
// team's score is drawn from a normal around that week's projected lineup
// (Sleeper's player projections, scored for the league, best legal lineup,
// so byes and bench depth count), with a spread from the lineup's makeup.
//
// Head-to-head leagues: the real schedule, the median game when the league
// plays one, wins then points for as the tiebreak, then the playoff bracket
// for title odds. Guillotine leagues: the lowest live score is chopped each
// week until one team is left.
//
// The scoreboard is not blended into strength on purpose: research for the
// guillotine advisor (src/lib/guillotine/results.ts) found that a current
// projection already carries the information and a trailing average of
// actual scores only adds noise.

export interface TeamWeek {
  mean: number;
  sd: number;
}

export interface FutureWeek {
  week: number;
  /** Head-to-head pairings by roster id. Empty for guillotine. */
  pairs: [number, number][];
  dist: Record<number, TeamWeek>;
}

export interface TeamNow {
  rosterId: number;
  wins: number;
  losses: number;
  ties: number;
  pf: number;
  /** Guillotine: still in. Head-to-head: always true. */
  alive: boolean;
  /** Guillotine: the week this team was chopped, for the finish order. */
  choppedWeek?: number | null;
}

export interface SimInput {
  format: "h2h" | "guillotine";
  teams: TeamNow[];
  weeks: FutureWeek[];
  median: boolean;
  playoffTeams: number;
  sims?: number;
  seed?: number;
}

export interface TeamProjection {
  rosterId: number;
  /** Average over simulations. */
  wins: number;
  losses: number;
  pf: number;
  /** Head-to-head: makes the playoffs. Guillotine: survives to the last week. */
  playoffPct: number;
  /** Head-to-head: the 1 seed. */
  topSeedPct: number;
  /** Wins the title (head-to-head bracket or last team standing). Null when the bracket size is unsupported. */
  champPct: number | null;
  /** Average finishing place, 1 = first. */
  avgFinish: number;
  /** Most likely finishing place. */
  likelyFinish: number;
  /** Guillotine: median week this team is chopped, null when it usually survives or is already out. */
  chopWeek: number | null;
}

export interface SimResult {
  teams: TeamProjection[];
  sims: number;
  weeksLeft: number;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normal(rand: () => number): number {
  const u = Math.max(rand(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

/** Seed order for a standard bracket of size n (power of 2): [1, n, n/2+... ]. Pure. */
export function bracketOrder(n: number): number[] {
  let order = [1];
  while (order.length < n) {
    const size = order.length * 2;
    order = order.flatMap((s) => [s, size + 1 - s]);
  }
  return order;
}

const draw = (d: TeamWeek | undefined, rand: () => number) => (d ? d.mean + d.sd * normal(rand) : 0);

export function simulateSeason(input: SimInput): SimResult {
  const sims = input.sims ?? 5000;
  const rand = mulberry32(input.seed ?? 20261104);
  const ids = input.teams.map((t) => t.rosterId);
  const idx = new Map(ids.map((id, i) => [id, i]));
  const n = ids.length;

  const winsSum = new Float64Array(n);
  const lossSum = new Float64Array(n);
  const pfSum = new Float64Array(n);
  const playoff = new Float64Array(n);
  const top = new Float64Array(n);
  const champ = new Float64Array(n);
  const finishSum = new Float64Array(n);
  const finishCount: number[][] = ids.map(() => new Array(n + 1).fill(0));
  const chopWeeks: number[][] = ids.map(() => []);

  // Playoff strength: the average of a team's last few projected weeks.
  const tail = input.weeks.slice(-3);
  const playoffDist: (TeamWeek | undefined)[] = ids.map((id) => {
    const ds = tail.map((w) => w.dist[id]).filter((d): d is TeamWeek => !!d);
    if (!ds.length) return undefined;
    return { mean: ds.reduce((s, d) => s + d.mean, 0) / ds.length, sd: ds.reduce((s, d) => s + d.sd, 0) / ds.length };
  });
  const P = Math.min(input.playoffTeams, n);
  const bracketSize = P >= 2 ? 2 ** Math.ceil(Math.log2(P)) : 0;
  const bracketOk = input.format === "h2h" && P >= 2 && bracketSize <= 16;
  const order = bracketOk ? bracketOrder(bracketSize) : [];

  const wins = new Float64Array(n);
  const losses = new Float64Array(n);
  const pf = new Float64Array(n);
  const score = new Float64Array(n);

  for (let s = 0; s < sims; s++) {
    input.teams.forEach((t, i) => {
      wins[i] = t.wins + t.ties / 2;
      losses[i] = t.losses + t.ties / 2;
      pf[i] = t.pf;
    });

    if (input.format === "h2h") {
      for (const w of input.weeks) {
        for (let i = 0; i < n; i++) {
          score[i] = draw(w.dist[ids[i]], rand);
          pf[i] += score[i];
        }
        for (const [a, b] of w.pairs) {
          const ia = idx.get(a), ib = idx.get(b);
          if (ia === undefined || ib === undefined) continue;
          if (score[ia] >= score[ib]) { wins[ia]++; losses[ib]++; } else { wins[ib]++; losses[ia]++; }
        }
        if (input.median) {
          const sorted = Array.from(score).sort((x, y) => x - y);
          const med = n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
          for (let i = 0; i < n; i++) if (score[i] > med) wins[i]++; else losses[i]++;
        }
      }
      const rank = ids.map((_, i) => i).sort((a, b) => wins[b] - wins[a] || pf[b] - pf[a]);
      rank.forEach((i, place) => {
        finishSum[i] += place + 1;
        finishCount[i][place + 1]++;
        if (place < P) playoff[i]++;
        if (place === 0) top[i]++;
      });
      if (bracketOk) {
        let alive: (number | null)[] = order.map((seed) => (seed <= P ? rank[seed - 1] : null));
        while (alive.length > 1) {
          const next: (number | null)[] = [];
          for (let k = 0; k < alive.length; k += 2) {
            const a = alive[k], b = alive[k + 1];
            if (a === null || b === null) { next.push(a ?? b); continue; }
            next.push(draw(playoffDist[a], rand) >= draw(playoffDist[b], rand) ? a : b);
          }
          alive = next;
        }
        if (alive[0] !== null) champ[alive[0]]++;
      }
    } else {
      // Guillotine: already-chopped teams hold their places at the bottom.
      const live = new Set(input.teams.filter((t) => t.alive).map((t) => idx.get(t.rosterId)!));
      const outOrder: number[] = []; // chopped this sim, in order
      for (const w of input.weeks) {
        if (live.size <= 1) break;
        let low = -1, lowScore = Infinity;
        for (const i of live) {
          const sc = draw(w.dist[ids[i]], rand);
          pf[i] += sc;
          if (sc < lowScore) { lowScore = sc; low = i; }
        }
        live.delete(low);
        outOrder.push(low);
        chopWeeks[low].push(w.week);
      }
      // Weeks ran out with several alive: rank survivors by points.
      const survivors = [...live].sort((a, b) => pf[b] - pf[a]);
      const goneBefore = input.teams
        .map((t, i) => ({ i, wk: t.choppedWeek ?? 0 }))
        .filter((x) => !input.teams[x.i].alive)
        .sort((a, b) => b.wk - a.wk)
        .map((x) => x.i);
      const finish = [...survivors, ...outOrder.reverse(), ...goneBefore];
      finish.forEach((i, place) => {
        finishSum[i] += place + 1;
        finishCount[i][place + 1]++;
        if (place === 0) champ[i]++;
      });
      for (const i of survivors) playoff[i]++;
    }
    for (let i = 0; i < n; i++) { winsSum[i] += wins[i]; lossSum[i] += losses[i]; pfSum[i] += pf[i]; }
  }

  const teams: TeamProjection[] = ids.map((rosterId, i) => {
    const cw = [...chopWeeks[i]].sort((a, b) => a - b);
    return {
      rosterId,
      wins: winsSum[i] / sims,
      losses: lossSum[i] / sims,
      pf: pfSum[i] / sims,
      playoffPct: playoff[i] / sims,
      topSeedPct: top[i] / sims,
      champPct: input.format === "guillotine" || bracketOk ? champ[i] / sims : null,
      avgFinish: finishSum[i] / sims,
      likelyFinish: finishCount[i].indexOf(Math.max(...finishCount[i])),
      chopWeek: cw.length > sims / 2 ? cw[Math.floor(cw.length / 2)] : null,
    };
  });
  teams.sort((a, b) => a.avgFinish - b.avgFinish);
  return { teams, sims, weeksLeft: input.weeks.length };
}
