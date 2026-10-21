// Weekly straight-up pick'em pool: the entry most likely to finish FIRST. Pure.
//
// The confidence list maximizes expected correct picks. A pool pays the top
// score, and most entries pick mostly favorites, so an all-favorites entry
// usually ties a crowd or loses with it. This searches for the entry with the
// best chance to win the week outright (or win the tiebreaker), against a
// field that picks like the pool does.
//
// Model: each game's winner is drawn from the market's no-vig win
// probability. Each opponent picks each game independently, home with the
// field's pick share (real shares when known, otherwise an estimate).
// Given the outcomes, one opponent's score has an exact distribution
// (a Poisson binomial, by dynamic programming), so the chance our score S
// is the best of N entries, splitting ties evenly as a tiebreaker would on
// average, is ( F(S)^N - F(S-1)^N ) / ( N * f(S) ), with F the opponent
// score CDF and f its mass. Each simulated week costs one DP; every
// candidate entry then costs only a lookup, so the search is cheap.
//
// Search: start from every market favorite, then flip one game at a time to
// the underdog while that raises the win chance, up to MAX_FLIPS. Common
// random numbers make the comparisons stable.

export interface PoolGame {
  key: string;
  home: string;
  away: string;
  /** Market no-vig chance the home team wins. */
  pHome: number;
  /** Share of the field picking the home team, 0-1. */
  publicHome: number;
  kickoff?: string;
}

export interface PoolResult {
  /** Our entry: "home" | "away" per game, in input order. */
  picks: ("home" | "away")[];
  winChance: number;
  /** The all-favorites entry's chance, for comparison. */
  chalkChance: number;
  /** The underdogs the entry takes, and what each costs and buys. */
  upsets: { key: string; team: string; pWin: number; publicOn: number }[];
  expectedCorrect: number;
  chalkExpectedCorrect: number;
  trials: number;
  entrants: number;
}

export const MAX_FLIPS = 4;

/** A small fast seeded RNG (mulberry32), so a page render is reproducible. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Chance that S is the top score of N entries, ties split evenly. */
function winShare(cdf: Float64Array, S: number, N: number): number {
  const F = cdf[S];
  const Fm = S > 0 ? cdf[S - 1] : 0;
  const f = F - Fm;
  if (N <= 1) return 1;
  if (f <= 1e-15) return Math.pow(F, N - 1); // no opponent can land exactly on S
  return (Math.pow(F, N) - Math.pow(Fm, N)) / (N * f);
}

export function optimizePool(games: PoolGame[], entrants: number, opts: { trials?: number; seed?: number } = {}): PoolResult {
  const trials = opts.trials ?? 20000;
  const G = games.length;
  const N = Math.max(1, Math.round(entrants));
  const rand = rng(opts.seed ?? 20261009);
  // Per trial: who won each game, and the opponent score CDF.
  const homeWon = new Uint8Array(trials * G);
  const cdfs: Float64Array[] = new Array(trials);
  const pmf = new Float64Array(G + 1);
  for (let t = 0; t < trials; t++) {
    pmf.fill(0);
    pmf[0] = 1;
    for (let g = 0; g < G; g++) {
      const hw = rand() < games[g].pHome ? 1 : 0;
      homeWon[t * G + g] = hw;
      const q = hw ? games[g].publicHome : 1 - games[g].publicHome; // opponent is right
      for (let k = g + 1; k >= 1; k--) pmf[k] = pmf[k] * (1 - q) + pmf[k - 1] * q;
      pmf[0] *= 1 - q;
    }
    const cdf = new Float64Array(G + 1);
    let run = 0;
    for (let k = 0; k <= G; k++) {
      run += pmf[k];
      cdf[k] = Math.min(1, run);
    }
    cdfs[t] = cdf;
  }
  const evalEntry = (picks: Uint8Array /* 1 = home */) => {
    let sum = 0;
    for (let t = 0; t < trials; t++) {
      let S = 0;
      const o = t * G;
      for (let g = 0; g < G; g++) if (picks[g] === homeWon[o + g]) S++;
      sum += winShare(cdfs[t], S, N);
    }
    return sum / trials;
  };
  const chalk = new Uint8Array(G);
  for (let g = 0; g < G; g++) chalk[g] = games[g].pHome >= 0.5 ? 1 : 0;
  const chalkChance = evalEntry(chalk);
  const cur = chalk.slice();
  let best = chalkChance;
  for (let flips = 0; flips < MAX_FLIPS; flips++) {
    let bestG = -1;
    let bestV = best;
    for (let g = 0; g < G; g++) {
      if (cur[g] !== chalk[g]) continue;
      cur[g] ^= 1;
      const v = evalEntry(cur);
      cur[g] ^= 1;
      if (v > bestV + 1e-4) {
        bestV = v;
        bestG = g;
      }
    }
    if (bestG < 0) break;
    cur[bestG] ^= 1;
    best = bestV;
  }
  const picks = Array.from(cur, (x) => (x ? "home" : "away") as "home" | "away");
  const exp = (p: Uint8Array) => games.reduce((t, gm, g) => t + (p[g] ? gm.pHome : 1 - gm.pHome), 0);
  return {
    picks,
    winChance: best,
    chalkChance,
    upsets: games.flatMap((gm, g) =>
      cur[g] !== chalk[g]
        ? [{ key: gm.key, team: cur[g] ? gm.home : gm.away, pWin: cur[g] ? gm.pHome : 1 - gm.pHome, publicOn: cur[g] ? gm.publicHome : 1 - gm.publicHome }]
        : [],
    ),
    expectedCorrect: Math.round(exp(cur) * 100) / 100,
    chalkExpectedCorrect: Math.round(exp(chalk) * 100) / 100,
    trials,
    entrants: N,
  };
}

