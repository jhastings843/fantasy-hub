// Closing-line value: did the market move toward a pick after it was made?
//
// Pure. ESPN's game summary keeps DraftKings' opening and closing spread on
// finished games, so this is read after the fact rather than captured at
// kickoff. A win-loss record needs a season to separate skill from luck; the
// closing line moves on every game, so it says sooner whether a model is
// seeing something the market later agrees with.
//
// Conventions match the engine: lines are home-side, -3.5 means the home team
// gives 3.5. A home bettor wants the larger home number, a road bettor the
// smaller, so CLV for a home pick is (line taken - close) and for a road pick
// (close - line taken). Positive means the bet was better than the close.

import { teamKey, type League } from "./parse";
import { key, type GradedGame, type RefLine } from "./engine";

/** The home-side line a PEM split pick is graded at: the line of the model PEM sided with. */
export function pemSplitLine(g: GradedGame): number {
  return g.read.pemSide === g.read.samSide ? g.sam.market : g.david.market;
}

export interface ClosingLine {
  week: number;
  home: string;
  away: string;
  /** DraftKings spread, home side. */
  open: number | null;
  close: number | null;
  totalOpen: number | null;
  totalClose: number | null;
  /** ESPN's final score, so grading never depends on the two model sites alone. */
  final?: { home: number; away: number };
}

export interface EspnEventRef {
  id: string;
  home: string;
  away: string;
  completed: boolean;
  /** Final score, completed games only. */
  final?: { home: number; away: number };
}

// ESPN's NFL abbreviations, where they differ from the ones both models use.
const ESPN_NFL: { [abbr: string]: string } = { WSH: "WAS", LAR: "LA" };

interface EspnTeam {
  abbreviation?: string;
  location?: string;
}
interface EspnCompetitor {
  homeAway: string;
  team: EspnTeam;
  score?: string;
}
interface EspnScoreboard {
  events?: Array<{
    id: string;
    date?: string;
    status?: { type?: { completed?: boolean; state?: string } };
    competitions?: Array<{
      competitors?: EspnCompetitor[];
      odds?: Array<{
        spread?: number;
        overUnder?: number;
        provider?: { name?: string };
        pointSpread?: { home?: Leg; away?: Leg };
        total?: { over?: Leg; under?: Leg };
      }>;
    }>;
  }>;
}

/**
 * Current spreads for games that have NOT started, keyed like the engine.
 * Only "pre" games: once a game kicks off the number is a closing line, and a
 * closing line must never feed a pregame pick.
 */
export function parseCurrentOdds(
  league: League,
  week: number,
  data: EspnScoreboard,
  fetchedAt: string,
): Map<string, RefLine> {
  const out = new Map<string, RefLine>();
  const refs = parseScoreboard(league, data);
  (data.events ?? []).forEach((e) => {
    const o = e.competitions?.[0]?.odds?.[0];
    const ref = refs.find((r) => r.id === e.id);
    if (!ref || e.status?.type?.state !== "pre" || typeof o?.spread !== "number") return;
    // Before kickoff ESPN's "close" leg is the current quote, with its price.
    const price = (leg?: Leg) => {
      const n = Number(String(leg?.close?.odds ?? "").replace("+", ""));
      return Number.isFinite(n) && n !== 0 ? n : undefined;
    };
    const prices = {
      homePrice: price(o.pointSpread?.home),
      awayPrice: price(o.pointSpread?.away),
      overPrice: price(o.total?.over),
      underPrice: price(o.total?.under),
    };
    out.set(key({ week, home: ref.home, away: ref.away }), {
      line: o.spread,
      ...(typeof o.overUnder === "number" ? { total: o.overUnder } : {}),
      ...Object.fromEntries(Object.entries(prices).filter(([, v]) => v !== undefined)),
      ...(e.date ? { kickoff: e.date } : {}),
      source: `${o.provider?.name ?? "Sportsbook"} via ESPN`,
      fetchedAt,
    });
  });
  return out;
}

/** Scoreboard events as team keys the picks engine can join on. */
export function parseScoreboard(league: League, data: EspnScoreboard): EspnEventRef[] {
  const name = (t: EspnTeam) =>
    league === "nfl" ? ESPN_NFL[t.abbreviation ?? ""] ?? t.abbreviation ?? "" : teamKey("cfb", t.location ?? "");
  return (data.events ?? []).flatMap((e) => {
    const cs = e.competitions?.[0]?.competitors ?? [];
    const h = cs.find((c) => c.homeAway === "home");
    const a = cs.find((c) => c.homeAway === "away");
    if (!h || !a) return [];
    const completed = !!e.status?.type?.completed;
    const hs = Number(h.score);
    const as = Number(a.score);
    const final = completed && h.score !== undefined && a.score !== undefined && !isNaN(hs) && !isNaN(as) ? { home: hs, away: as } : undefined;
    return [{ id: e.id, home: name(h.team), away: name(a.team), completed, ...(final ? { final } : {}) }];
  });
}

