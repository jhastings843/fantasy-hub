// The John Harris tracker. Pure. Grades his three things every week and says
// whether either question has an answer yet (Jack, 2026-10-08: track him,
// don't use him; implement if he shows an edge or helps).
//
//   picks       his posted contest picks, at the line he listed, by tier
//   sheet       every game on his sheet: his side at his sheet's line
//   agreement   the question that matters for us. On games where Sam and
//               David agree, does skipping the ones Harris disagrees with
//               beat betting them all? Paired per game at the line our
//               backtest grades (the shared pick at the worse line).
//
// The bar is the strategy review's (learning/model.ts CRITERIA): 30+
// settled games over 3+ weeks and a one-sided paired t of 1.645 or more for
// agreement; for his edge alone, his 3+ point sheet edges need 30+ decided
// games over 3+ weeks with the 90% Wilson range's low end past 52.4%. A
// pass files a proposal for a person; it never changes a bet by itself.

import { BREAK_EVEN, type GradedGame } from "./engine";
import { CRITERIA } from "./learning/model";
import { type HarrisPick, type HarrisWeek, type PickTier, harrisKey, similarity } from "./harris-sheet";

type Final = { home: number; away: number };
export interface Rec {
  w: number;
  l: number;
  p: number;
}
const add = (r: Rec, res: "W" | "L" | "P" | null) => {
  if (res === "W") r.w++;
  else if (res === "L") r.l++;
  else if (res === "P") r.p++;
};
const empty = (): Rec => ({ w: 0, l: 0, p: 0 });
/** At -110: a win pays 0.909u, a loss costs 1u. */
const units = (res: "W" | "L" | "P" | null | undefined) => (res === "W" ? 100 / 110 : res === "L" ? -1 : 0);

/** The home side's result at a home-side line. */
function homeResult(f: Final, homeLine: number): "W" | "L" | "P" {
  const v = f.home - f.away + homeLine;
  return Math.abs(v) < 1e-9 ? "P" : v > 0 ? "W" : "L";
}
const flip = (r: "W" | "L" | "P") => (r === "W" ? "L" : r === "L" ? "W" : "P");