/** A game still to be decided this week. `mine` set = Jack's pick is locked (the game has started). */
export interface LiveGame extends PoolGame {
  locked?: boolean;
  /** Jack's locked pick on a started game; null if he didn't pick it. */
  mine?: "home" | "away" | null;
}

/** Another entry: correct picks so far, and its picks on the games still to be decided (null = not picked yet). */
export interface Rival {
  base: number;
  /** null = not picked yet (drawn from the field share); "none" = can no longer pick (game started). */
  picks: ("home" | "away" | "none" | null)[];
}

/**
 * Mid-week version: the entry most likely to finish first given the scores
 * already on the board and every rival's actual picks on the games left.
 * Each trial draws the outcomes (and a rival's missing picks from the field
 * share), giving the best rival total M and how many share it; our total S
 * then wins outright above M and splits the tiebreaker evenly at M. Started
 * games keep Jack's locked pick; only open games are searched. Pure.
 */
export function optimizeStandings(
  games: LiveGame[],
  myBase: number,
  rivals: Rival[],
  opts: { trials?: number; seed?: number } = {},
): PoolResult {
  const trials = opts.trials ?? 20000;
  const G = games.length;
  const rand = rng(opts.seed ?? 20261012);
  const homeWon = new Uint8Array(trials * G);
  const top = new Int32Array(trials);
  const ties = new Int32Array(trials);
  for (let t = 0; t < trials; t++) {
    for (let g = 0; g < G; g++) homeWon[t * G + g] = rand() < games[g].pHome ? 1 : 0;
    let M = -1;
    let c = 0;
    for (const r of rivals) {
      let s = r.base;
      for (let g = 0; g < G; g++) {
        const p = r.picks[g];
        if (p === "none") continue;
        const home = p === null || p === undefined ? rand() < games[g].publicHome : p === "home";
        if ((home ? 1 : 0) === homeWon[t * G + g]) s++;
      }
      if (s > M) {
        M = s;
        c = 1;
      } else if (s === M) c++;
    }
    top[t] = M;
    ties[t] = c;
  }
  const evalEntry = (picks: Int8Array /* 1 home, 0 away, -1 none */) => {
    let sum = 0;
    for (let t = 0; t < trials; t++) {
      let S = myBase;
      const o = t * G;
      for (let g = 0; g < G; g++) if (picks[g] >= 0 && picks[g] === homeWon[o + g]) S++;
      sum += S > top[t] ? 1 : S === top[t] ? 1 / (ties[t] + 1) : 0;
    }
    return sum / trials;
  };
  const chalk = new Int8Array(G);
  for (let g = 0; g < G; g++) {
    const gm = games[g];
    chalk[g] = gm.locked ? (gm.mine === "home" ? 1 : gm.mine === "away" ? 0 : -1) : gm.pHome >= 0.5 ? 1 : 0;
  }
  const chalkChance = evalEntry(chalk);
  const cur = chalk.slice();
  let best = chalkChance;
  for (let flips = 0; flips < MAX_FLIPS; flips++) {
    let bestG = -1;
    let bestV = best;
    for (let g = 0; g < G; g++) {
      if (games[g].locked || cur[g] !== chalk[g]) continue;
      cur[g] ^= 1;
      const v = evalEntry(cur);
      cur[g] ^= 1;
      if (v > bestV + 1e-4) {
        bestV = v;
        bestG = g;
      }
    }
    if (bestG < 0) break;
    cur[bestG] ^= 1;
    best = bestV;
  }
  const exp = (p: Int8Array) => games.reduce((s, gm, g) => s + (p[g] === 1 ? gm.pHome : p[g] === 0 ? 1 - gm.pHome : 0), myBase);
  return {
    picks: Array.from(cur, (x) => (x === 1 ? "home" : "away") as "home" | "away"),
    winChance: best,
    chalkChance,
    upsets: games.flatMap((gm, g) =>
      !gm.locked && cur[g] !== chalk[g]
        ? [{ key: gm.key, team: cur[g] ? gm.home : gm.away, pWin: cur[g] ? gm.pHome : 1 - gm.pHome, publicOn: cur[g] ? gm.publicHome : 1 - gm.publicHome }]
        : [],
    ),
    expectedCorrect: Math.round(exp(cur) * 100) / 100,
    chalkExpectedCorrect: Math.round(exp(chalk) * 100) / 100,
    trials,
    entrants: rivals.length + 1,
  };
}

