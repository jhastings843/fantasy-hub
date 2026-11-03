// Our own NFL line from play by play (Jack, 2026-11-02: a line that is not
// anchored on the market). spread.ts starts from the market and nudges it;
// this one never looks at a line at all.
//
// Per team, four opponent-adjusted ratings in EPA per play, from nflverse
// play by play: pass offense, pass defense, rush offense, rush defense.
// A team's pass EPA in a game is modeled as league average + its pass
// offense + the opponent's pass defense (defense = EPA allowed, so higher is
// worse), and the four ratings are solved together so a good offense that
// played bad defenses gets marked down. Each rating starts the season at last
// season's final value times `carry` (pulled toward average), worth `prior`
// plays of evidence, so week 1 leans on last year and week 12 mostly on this
// year. Garbage time (win chance outside wp..1-wp) is left out.
//
// Predicted home margin = hfa (0 at a neutral site) + kPass × net pass edge
// + kRush × net rush edge + kRest × rest gap + kQb × new starting QB gap.
// The k's are points per EPA per play, fit on past seasons only
// (scripts/fit-nfl-power.mts). Leak-free: a game uses only plays from earlier
// days. Rest and QB come from spread.ts's features. No market input. Pure.

export interface TeamGame {
  game: string;
  season: number;
  /** Game date, YYYY-MM-DD. */
  gameday: string;
  team: string;
  opp: string;
  /** Sum of EPA and plays, this team on offense. */
  passEpa: number;
  passN: number;
  rushEpa: number;
  rushN: number;
}

export interface Rating {
  offPass: number;
  defPass: number;
  offRush: number;
  defRush: number;
}

export interface PowerParams {
  /** Plays of evidence the carried rating is worth. */
  prior: number;
  /** Share of last season's rating carried into the next (the rest regresses to average). */
  carry: number;
  /** Garbage-time cut: plays with the offense's win chance outside [wp, 1 - wp] are dropped. */
  wp: number;
  hfa: number;
  kPass: number;
  kRush: number;
  kRest: number;
  kQb: number;
}

// Old codes in older nflverse files, so a team's rating carries across a move.
const MOVED: { [k: string]: string } = { SD: "LAC", STL: "LA", OAK: "LV" };
export const modernTeam = (t: string) => MOVED[t] ?? t;

/** One CSV line into fields (quoted fields may hold commas; pbp's text has no newlines inside quotes). */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') (cur += '"'), i++;
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") out.push(cur), (cur = "");
    else cur += c;
  }
  out.push(cur);
  return out;
}

/**
 * Folds nflverse play-by-play rows into team-games. Feed the header first,
 * then each row. Counts dropbacks (pass = 1, so sacks and scrambles too) and
 * designed runs (rush = 1) with an EPA; kneels, spikes and two-point tries
 * are left out.
 */
export class PlayAgg {
  private col: { [k: string]: number } | null = null;
  private games = new Map<string, TeamGame>();
  plays = 0;

  constructor(readonly wp: number) {}

  header(f: string[]) {
    this.col = Object.fromEntries(f.map((k, i) => [k, i]));
  }

  row(f: string[]) {
    const c = this.col!;
    const pass = f[c.pass] === "1";
    const rush = f[c.rush] === "1";
    if (!pass && !rush) return;
    if (f[c.qb_kneel] === "1" || f[c.qb_spike] === "1" || f[c.two_point_attempt] === "1") return;
    const st = f[c.season_type];
    if (st !== "REG" && st !== "POST") return;
    const epa = f[c.epa] === "" ? NaN : Number(f[c.epa]);
    const team = f[c.posteam];
    const opp = f[c.defteam];
    if (!Number.isFinite(epa) || !team || !opp) return;
    const wp = f[c.wp] === "" ? NaN : Number(f[c.wp]);
    if (Number.isFinite(wp) && (wp < this.wp || wp > 1 - this.wp)) return;
    const id = f[c.game_id];
    const k = `${id}|${team}`;
    let g = this.games.get(k);
    if (!g) {
      g = { game: id, season: Number(f[c.season]), gameday: f[c.game_date], team: modernTeam(team), opp: modernTeam(opp), passEpa: 0, passN: 0, rushEpa: 0, rushN: 0 };
      this.games.set(k, g);
    }
    if (pass) (g.passEpa += epa), g.passN++;
    else (g.rushEpa += epa), g.rushN++;
    this.plays++;
  }

  teamGames(): TeamGame[] {
    return [...this.games.values()];
  }
}

const ZERO: Rating = { offPass: 0, defPass: 0, offRush: 0, defRush: 0 };

/** Last season's final ratings pulled toward average: next season's starting point. */
export function carryRatings(last: Map<string, Rating>, carry: number): Map<string, Rating> {
  return new Map([...last].map(([t, r]) => [t, { offPass: r.offPass * carry, defPass: r.defPass * carry, offRush: r.offRush * carry, defRush: r.defRush * carry }]));
}

