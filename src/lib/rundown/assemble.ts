// The nightly rundown (GET /api/rundown): last night's results across every
// market Hobby Hub grades, for the daily email in command-center. Pure: the
// readers (store.ts) turn each page's own graded data into `MarketSource`s,
// and this file only filters by day, counts and sums. No grading happens here.
//
// Issued and shadow never mix (HANDOFF "RULE (Jack, 2026-10-27)", /records):
// `totals` counts only issued markets whose units are computed (the same
// staked, sent bets /records totals). Shadow markets ride along with
// `issued: false`, and an issued market with no units (straight-up picks,
// which /records doesn't grade in units) is listed but not in `totals`.

export type Result = "W" | "L" | "P";

/** One settled play, graded by the page that owns it. */
export interface Play {
  /** Eastern calendar day the play settled (its game's date), YYYY-MM-DD. Null: not datable (old records). */
  day: string | null;
  /** ISO time used for ordering (kickoff, tip, or send time). */
  at: string;
  result: Result;
  /** Net units at the saved price; null where the market has no unit grading. */
  net: number | null;
  label: string;
  price: string | null;
}

export interface MarketSource {
  key: string;
  label: string;
  sport: "nfl" | "cfb" | "nba";
  /** Sent in an email (the /records "issued" book). */
  issued: boolean;
  /** Units are computed for this market somewhere in the app. */
  hasUnits: boolean;
  plays: Play[];
  /** Survivor only: where the entry stands. */
  survivor?: { pool: string; alive: boolean; losses: number; strikes: number };
}

export interface RundownEvent {
  day: string;
  kind: "review" | "rollback";
  text: string;
  /** The market it touches, when it maps onto one. */
  market?: string;
}

export interface MarketOut {
  key: string;
  label: string;
  sport: string;
  issued: boolean;
  wins: number;
  losses: number;
  pushes: number;
  units: number | null;
  hits: { label: string; price: string | null }[];
  seasonWins: number;
  seasonLosses: number;
  seasonUnits: number | null;
  streak: { kind: "W" | "L"; n: number } | null;
}

export interface Mover {
  kind: "streak" | "record" | "review" | "rollback" | "survivor" | "other";
  text: string;
}

export interface Rundown {
  date: string;
  generatedAt: string;
  boardUrl: string;
  recordsUrl: string;
  totals: { wins: number; losses: number; pushes: number; units: number; seasonUnits: number | null };
  markets: MarketOut[];
  movers: Mover[];
}

export const STREAK_MIN = 4;
/** A best night needs this many earlier nights to beat, or every first night is a "season best". */
export const BEST_MIN_PRIOR_DAYS = 3;
export const MAX_MOVERS = 3;

const r2 = (x: number) => Math.round(x * 100) / 100;
const fmtU = (x: number) => `${x >= 0 ? "+" : "-"}${Math.abs(x).toFixed(2)}u`;

/** YYYY-MM-DD in America/New_York. */
export function etDay(at: Date | string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(at));
}

/** The ET calendar day before `now`'s ET day. */
export function yesterdayEt(now: Date): string {
  const [y, m, d] = etDay(now).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
}