/** "+2.5", "-3", "PK", "o38.5", "u38.5" to a number. */
function num(raw: unknown): number | null {
  if (typeof raw === "number") return raw;
  if (typeof raw !== "string") return null;
  const s = raw.trim().replace(/^[ou]/i, "");
  if (/^(pk|even|ev)$/i.test(s)) return 0;
  const n = Number(s.replace("+", ""));
  return s !== "" && Number.isFinite(n) ? n : null;
}

interface Leg {
  open?: { line?: string; odds?: string };
  close?: { line?: string; odds?: string };
}
interface EspnSummary {
  pickcenter?: Array<{
    pointSpread?: { home?: Leg };
    total?: { over?: Leg };
  }>;
}

/** Open and close from a game summary, or null when ESPN priced nothing. */
export function parseSummary(
  data: EspnSummary,
): Pick<ClosingLine, "open" | "close" | "totalOpen" | "totalClose"> | null {
  const p = data.pickcenter?.[0];
  if (!p) return null;
  const s = p.pointSpread?.home;
  const t = p.total?.over;
  const out = {
    open: num(s?.open?.line),
    close: num(s?.close?.line),
    totalOpen: num(t?.open?.line),
    totalClose: num(t?.close?.line),
  };
  return out.close === null && out.totalClose === null ? null : out;
}

/** Points better (positive) or worse than the close, for a pick at a home-side line. */
export function clvPoints(side: "home" | "away", homeLine: number, close: number): number {
  return side === "home" ? homeLine - close : close - homeLine;
}

export interface ClvRow {
  id: string;
  label: string;
  /** Picks with a closing line to compare against. */
  n: number;
  /** Average points better than the close. */
  avg: number;
  beat: number;
  same: number;
  worse: number;
  /** Extra detail for display, such as the rule's name. */
  note?: string;
}

export function summarize(id: string, label: string, values: number[]): ClvRow {
  const beat = values.filter((v) => v > 0).length;
  const worse = values.filter((v) => v < 0).length;
  const avg = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
  return { id, label, n: values.length, avg: Math.round(avg * 100) / 100, beat, same: values.length - beat - worse, worse };
}

type Rule = { label: string; matches: (g: GradedGame) => boolean } | null;

/**
 * Each model, and the rule in force, against the close. A model is graded at
 * the market number it printed next to its own line, because that is the
 * number a reader of that site could have bet; the shared picks are graded at
 * the worse of the two, the same line the backtest uses.
 */
export function clvTable(games: GradedGame[], closes: Map<string, ClosingLine>, rule: Rule): ClvRow[] {
  const vs: { [id: string]: number[] } = { sam: [], david: [], pem: [], agree: [], rule: [] };
  for (const g of games) {
    const c = closes.get(key(g))?.close;
    if (c === null || c === undefined) continue;
    for (const who of ["sam", "david"] as const) {
      const m = g[who];
      if (m.model !== m.market) vs[who].push(clvPoints(m.model < m.market ? "home" : "away", m.market, c));
    }
    if (g.pem) {
      const m = g.pem.market ?? g.read.avgMarket;
      if (g.pem.model !== m) vs.pem.push(clvPoints(g.pem.model < m ? "home" : "away", m, c));
    }
    const r = g.read;
    if (r.agree && r.side && r.line !== undefined) {
      const v = clvPoints(r.side, r.side === "home" ? r.line : -r.line, c);
      vs.agree.push(v);
      if (rule?.matches(g)) vs.rule.push(v);
    } else if (r.pemSide && rule?.matches(g)) {
      // A "PEM breaks the split" play is graded at the source line of the
      // model PEM sided with (see gradeGame), so its CLV uses that line too.
      vs.rule.push(clvPoints(r.pemSide, pemSplitLine(g), c));
    }
  }
  return [
    summarize("sam", "Sam", vs.sam),
    summarize("david", "David", vs.david),
    ...(vs.pem.length ? [summarize("pem", "PEM", vs.pem)] : []),
    summarize("agree", "Both agree", vs.agree),
    ...(rule ? [{ ...summarize("rule", "The rule", vs.rule), note: rule.label }] : []),
  ];
}