/**
 * Opponent-adjusted ratings from a set of team-games (one season so far),
 * each rating shrunk toward its prior by `n0` plays. Alternating weighted
 * means (Gauss-Seidel), which converges fast for a schedule this connected.
 */
export function solveRatings(obs: TeamGame[], prior: Map<string, Rating>, n0: number, iters = 25): Map<string, Rating> {
  const teams = new Set<string>([...prior.keys()]);
  for (const g of obs) teams.add(g.team), teams.add(g.opp);
  const out = new Map<string, Rating>();
  for (const t of teams) out.set(t, { ...(prior.get(t) ?? ZERO) });
  const parts = [
    { sum: (g: TeamGame) => g.passEpa, n: (g: TeamGame) => g.passN, off: "offPass", def: "defPass" },
    { sum: (g: TeamGame) => g.rushEpa, n: (g: TeamGame) => g.rushN, off: "offRush", def: "defRush" },
  ] as const;
  for (const p of parts) {
    const N = obs.reduce((a, g) => a + p.n(g), 0);
    if (!N) continue;
    const mu = obs.reduce((a, g) => a + p.sum(g), 0) / N;
    for (let it = 0; it < iters; it++) {
      for (const side of ["off", "def"] as const) {
        const key = p[side];
        const num = new Map<string, number>();
        const den = new Map<string, number>();
        for (const g of obs) {
          const me = side === "off" ? g.team : g.opp;
          const them = side === "off" ? g.opp : g.team;
          const other = out.get(them)![side === "off" ? p.def : p.off];
          num.set(me, (num.get(me) ?? 0) + p.sum(g) - p.n(g) * (mu + other));
          den.set(me, (den.get(me) ?? 0) + p.n(g));
        }
        for (const t of teams) {
          const pr = (prior.get(t) ?? ZERO)[key];
          out.get(t)![key] = (n0 * pr + (num.get(t) ?? 0)) / (n0 + (den.get(t) ?? 0));
        }
      }
    }
  }
  return out;
}

/** Home minus away expected EPA per play, pass and rush. */
export function edges(r: Map<string, Rating>, home: string, away: string): { pass: number; rush: number } {
  const h = r.get(home) ?? ZERO;
  const a = r.get(away) ?? ZERO;
  return {
    pass: h.offPass + a.defPass - (a.offPass + h.defPass),
    rush: h.offRush + a.defRush - (a.offRush + h.defRush),
  };
}

export interface PowerInputs {
  pass: number;
  rush: number;
  /** Home rest days minus away, clipped (spread.ts features). */
  rest: number;
  /** New starting QB, home minus away (spread.ts features). */
  qb: number;
  neutral: boolean;
}

/** Predicted home margin (positive favors home). */
export const powerMargin = (x: PowerInputs, p: PowerParams) => (x.neutral ? 0 : p.hfa) + p.kPass * x.pass + p.kRush * x.rush + p.kRest * x.rest + p.kQb * x.qb;

/** Our line as a home spread, negative = home favored, to a tenth. */
export const powerLine = (x: PowerInputs, p: PowerParams) => Math.round(-powerMargin(x, p) * 10) / 10 || 0;

/**
 * Ratings as of each game day, leak-free: every rating a game on `day` sees
 * comes from that season's plays on earlier days, plus the carried prior.
 * `seasonEnd` gets each season's final ratings (playoffs included), which
 * seed the next season.
 */
export function* ratingsByDay(tg: TeamGame[], n0: number, carry: number, start: Map<string, Rating> = new Map()): Generator<{ season: number; day: string; ratings: Map<string, Rating> } | { season: number; final: Map<string, Rating> }> {
  const bySeason = new Map<number, TeamGame[]>();
  for (const g of tg) bySeason.set(g.season, [...(bySeason.get(g.season) ?? []), g]);
  let last = start;
  for (const season of [...bySeason.keys()].sort((a, b) => a - b)) {
    const rows = bySeason.get(season)!.sort((a, b) => a.gameday.localeCompare(b.gameday));
    const prior = carryRatings(last, carry);
    const days = [...new Set(rows.map((g) => g.gameday))];
    let i = 0;
    for (const day of days) {
      while (i < rows.length && rows[i].gameday < day) i++;
      yield { season, day, ratings: solveRatings(rows.slice(0, i), prior, n0) };
    }
    last = solveRatings(rows, prior, n0);
    yield { season, final: last };
  }
}

/** Ratings to and from the compact JSON form kept in power-params.json: [offPass, defPass, offRush, defRush]. */
export const packRatings = (r: Map<string, Rating>) => Object.fromEntries([...r].sort(([a], [b]) => a.localeCompare(b)).map(([t, x]) => [t, [x.offPass, x.defPass, x.offRush, x.defRush].map((v) => Math.round(v * 1e5) / 1e5)]));
export const unpackRatings = (o: { [t: string]: number[] }) => new Map(Object.entries(o).map(([t, v]) => [t, { offPass: v[0], defPass: v[1], offRush: v[2], defRush: v[3] }]));