export const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T12:00:00Z`));

/** "+450" / "-110" from an American price. */
export const american = (p: number) => (p > 0 ? `+${Math.round(p)}` : `${Math.round(p)}`);

/** A play's day, or the ET day of its `at` when it carries none (for the season window only). */
const dayOf = (p: Play) => p.day ?? etDay(p.at);

function tally(plays: Play[], hasUnits: boolean) {
  const w = plays.filter((p) => p.result === "W").length;
  const l = plays.filter((p) => p.result === "L").length;
  const pu = plays.filter((p) => p.result === "P").length;
  const units = hasUnits ? r2(plays.reduce((a, p) => a + (p.net ?? 0), 0)) : null;
  return { w, l, p: pu, units };
}

/** The current run of wins or losses at the end of `plays` (pushes skipped). */
export function streakOf(plays: Play[]): { kind: "W" | "L"; n: number } | null {
  const seq = plays
    .filter((p) => p.result !== "P")
    .sort((a, b) => dayOf(a).localeCompare(dayOf(b)) || a.at.localeCompare(b.at));
  const last = seq.at(-1);
  if (!last) return null;
  let n = 0;
  for (let i = seq.length - 1; i >= 0 && seq[i].result === last.result; i--) n++;
  return { kind: last.result as "W" | "L", n };
}

/**
 * A tracked market's run in nights, not bets: dozens of long shots a night
 * make a per-bet run noise ("lost 56 straight" first TDs). A night is a win
 * when it made units (or, with no units, won more than it lost); even nights are skipped.
 */
export function nightStreak(plays: Play[]): { kind: "W" | "L"; n: number } | null {
  const byDay = new Map<string, { units: number; wl: number }>();
  for (const p of plays) {
    const d = byDay.get(dayOf(p)) ?? { units: 0, wl: 0 };
    d.units += p.net ?? 0;
    d.wl += p.result === "W" ? 1 : p.result === "L" ? -1 : 0;
    byDay.set(dayOf(p), d);
  }
  const nights = [...byDay].map(([day, d]): Play => {
    const score = plays.some((p) => p.net !== null) ? r2(d.units) : d.wl;
    return { day, at: day, result: score > 0 ? "W" : score < 0 ? "L" : "P", net: null, label: "", price: null };
  });
  return streakOf(nights);
}

/** Is `date` this market's best night of the season in units (beating every earlier night)? */
function bestNight(plays: Play[], date: string): number | null {
  const byDay = new Map<string, number>();
  for (const p of plays) if (p.net !== null) byDay.set(dayOf(p), (byDay.get(dayOf(p)) ?? 0) + p.net);
  const today = byDay.get(date);
  if (today === undefined || today <= 0) return null;
  const before = [...byDay].filter(([d]) => d < date).map(([, u]) => u);
  if (before.length < BEST_MIN_PRIOR_DAYS || before.some((u) => u >= today)) return null;
  return r2(today);
}

export function assembleRundown(input: {
  date: string;
  now: Date;
  baseUrl: string;
  sources: MarketSource[];
  events: RundownEvent[];
}): Rundown {
  const { date, now, baseUrl, sources, events } = input;
  const dayEvents = events.filter((e) => e.day === date);
  const touched = new Set(dayEvents.flatMap((e) => (e.market ? [e.market] : [])));

  const markets: MarketOut[] = [];
  const movers: (Mover & { rank: number; size: number })[] = [];
  let seasonUnits: number | null = null;

  for (const src of sources) {
    // Through the end of `date`: asking about an old night gives that night's season picture.
    const season = src.plays.filter((p) => dayOf(p) <= date);
    const today = src.plays.filter((p) => p.day === date);
    const s = tally(season, src.hasUnits);
    if (src.issued && src.hasUnits) seasonUnits = r2((seasonUnits ?? 0) + (s.units ?? 0));
    if (!today.length && !touched.has(src.key)) continue;
    const t = tally(today, src.hasUnits);
    // Issued markets run bet by bet (the Picks pages' sense); tracked ones night by night.
    const streak = src.issued ? streakOf(season) : nightStreak(season);
    markets.push({
      key: src.key,
      label: src.label,
      sport: src.sport,
      issued: src.issued,
      wins: t.w,
      losses: t.l,
      pushes: t.p,
      units: t.units,
      hits: today.filter((p) => p.result === "W").map((p) => ({ label: p.label, price: p.price })),
      seasonWins: s.w,
      seasonLosses: s.l,
      seasonUnits: s.units,
      streak,
    });

    if (src.survivor && today.length) {
      const pick = today[today.length - 1];
      const v = src.survivor;
      const state = v.alive ? `still alive${v.strikes > 1 ? ` (${v.losses} of ${v.strikes} strikes used)` : ""}` : "eliminated";
      movers.push({ kind: "survivor", text: `Survivor, ${v.pool}: ${pick.label}, ${state}.`, rank: 2, size: 0 });
      continue;
    }
    if (!today.length) continue;
    const best = bestNight(season, date);
    if (best !== null)
      movers.push({ kind: "record", text: `${src.label} had its best night of the season at ${fmtU(best)} (${t.w}-${t.l}${t.p ? `-${t.p}` : ""}).`, rank: 3, size: best });
    if (streak && streak.n >= STREAK_MIN)
      movers.push({
        kind: "streak",
        text: `${src.label} has ${streak.kind === "W" ? "won" : "lost"} ${streak.n} straight${src.issued ? "" : " nights (tracked only)"}.`,
        rank: 4,
        size: streak.n,
      });
  }

  for (const e of dayEvents) movers.push({ kind: e.kind, text: e.text, rank: e.kind === "rollback" ? 0 : 1, size: 0 });

  const counted = markets.filter((m) => m.issued && m.units !== null);
  return {
    date,
    generatedAt: now.toISOString(),
    boardUrl: `${baseUrl}/today`,
    recordsUrl: `${baseUrl}/records`,
    totals: {
      wins: counted.reduce((a, m) => a + m.wins, 0),
      losses: counted.reduce((a, m) => a + m.losses, 0),
      pushes: counted.reduce((a, m) => a + m.pushes, 0),
      units: r2(counted.reduce((a, m) => a + (m.units ?? 0), 0)),
      seasonUnits,
    },
    // Issued first, then by the size of the night.
    markets: markets.sort((a, b) => Number(b.issued) - Number(a.issued) || Math.abs(b.units ?? 0) - Math.abs(a.units ?? 0) || a.key.localeCompare(b.key)),
    movers: movers
      .sort((a, b) => a.rank - b.rank || b.size - a.size)
      .slice(0, MAX_MOVERS)
      .map(({ kind, text }) => ({ kind, text })),
  };
}

/** One sentence from a journal line: the first sentence, capped for an email. */
export function oneSentence(text: string, max = 180): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const first = flat.match(/^.*?[.!?](\s|$)/)?.[0]?.trim() ?? flat;
  const out = first.length > max ? `${first.slice(0, max - 1).trimEnd()}…` : first;
  return /[.!?…]$/.test(out) ? out : `${out}.`;
}
