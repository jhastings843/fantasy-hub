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
//
// Two more from 2026-11-02, for our play-by-play line (power.ts, no market
// input), on whichever side it is from the reference line:
//   power       our play-by-play line 1.5+ pts off the market
//   power3      the same at 3+ pts
// In the 2020-2026 backtest it lost against the close when it disagreed
// (scripts/fit-nfl-power.mts), so the question here is the same one: does the
// line move toward it from our first read. Its first read is the first
// snapshot that carried it, which can be later than the first one with our
// model (games already on file when it shipped).
// Two more from 2026-11-02 night (Jack: "use others as inputs"), a fixed,
// unfitted blend, since ~75 games with Sam and David is too few to fit one:
//   blend       the average of Sam's, David's and our play-by-play line, 1.5+ pts off the market
//   blend4      the same with PEM's line added, on games PEM covers
// Judged at the same first read as the play-by-play signals.
// A signal earns a closer look at 30+ games over 4+ weeks with average CLV
// above zero at t >= 1.645. Pure.

import { clvPoints, type ClosingLine } from "@/lib/picks/closing";
import type { ForecastSnapshot } from "@/lib/picks/forecasts";

export const SIGNALS = [
  { id: "lean", label: "Our lean, any size" },
  { id: "strong", label: "Our lean, 0.2+ pts (top third)" },
  { id: "fade-move", label: "Fade a 3.2+ pt market move" },
  { id: "fade-cover", label: "Fade the bigger last cover (17.5+ apart)" },
  { id: "power", label: "Our play-by-play line, 1.5+ pts off" },
  { id: "power3", label: "Our play-by-play line, 3+ pts off" },
  { id: "blend", label: "Sam, David and our line averaged, 1.5+ pts off" },
  { id: "blend4", label: "Sam, David, PEM and our line averaged, 1.5+ pts off" },
] as const;
export type SignalId = (typeof SIGNALS)[number]["id"];
export const GATE = { games: 30, weeks: 4, t: 1.645 };
const STRONG = 0.2;
const MOVE = 3.2;
const COVER = 17.5;
const POWER = 1.5;
const POWER3 = 3;

export interface TrackedGame {
  week: number;
  home: string;
  away: string;
  kickoff?: string;
  /** Home spread and our line at the first snapshot that had ours. */
  line: number;
  ours: number;
  /** `line`: the home spread this signal is judged at when it differs from the game's (the play-by-play signals' own first read). */
  signals: { id: SignalId; side: "home" | "away"; price: number | null; line?: number }[];
  close: number | null;
  final?: { home: number; away: number };
}

const opp = (s: "home" | "away") => (s === "home" ? "away" : "home");

/** The play-by-play signals on a snapshot: our line against the market's, home spreads, so lower = better for home. */
export function powerSignals(s: ForecastSnapshot): TrackedGame["signals"] {
  const o = s.ours;
  if (o?.power === undefined || !s.ref) return [];
  const d = o.market - o.power; // > 0: our line rates home higher than the market does
  if (Math.abs(d) < POWER) return [];
  const side = d > 0 ? "home" : "away";
  const price = (side === "home" ? s.ref.homePrice : s.ref.awayPrice) ?? null;
  const out: TrackedGame["signals"] = [{ id: "power", side, price }];
  if (Math.abs(d) >= POWER3) out.push({ id: "power3", side, price });
  return out;
}

/** The fixed blends: Sam, David and our play-by-play line averaged (plus PEM for blend4), home spreads, against the market. */
export function blendSignals(s: ForecastSnapshot): TrackedGame["signals"] {
  const o = s.ours;
  if (o?.power === undefined || !s.ref || !s.sam || !s.david) return [];
  const out: TrackedGame["signals"] = [];
  const add = (id: "blend" | "blend4", lines: number[]) => {
    const d = o.market - lines.reduce((a, x) => a + x, 0) / lines.length;
    if (Math.abs(d) < POWER) return;
    const side = d > 0 ? "home" : "away";
    out.push({ id, side, price: (side === "home" ? s.ref!.homePrice : s.ref!.awayPrice) ?? null });
  };
  const three = [s.sam.model, s.david.model, o.power];
  add("blend", three);
  if (s.pem) add("blend4", [...three, s.pem.model]);
  return out;
}

/** Which signals fire on a snapshot, and for which side (the play-by-play ones included). */
export function signalsOf(s: ForecastSnapshot): TrackedGame["signals"] {
  const o = s.ours!;
  const ref = s.ref!;
  const price = (side: "home" | "away") => (side === "home" ? ref.homePrice : ref.awayPrice) ?? null;
  const out: TrackedGame["signals"] = [...powerSignals(s)];
  const res = o.market - o.model; // predicted residual, home margin terms
  if (res !== 0) {
    const side = res > 0 ? "home" : "away";
    out.push({ id: "lean", side, price: price(side) });
    if (Math.abs(res) >= STRONG) out.push({ id: "strong", side, price: price(side) });
  }
  if (!o.x) return out;
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
  const firstPower = new Map<string, ForecastSnapshot>();
  const last = new Map<string, ForecastSnapshot>();
  for (const s of [...snaps].sort((a, b) => a.at.localeCompare(b.at))) {
    // Only a snapshot known to be before kickoff counts; no kickoff on file, no price.
    if (!s.ref?.kickoff || s.at >= s.ref.kickoff) continue;
    last.set(gk(s), s);
    if (s.ours && !first.has(gk(s))) first.set(gk(s), s);
    if (s.ours?.power !== undefined && !firstPower.has(gk(s))) firstPower.set(gk(s), s);
  }
  // The play-by-play signals come from the first read that had that line, judged at its own price.
  const sigs = (k: string, s: ForecastSnapshot) => {
    const rest = signalsOf(s).filter((x) => x.id !== "power" && x.id !== "power3");
    const pw = firstPower.get(k);
    return pw ? [...rest, ...[...powerSignals(pw), ...blendSignals(pw)].map((x) => ({ ...x, line: pw.ref!.line }))] : rest;
  };
  return [...first.entries()].map(([k, s]) => {
    const c = close.get(k);
    return {
      week: s.week,
      home: s.home,
      away: s.away,
      kickoff: s.ref!.kickoff,
      line: s.ref!.line,
      ours: s.ours!.model,
      signals: sigs(k, s),
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
      const cover = g.final.home - g.final.away + (x.line ?? g.line); // home covers when > 0
      const m = x.side === "home" ? cover : -cover;
      if (m > 0) {
        w++;
        units += payout(x.price);
      } else if (m < 0) {
        l++;
        units -= 1;
      } else p++;
    }
    const clvs = rows.filter(({ g }) => g.close !== null).map(({ g, x }) => clvPoints(x.side, x.line ?? g.line, g.close!));
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