export function wilsonLow(w: number, n: number, z = 1.645): number {
  if (!n) return 0;
  const p = w / n;
  const d = 1 + (z * z) / n;
  return (p + (z * z) / (2 * n) - z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
}

export interface HarrisReport {
  weeks: number[];
  picks: { [t in PickTier | "all"]: Rec };
  sheet: { all: Rec; edge3: Rec; edge3Weeks: number; games: number };
  agreement: {
    /** Sam+David agree, settled, with a Harris number. */
    games: number;
    weeks: number;
    all: Rec;
    harrisAgrees: Rec;
    harrisDisagrees: Rec;
    /** Mean units per game gained by skipping his disagreements (positive = he helps). */
    meanGain: number;
    t: number;
  };
  /** Which question has cleared the bar, if any. */
  clears: { agreement: boolean; edge: boolean };
  ungraded: { picks: number; rows: number };
}

/** A pick to its game and side on that week's sheet (or null). */
function pickGame(p: HarrisPick, w: HarrisWeek): { key: string; side: "home" | "away" } | null {
  const k = harrisKey(p.team);
  let best: { key: string; side: "home" | "away"; s: number } | null = null;
  for (const r of w.rows) {
    for (const side of ["home", "away"] as const) {
      const s = similarity(k, side === "home" ? r.home : r.away);
      if (s >= 0.75 && (!best || s > best.s)) best = { key: `${w.week}:${r.away}@${r.home}`, side, s };
    }
  }
  return best;
}

export function harrisReport(weeks: HarrisWeek[], finals: Map<string, Final>, graded: GradedGame[]): HarrisReport {
  const picks = { best: empty(), strong: empty(), gow: empty(), other: empty(), all: empty() };
  const sheetAll = empty();
  const edge3 = empty();
  const edge3Weeks = new Set<number>();
  let ungradedPicks = 0;
  let ungradedRows = 0;
  let sheetGames = 0;
  const rowAt = new Map<string, { model: number; week: number }>();

  for (const w of weeks.filter((x) => x.verified)) {
    for (const r of w.rows) {
      const k = `${w.week}:${r.away}@${r.home}`;
      rowAt.set(k, { model: r.model, week: w.week });
      sheetGames++;
      const f = finals.get(k);
      if (!f) {
        ungradedRows++;
        continue;
      }
      if (r.model === r.market) continue;
      const side = r.model < r.market ? "home" : "away";
      const hr = homeResult(f, r.market);
      const res = side === "home" ? hr : flip(hr);
      add(sheetAll, res);
      if (Math.abs(r.model - r.market) >= 3) {
        add(edge3, res);
        edge3Weeks.add(w.week);
      }
    }
    for (const p of w.picks) {
      const g = pickGame(p, w);
      const f = g ? finals.get(g.key) : undefined;
      if (!g || !f) {
        ungradedPicks++;
        continue;
      }
      // His line is from his team's side; to home side it flips for an away pick.
      const homeLine = g.side === "home" ? p.line : -p.line;
      const hr = homeResult(f, homeLine);
      const res = g.side === "home" ? hr : flip(hr);
      add(picks[p.tier], res);
      add(picks.all, res);
    }
  }

  // Agreement, on games Sam and David both graded and agree on.
  const all = empty();
  const yes = empty();
  const no = empty();
  const gains: number[] = [];
  const aWeeks = new Set<number>();
  for (const g of graded) {
    if (!g.read?.agree || !g.result) continue;
    const h = rowAt.get(`${g.week}:${g.away}@${g.home}`);
    if (!h) continue;
    const market = (g.sam.market + g.david.market) / 2;
    const ours = g.read.samSide;
    const his = h.model === market ? null : h.model < market ? "home" : "away";
    add(all, g.result);
    if (his === ours) add(yes, g.result);
    else if (his) add(no, g.result);
    // Skipping a game he disagrees with gains minus what betting it returned.
    gains.push(his && his !== ours ? -units(g.result) : 0);
    aWeeks.add(g.week);
  }
  const n = gains.length;
  const mean = n ? gains.reduce((s, x) => s + x, 0) / n : 0;
  const sd = n > 1 ? Math.sqrt(gains.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1)) : 0;
  const t = sd > 0 ? mean / (sd / Math.sqrt(n)) : 0;
  const decided3 = edge3.w + edge3.l;

  return {
    weeks: weeks.map((w) => w.week).sort((a, b) => a - b),
    picks,
    sheet: { all: sheetAll, edge3, edge3Weeks: edge3Weeks.size, games: sheetGames },
    agreement: { games: n, weeks: aWeeks.size, all, harrisAgrees: yes, harrisDisagrees: no, meanGain: Math.round(mean * 1000) / 1000, t: Math.round(t * 100) / 100 },
    clears: {
      agreement: n >= CRITERIA.MIN_OPPORTUNITIES && aWeeks.size >= CRITERIA.MIN_WEEKS && t >= CRITERIA.MIN_T,
      edge: decided3 >= CRITERIA.MIN_OPPORTUNITIES && edge3Weeks.size >= CRITERIA.MIN_WEEKS && wilsonLow(edge3.w, decided3) > BREAK_EVEN,
    },
    ungraded: { picks: ungradedPicks, rows: ungradedRows },
  };
}

export const recText = (r: Rec) => `${r.w}-${r.l}${r.p ? `-${r.p}` : ""}`;

/** One line for the Tuesday update and the journal. */
export function harrisSummary(r: HarrisReport): string {
  if (!r.weeks.length) return "Harris tracker: no sheets on file yet.";
  const a = r.agreement;
  return [
    `Harris tracker (weeks ${r.weeks.join(", ")}): posted picks ${recText(r.picks.all)}, full sheet ${recText(r.sheet.all)}, 3+ pt edges ${recText(r.sheet.edge3)}.`,
    a.games
      ? `With Sam and David agreeing (${a.games} games): ${recText(a.all)}; when he agrees ${recText(a.harrisAgrees)}, when he disagrees ${recText(a.harrisDisagrees)} (t ${a.t}).`
      : "No overlap with Sam and David's graded games yet.",
    r.clears.agreement || r.clears.edge ? "Cleared the bar: proposal filed." : "Not used for bets.",
  ].join(" ");
}
