// Go-live forecast (Jack, 2026-11-03): for every slice still collecting, when
// could it clear its sample bars at its current pace, and what are the odds it
// ever clears its t bar before the season ends? Pure; the page gathers inputs.
//
// The chance is an ESTIMATE. It works in per-game standard-deviation units, so
// it needs only the slice's t and game count:
// - What we have so far: S = t x sqrt(n) (the running sum in sd units).
// - The true edge is unknown. Prior: centred on zero (betting markets are
//   mostly efficient) with sd PRIOR_SD per game in sd units (0.08: a real
//   edge of a few percent of a unit is plausible, 20% is not). Updated with
//   the games so far.
// - A refinement must clear two bars: its own t and the paired t against its
//   parent. Both get a chance; the forecast keeps the lower one.
// - Simulate the rest of the season at the slice's pace, checking t at evenly
//   spaced points once the sample bars are met. Chance = share of runs that
//   reach the t bar at any check.
// Line-move and drawdown checks are not modelled; they can still block a
// slice the forecast rates likely.

export type Sport = "nfl" | "cfb" | "nba" | "cbb";

/** Last day each season's slices can bet, regular season or tournament (estimates, 2026-27). */
export const SEASON_END: { [k in Sport]: string } = {
  nfl: "2027-01-10",
  cfb: "2027-01-18",
  nba: "2027-04-11",
  cbb: "2027-04-05",
};

/** Weekly sports: pace is measured over at least a week so one Sunday doesn't read as a daily rate. */
const MIN_PACE_DAYS: { [k in Sport]: number } = { nfl: 7, cfb: 7, nba: 1, cbb: 1 };

export interface ForecastInput {
  id: string;
  label: string;
  sport: Sport;
  /** collecting, active, retired, rolled-back, rejected, report... */
  status: string;
  games: number;
  weeks: number;
  /** t on per-game results (or the paired t the gate uses). */
  t: number;
  /** Days the slice has been collecting (for the pace). */
  days: number;
  need: { games: number; weeks: number; t: number; bets?: number; wins?: number };
  /** Totals so far for the bet and winner bars. */
  bets?: number;
  wins?: number;
  /** Plain reason the gate is incomplete beyond sample and t (refinement, line move...). */
  extra?: string;
  /** A refinement's paired t against its parent, and the bar it must clear. */
  paired?: { t: number; need: number };
}

export type Outlook = "live" | "retired" | "no games" | "likely" | "possible" | "long shot" | "unlikely" | "out of time";

export interface Forecast extends ForecastInput {
  /** Games per day at the current pace. */
  pace: number;
  /** Date (YYYY-MM-DD) the sample bars are met at this pace; null when not this season or no pace. */
  sampleBy: string | null;
  /** Estimated chance it clears the t bar before the season ends (0 to 1); null when not computed. */
  chance: number | null;
  outlook: Outlook;
  /** One short line on why. */
  why: string;
}

const DAY = 86_400_000;
const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10);

