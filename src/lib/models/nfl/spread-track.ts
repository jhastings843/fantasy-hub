// The forward test of our NFL spread model (Jack, 2026-10-21: "forward-test
// early lines"). The backtest found nothing against the closing line; the
// open question is whether its leans beat EARLIER prices, i.e. whether the
// line moves our way before kickoff. Tracked only: no stakes.
//
// Each game is judged at the first pregame snapshot that carried our line
// (the earliest price we could have bet) and against the close. Four signals,
// thresholds fixed from the 2015-2026 backtest before any live game:
//   lean        our side, any size
//   strong      our side when the predicted residual is 0.2+ pts (top third)
//   fade-move   against the market's week-over-week move of 3.2+ pts (top 30%)
//   fade-cover  against the team that just beat its number by more, gap 17.5+ (top 30%)
// A signal earns a closer look at 30+ games over 4+ weeks with average CLV
// above zero at t >= 1.645. Pure.

import { clvPoints, type ClosingLine } from "@/lib/picks/closing";
import type { ForecastSnapshot } from "@/lib/picks/forecasts";

export const SIGNALS = [
  { id: "lean", label: "Our lean, any size" },
  { id: "strong", label: "Our lean, 0.2+ pts (top third)" },
  { id: "fade-move", label: "Fade a 3.2+ pt market move" },
  { id: "fade-cover", label: "Fade the bigger last cover (17.5+ apart)" },
] as const;
export type SignalId = (typeof SIGNALS)[number]["id"];
export const GATE = { games: 30, weeks: 4, t: 1.645 };
const STRONG = 0.2;
const MOVE = 3.2;
const COVER = 17.5;

export interface TrackedGame {
  week: number;
  home: string;
  away: string;
  kickoff?: string;
  /** Home spread and our line at the first snapshot that had ours. */
  line: number;
  ours: number;
  signals: { id: SignalId; side: "home" | "away"; price: number | null }[];
  close: number | null;
  final?: { home: number; away: number };
}

const opp = (s: "home" | "away") => (s === "home" ? "away" : "home");

/** Which signals fire on a snapshot, and for which side. */
export function signalsOf(s: ForecastSnapshot): TrackedGame["signals"] {
  const o = s.ours!;
  const ref = s.ref!;
  const price = (side: "home" | "away") => (side === "home" ? ref.homePrice : ref.awayPrice) ?? null;
  const out: TrackedGame["signals"] = [];
  const res = o.market - o.model; // predicted residual, home margin terms
  if (res !== 0) {
    const side = res > 0 ? "home" : "away";
    out.push({ id: "lean", side, price: price(side) });
    if (Math.abs(res) >= STRONG) out.push({ id: "strong", side, price: price(side) });
  }
  // move > 0: the line moved toward home beyond the market's own rating, so fade = away.
  if (Math.abs(o.x.move) >= MOVE) {
    const side = opp(o.x.move > 0 ? "home" : "away");
    out.push({ id: "fade-move", side, price: price(side) });
  }
  if (Math.abs(o.x.cover) >= COVER) {
    const side = opp(o.x.cover > 0 ? "home" : "away");
    out.push({ id: "fade-cover", side, price: price(side) });
  }
  return out;
}

const gk = (g: { week: number; home: string; away: string }) => `${g.week}|${g.home}|${g.away}`;

/** One row per game: the first snapshot with our line, before kickoff, plus the close and final. */
export function trackedGames(snaps: ForecastSnapshot[], closes: ClosingLine[]): TrackedGame[] {
  const close = new Map(closes.map((c) => [gk(c), c]));
  const first = new Map<string, ForecastSnapshot>();
  const last = new Map<string, ForecastSnapshot>();
  for (const s of [...snaps].sort((a, b) => a.at.localeCompare(b.at))) {
    if (!s.ref) continue;
    if (s.ref.kickoff && s.at >= s.ref.kickoff) continue;
    last.set(gk(s), s);
    if (s.ours && !first.has(gk(s))) first.set(gk(s), s);
  }
  return [...first.entries()].map(([k, s]) => {
    const c = close.get(k);
    return {
      week: s.week,
      home: s.home,
      away: s.away,
      kickoff: s.ref!.kickoff,
      line: s.ref!.line,
      ours: s.ours!.model,
      signals: signalsOf(s),
      close: c?.close ?? last.get(k)?.ref?.line ?? null,
      ...(c?.final ? { final: c.final } : {}),
    };
  });
}

export interface SignalRecord {
  id: SignalId;
  label: string;
  games: number;
  weeks: number;
  w: number;
  l: number;
  p: number;
  /** Units at the saved price (-110 when none), 1u a game. */
  units: number;
  /** Average points of closing-line value, and its t. */
  clv: number | null;
  t: number | null;
  verdict: "collecting" | "closer look" | "no edge";
}

const payout = (price: number | null) => (price === null ? 100 / 110 : price > 0 ? price / 100 : 100 / -price);

export function signalRecords(games: TrackedGame[]): SignalRecord[] {
  return SIGNALS.map(({ id, label }) => {
    const rows = games.flatMap((g) => g.signals.filter((x) => x.id === id).map((x) => ({ g, x })));
    let w = 0;
    let l = 0;
    let p = 0;
    let units = 0;
    for (const { g, x } of rows) {
      if (!g.final) continue;
      const cover = g.final.home - g.final.away + g.line; // home covers when > 0
      const m = x.side === "home" ? cover : -cover;
      if (m > 0) {
        w++;
        units += payout(x.price);
      } else if (m < 0) {
        l++;
        units -= 1;
      } else p++;
    }
    const clvs = rows.filter(({ g }) => g.close !== null).map(({ g, x }) => clvPoints(x.side, g.line, g.close!));
    const mean = clvs.length ? clvs.reduce((a, v) => a + v, 0) / clvs.length : null;
    const sd = clvs.length > 1 && mean !== null ? Math.sqrt(clvs.reduce((a, v) => a + (v - mean) ** 2, 0) / (clvs.length - 1)) : null;
    const t = mean !== null && sd ? mean / (sd / Math.sqrt(clvs.length)) : null;
    const weeks = new Set(rows.map(({ g }) => g.week)).size;
    const enough = clvs.length >= GATE.games && weeks >= GATE.weeks;
    return {
      id,
      label,
      games: rows.length,
      weeks,
      w,
      l,
      p,
      units: Math.round(units * 100) / 100,
      clv: mean === null ? null : Math.round(mean * 100) / 100,
      t: t === null ? null : Math.round(t * 100) / 100,
      verdict: !enough ? "collecting" : t !== null && t >= GATE.t && (mean ?? 0) > 0 ? "closer look" : "no edge",
    };
  });
}