/**
 * The field's pick share when the real one isn't known: people back the
 * favorite more heavily than its win chance (a common pattern in pick'em
 * pools). `lean` > 1 exaggerates the market; 1 would copy it. An estimate,
 * replaced by real shares as soon as they can be read.
 */
export function estimatedPublicHome(pHome: number, lean = 1.6): number {
  const p = Math.min(0.995, Math.max(0.005, pHome));
  const z = Math.log(p / (1 - p)) * lean;
  return 1 / (1 + Math.exp(-z));
}

/** One game's pick in the pool entry, as last shown before kickoff. */
export interface EntryPick {
  team: string;
  at: string;
}

/**
 * The entry's pick per not-yet-started game, keyed "AWAY@HOME" in Sleeper's
 * spelling (`canon`), ready to save. Each refresh overwrites only open games,
 * so a game's saved pick is the one the page last showed before kickoff.
 */
export function entryRecords(
  games: { home: string; away: string }[],
  picks: ("home" | "away")[],
  at: string,
  canon: (t: string) => string,
): Record<string, EntryPick> {
  return Object.fromEntries(
    games.map((g, i) => [`${canon(g.away)}@${canon(g.home)}`, { team: canon(picks[i] === "home" ? g.home : g.away), at }]),
  );
}

export interface EntryWeek {
  week: number;
  w: number;
  l: number;
  /** Picked games that have finished. */
  graded: number;
  /** Finished games that week with a winner, picked or not. */
  played: number;
}

/**
 * Picks graded against finals, per week. Each week's picks are the teams
 * picked to win (a team plays once a week), in Sleeper's spelling. Ties and
 * unpicked games are left out of W-L. Pure.
 */
export function gradeTeams(
  byWeek: Map<number, Set<string>>,
  games: { week: number; home: string; away: string; completed: boolean; homeScore: number | null; awayScore: number | null }[],
  canon: (t: string) => string,
): EntryWeek[] {
  return [...byWeek.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([week, picks]) => {
      let w = 0;
      let l = 0;
      let played = 0;
      for (const g of games) {
        if (g.week !== week || !g.completed || g.homeScore == null || g.awayScore == null || g.homeScore === g.awayScore) continue;
        played++;
        const home = canon(g.home);
        const away = canon(g.away);
        if (!picks.has(home) && !picks.has(away)) continue;
        const winner = g.homeScore > g.awayScore ? home : away;
        if (picks.has(winner)) w++;
        else l++;
      }
      return { week, w, l, graded: w + l, played };
    })
    .filter((x) => x.graded > 0);
}

/**
 * The pool tiebreaker: the average of Sam's and David's projected totals for
 * the week's last game, rounded (Jack's rule, 2026-10-17, same as /pickem).
 * Falls back to one model, then the market, and says which it used.
 */
export function tiebreakTotal(
  models: { sam?: number; david?: number } | null,
  market: number | null,
): { total: number; basis: "models" | "sam" | "david" | "market"; sam?: number; david?: number; market?: number } | null {
  const sam = models?.sam;
  const david = models?.david;
  const mkt = market ?? undefined;
  if (sam !== undefined && david !== undefined) return { total: Math.round((sam + david) / 2), basis: "models", sam, david, market: mkt };
  if (sam !== undefined) return { total: Math.round(sam), basis: "sam", sam, market: mkt };
  if (david !== undefined) return { total: Math.round(david), basis: "david", david, market: mkt };
  if (mkt !== undefined) return { total: Math.round(mkt), basis: "market", market: mkt };
  return null;
}