function rng(seed: string) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 3432918353), (h = (h << 13) | (h >>> 19));
  let a = h >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normal(r: () => number) {
  const u = Math.max(r(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
}

const SIMS = 4000;
/** Prior sd of a slice's true per-game edge, in per-game sd units. */
export const PRIOR_SD = 0.08;
const CHECKS = 24;

/** Share of simulated seasons that reach t >= minT at a check between startN and endN games. */
export function crossChance(seed: string, n: number, t: number, startN: number, endN: number, minT: number): number {
  if (endN < startN) return 0;
  // Fewer than 5 games: the t says next to nothing (a 1-0 start reads t 99), so use the prior alone.
  const s0 = n >= 5 ? Math.max(-99, Math.min(99, t)) * Math.sqrt(n) : 0;
  const n0 = n >= 5 ? n : 0;
  const prec = 1 / PRIOR_SD ** 2 + n0;
  const muPost = s0 / prec;
  const sdPost = Math.sqrt(1 / prec);
  const points: number[] = [];
  const span = endN - startN;
  for (let i = 0; i <= CHECKS; i++) points.push(Math.round(startN + (span * i) / CHECKS));
  const pts = [...new Set(points)].filter((p) => p >= Math.max(1, n0));
  const r = rng(seed);
  let hit = 0;
  for (let k = 0; k < SIMS; k++) {
    const mu = muPost + sdPost * normal(r);
    let s = s0;
    let at = n0;
    for (const p of pts) {
      const d = p - at;
      if (d > 0) s += mu * d + Math.sqrt(d) * normal(r);
      at = p;
      if (s / Math.sqrt(p) >= minT) {
        hit++;
        break;
      }
    }
  }
  return hit / SIMS;
}

export function forecast(x: ForecastInput, now: Date): Forecast {
  const end = Date.parse(`${SEASON_END[x.sport]}T23:59:59Z`);
  const daysLeft = Math.max(0, (end - now.getTime()) / DAY);
  const pace = x.games / Math.max(x.days, MIN_PACE_DAYS[x.sport]);
  const base = { ...x, pace: Math.round(pace * 100) / 100 };
  if (x.status === "active") return { ...base, sampleBy: null, chance: null, outlook: "live", why: "Live now." };
  if (x.status === "retired" || x.status === "rejected" || x.status === "rolled-back")
    return { ...base, sampleBy: null, chance: null, outlook: "retired", why: x.status === "rolled-back" ? "Went live, then lost and was rolled back." : "Lost at the go-live confidence the other way. Still graded." };
  if (x.games === 0 || pace === 0) return { ...base, sampleBy: null, chance: null, outlook: "no games", why: "No graded games since it registered." };

  // Games needed for each sample bar, at this slice's rates per game.
  const perGame = (have: number | undefined, need: number | undefined) => (need && have !== undefined ? (have > 0 ? (need * x.games) / have : Infinity) : 0);
  const gamesFor = Math.max(x.need.games, perGame(x.bets, x.need.bets), perGame(x.wins, x.need.wins));
  const daysForGames = Math.max(0, (gamesFor - x.games) / pace);
  const daysForWeeks = Math.max(0, x.need.weeks - x.weeks) * 7;
  const daysToSample = Math.max(daysForGames, daysForWeeks);
  const sampleBy = Number.isFinite(daysToSample) && daysToSample <= daysLeft ? ymd(now.getTime() + daysToSample * DAY) : null;
  const endN = x.games + pace * daysLeft;
  if (!sampleBy) {
    const short = Number.isFinite(gamesFor) && gamesFor > endN ? `on pace for about ${Math.round(endN)} of ${Math.ceil(gamesFor)} games needed` : "not enough games or winners left";
    return { ...base, sampleBy: null, chance: 0, outlook: "out of time", why: `Can't meet its sample bars this season: ${short}.` };
  }
  const startN = Math.max(x.games, x.games + pace * daysToSample);
  const own = crossChance(x.id, x.games, x.t, Math.ceil(startN), Math.floor(endN), x.need.t);
  const chance = x.paired ? Math.min(own, crossChance(`${x.id}:paired`, x.games, x.paired.t, Math.ceil(startN), Math.floor(endN), x.paired.need)) : own;
  const outlook: Outlook = chance >= 0.5 ? "likely" : chance >= 0.2 ? "possible" : chance >= 0.05 ? "long shot" : "unlikely";
  const why =
    x.games < 5
      ? `Only ${x.games} game${x.games === 1 ? "" : "s"} in, so this is mostly the starting assumption (no edge).`
      : `t ${x.t} over ${x.games} games; needs ${x.need.t}+ once the sample is in.`;
  return { ...base, sampleBy, chance: Math.round(chance * 1000) / 1000, outlook, why: x.extra ? `${why} ${x.extra}` : why };
}

const ORDER: Outlook[] = ["live", "likely", "possible", "long shot", "unlikely", "no games", "out of time", "retired"];
export const byOutlook = (a: Forecast, b: Forecast) => ORDER.indexOf(a.outlook) - ORDER.indexOf(b.outlook) || (b.chance ?? -1) - (a.chance ?? -1) || a.label.localeCompare(b.label);
