// One learning engine for the props-style sections (NFL props, NBA props,
// First TD; NBA first basket later). Football and NBA picks keep their own
// loop in lib/picks/learning, which already works this way; this is its
// counterpart for markets where every bet is a slice of a model's output.
//
// Each section keeps its own evidence and its own gate. The engine is the
// same everywhere:
// - Every candidate (a slice) registers the first time a review sees it, and
//   only games that kick off after that count. Evidence is out of sample.
// - The unit of evidence is the GAME, not the bet. Props from one game move
//   together (a blowout sinks every over), so bets are summed per game and the
//   t is on per-game net units. That keeps one wild game from looking like
//   twenty independent wins.
// - A refinement (a slice with a parent) must also beat its parent, game by
//   game, so a slice can't qualify just by riding its parent's edge.
// - Bounded change: at most `maxNew` activations per section per review.
// - Rollback is predeclared: an active slice that loses at t <= -rollbackT
//   over rollbackGames+ games since it went live is rolled back.
// - Everything the review does is written to the section's journal.
//
// Pure: lib/learning/store.ts does the Redis side.

export interface Bet {
  /** Game key; bets with the same key share one unit of evidence. */
  game: string;
  week: number;
  /** Kickoff, ISO. Only games kicking off after registration count. */
  at: string;
  /** Net units at the saved price, 1u risked. */
  net: number;
  /** Did the line move toward (1) or against (-1) the bet before kickoff (0 or absent: no move or unknown)? */
  toward?: number;
}

export interface Candidate {
  id: string;
  label: string;
  /** The broader slice this one narrows, when it has one. */
  parent?: string;
  bets: Bet[];
}

export interface Gate {
  /** Distinct games the candidate bet since it registered. */
  minGames: number;
  minWeeks: number;
  minBets: number;
  /** Rare-outcome guard (First TD): winning bets needed. */
  minWins: number;
  /** One-sided t on per-game net units. */
  minT: number;
  /** One-sided paired t, per game, against the parent slice. */
  minPairedT: number;
  /** At most this many activations per review. */
  maxNew: number;
  /** Drawdown ceiling: ddSd x sqrt(bets) + ddSlack units. */
  ddSd: number;
  ddSlack: number;
  /** Line-move check runs once this many bets have a known move. */
  moveMin: number;
  rollbackGames: number;
  rollbackT: number;
}

export type Status = "collecting" | "active" | "rolled-back";

export interface Entry {
  id: string;
  label: string;
  parent?: string;
  status: Status;
  registeredAt: string;
  registeredWeek: number;
  activatedAt?: string;
  activeWeek?: number;
  /** The evidence it went live on. */
  activation?: { t: number; games: number; bets: number; units: number };
  endedAt?: string;
  endedWeek?: number;
  reason?: string;
}

export interface SectionState {
  v: 1;
  section: string;
  entries: { [id: string]: Entry };
  lastReviewAt?: string;
  lastReviewWeek?: number;
  /** The slate (ET date) the last review ran on. */
  lastReviewSlate?: string;
}

export interface JournalLine {
  at: string;
  week: number;
  kind: "registered" | "activated" | "rolled back" | "review";
  id?: string;
  text: string;
}

export interface Check {
  name: string;
  pass: boolean;
  note: string;
}

export interface Evidence {
  id: string;
  games: number;
  weeks: number;
  bets: number;
  wins: number;
  units: number;
  t: number;
  pairedT: number | null;
  drawdown: number;
  toward: number;
  against: number;
  checks: Check[];
  ready: boolean;
}

const r2 = (x: number) => Math.round(x * 100) / 100;

/** One-sample t of xs against 0, capped so a zero-variance sample stays finite. */
export function tOf(xs: number[]): number {
  if (!xs.length) return 0;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd = xs.length > 1 ? Math.sqrt(xs.reduce((t, x) => t + (x - mean) ** 2, 0) / (xs.length - 1)) : 0;
  const raw = sd > 0 ? mean / (sd / Math.sqrt(xs.length)) : mean > 0 ? 99 : mean < 0 ? -99 : 0;
  return r2(Math.max(-99, Math.min(99, raw)));
}

/** Net units per game, in kickoff order. */
function perGame(bets: Bet[]): Map<string, { at: string; week: number; net: number }> {
  const m = new Map<string, { at: string; week: number; net: number }>();
  for (const b of [...bets].sort((a, c) => a.at.localeCompare(c.at) || a.game.localeCompare(c.game))) {
    const g = m.get(b.game) ?? { at: b.at, week: b.week, net: 0 };
    g.net += b.net;
    m.set(b.game, g);
  }
  return m;
}

/** A candidate's evidence on bets kicking off at or after `since`, judged against the gate. */
export function evidence(gate: Gate, c: Candidate, since: string, parent?: Candidate): Evidence {
  const bets = c.bets.filter((b) => b.at >= since);
  const games = perGame(bets);
  const nets = [...games.values()].map((g) => g.net);
  const weeks = new Set([...games.values()].map((g) => g.week)).size;
  const wins = bets.filter((b) => b.net > 0).length;
  const units = r2(bets.reduce((a, b) => a + b.net, 0));
  const t = tOf(nets);
  let run = 0;
  let peak = 0;
  let dd = 0;
  for (const n of nets) {
    run += n;
    peak = Math.max(peak, run);
    dd = Math.max(dd, peak - run);
  }
  let pairedT: number | null = null;
  if (parent) {
    const pg = perGame(parent.bets.filter((b) => b.at >= since));
    const keys = new Set([...games.keys(), ...pg.keys()]);
    pairedT = tOf([...keys].map((k) => (games.get(k)?.net ?? 0) - (pg.get(k)?.net ?? 0)));
  }
  const toward = bets.filter((b) => (b.toward ?? 0) > 0).length;
  const against = bets.filter((b) => (b.toward ?? 0) < 0).length;
  const ddCap = r2(gate.ddSd * Math.sqrt(Math.max(bets.length, 1)) + gate.ddSlack);
  const checks: Check[] = [
    { name: "games", pass: games.size >= gate.minGames, note: `${games.size} of ${gate.minGames} games` },
    { name: "weeks", pass: weeks >= gate.minWeeks, note: `${weeks} of ${gate.minWeeks} weeks` },
    { name: "bets", pass: bets.length >= gate.minBets, note: `${bets.length} of ${gate.minBets} bets` },
    ...(gate.minWins > 0 ? [{ name: "wins", pass: wins >= gate.minWins, note: `${wins} of ${gate.minWins} winners` }] : []),
    { name: "units", pass: units > 0, note: `${units >= 0 ? "+" : ""}${units}u` },
    { name: "t", pass: t >= gate.minT, note: `t ${t} vs ${gate.minT}` },
    ...(parent ? [{ name: "parent", pass: (pairedT ?? 0) >= gate.minPairedT, note: `beats ${parent.label.toLowerCase()} at t ${pairedT} vs ${gate.minPairedT}` }] : []),
    {
      name: "line move",
      pass: toward + against < gate.moveMin || toward >= against,
      note: toward + against < gate.moveMin ? `${toward + against} moved lines, check starts at ${gate.moveMin}` : `${toward} toward, ${against} against`,
    },
    { name: "drawdown", pass: dd <= ddCap, note: `${r2(dd)}u vs ${ddCap}u cap` },
  ];
  return { id: c.id, games: games.size, weeks, bets: bets.length, wins, units, t, pairedT, drawdown: r2(dd), toward, against, checks, ready: checks.every((x) => x.pass) };
}

export const emptyState = (section: string): SectionState => ({ v: 1, section, entries: {} });

/**
 * Due once per slate: each new day of data (Jack, 2026-10-27: learn after
 * every slate). Activations stay capped per section week (gate.maxNew), so
 * reviewing more often reacts faster without going live more often.
 */
export const reviewDue = (s: SectionState, week: number, slate?: string) => s.lastReviewWeek !== week || (slate !== undefined && s.lastReviewSlate !== slate);

/**
 * The weekly review: register new candidates, roll back failing active ones,
 * then activate up to gate.maxNew ready ones (strongest t first). Returns the
 * new state and the journal lines to append.
 */
/**
 * Registers candidates the section hasn't seen, on any pull. Registration
 * only starts a slice's clock (games after it count), so it needn't wait for
 * the weekly review; a slice added mid-week would otherwise sit unseen until
 * then (First TD, Oct 26). Leaves the review stamps alone.
 */
export function register(prev: SectionState, cands: Candidate[], now: string, week: number): { state: SectionState; journal: JournalLine[] } {
  const entries: { [id: string]: Entry } = Object.fromEntries(Object.entries(prev.entries).map(([k, v]) => [k, { ...v }]));
  const fresh: string[] = [];
  for (const c of cands) {
    if (entries[c.id]) continue;
    entries[c.id] = { id: c.id, label: c.label, ...(c.parent ? { parent: c.parent } : {}), status: "collecting", registeredAt: now, registeredWeek: week };
    fresh.push(c.label);
  }
  const journal: JournalLine[] = fresh.length ? [{ at: now, week, kind: "registered", text: `Registered ${fresh.length} slice${fresh.length > 1 ? "s" : ""}; only games after today count toward them.` }] : [];
  // A collecting slice whose definition is gone can never gather evidence; drop it.
  // Live and rolled-back ones keep their record. An empty list is a failed
  // read, not a retirement, so nothing goes then.
  const ids = new Set(cands.map((c) => c.id));
  const gone = cands.length ? Object.values(entries).filter((e) => e.status === "collecting" && !ids.has(e.id)) : [];
  for (const e of gone) delete entries[e.id];
  if (gone.length) journal.push({ at: now, week, kind: "registered", text: `Retired ${gone.length} slice${gone.length > 1 ? "s" : ""} no longer defined: ${gone.map((e) => e.label).join(", ")}.` });
  return { state: { ...prev, entries }, journal };
}

export function review(gate: Gate, prev: SectionState, cands: Candidate[], now: string, week: number, slate?: string): { state: SectionState; journal: JournalLine[]; evidence: Map<string, Evidence> } {
  const reg = register(prev, cands, now, week);
  const entries = reg.state.entries;
  const journal: JournalLine[] = [...reg.journal];
  const byId = new Map(cands.map((c) => [c.id, c]));

  const ev = new Map<string, Evidence>();
  for (const e of Object.values(entries)) {
    const c = byId.get(e.id);
    if (c) ev.set(e.id, evidence(gate, c, e.registeredAt, e.parent ? byId.get(e.parent) : undefined));
  }

  let rolled = 0;
  for (const e of Object.values(entries)) {
    if (e.status !== "active") continue;
    const c = byId.get(e.id);
    if (!c) continue;
    const since = evidence(gate, c, e.activatedAt!);
    if (since.games >= gate.rollbackGames && since.t <= -gate.rollbackT) {
      Object.assign(e, { status: "rolled-back", endedAt: now, endedWeek: week, reason: `lost since going live: ${since.games} games, ${since.units}u, t ${since.t}` });
      journal.push({ at: now, week, kind: "rolled back", id: e.id, text: `Rolled back ${e.label}: ${e.reason}.` });
      rolled++;
    }
  }

  const activeIds = new Set(Object.values(entries).filter((e) => e.status === "active").map((e) => e.id));
  const ready = Object.values(entries)
    .filter((e) => e.status === "collecting" && ev.get(e.id)?.ready && !(e.parent && activeIds.has(e.parent)))
    .sort((a, b) => ev.get(b.id)!.t - ev.get(a.id)!.t)
    // gate.maxNew is per section week, however many reviews the week has.
    .slice(0, Math.max(0, gate.maxNew - Object.values(entries).filter((e) => e.activeWeek === week && e.activatedAt).length));
  for (const e of ready) {
    const x = ev.get(e.id)!;
    Object.assign(e, { status: "active", activatedAt: now, activeWeek: week, activation: { t: x.t, games: x.games, bets: x.bets, units: x.units } });
    journal.push({ at: now, week, kind: "activated", id: e.id, text: `Activated ${e.label}: ${x.bets} bets over ${x.games} games, ${x.units >= 0 ? "+" : ""}${x.units}u, t ${x.t}. Bets in it are marked from now on.` });
  }

  const collecting = Object.values(entries).filter((e) => e.status === "collecting");
  const best = collecting.map((e) => ev.get(e.id)).filter((x): x is Evidence => !!x && x.games > 0).sort((a, b) => b.t - a.t)[0];
  journal.push({
    at: now,
    week,
    kind: "review",
    text: `Reviewed ${Object.keys(entries).length} slices: ${Object.values(entries).filter((e) => e.status === "active").length} active, ${collecting.length} collecting${ready.length ? `, ${ready.length} activated` : ""}${rolled ? `, ${rolled} rolled back` : ""}.${
      best ? ` Closest: ${entries[best.id].label} (${best.checks.filter((c) => !c.pass).map((c) => c.note).join("; ") || "ready"}).` : " No games since registration yet."
    }`,
  });
  return { state: { ...prev, entries, lastReviewAt: now, lastReviewWeek: week, ...(slate ? { lastReviewSlate: slate } : {}) }, journal, evidence: ev };
}

/** Active ids, for marking this week's bets. */
export const activeIds = (s: SectionState) => Object.values(s.entries).filter((e) => e.status === "active").map((e) => e.id);

// ------------------------------------------------------------------ gates

/**
 * Props (NFL and NBA). About 50 slices per section are checked at once, so
 * the t bar is the one-sided 99% value (2.33), not Picks' 1.645: at 1.645 two
 * or three slices would clear by luck every few weeks. 30 games over 3 weeks
 * and 100 bets, the same sample sizes the old slice system and Picks used.
 */
export const PROPS_GATE: Gate = {
  minGames: 30,
  minWeeks: 3,
  minBets: 100,
  minWins: 0,
  minT: 2.33,
  minPairedT: 1.645,
  maxNew: 2,
  ddSd: 3,
  ddSlack: 2,
  moveMin: 20,
  rollbackGames: 20,
  rollbackT: 1.645,
};

/**
 * First TD at Kalshi's ask. One event per game and long prices: most bets
 * lose and a single +900 hit swings a slice, so it needs twice the games,
 * four weeks, and 12 actual winners before any t means anything. Only games
 * with saved Kalshi prices count. One activation per review.
 */
export const FTD_GATE: Gate = {
  minGames: 60,
  minWeeks: 4,
  minBets: 60,
  minWins: 12,
  minT: 2.33,
  minPairedT: 1.645,
  maxNew: 1,
  ddSd: 3,
  ddSlack: 5,
  moveMin: 20,
  rollbackGames: 30,
  rollbackT: 1.645,
};

/**
 * NFL Anytime TD at DraftKings' price. Prices run -200 to +600, between props
 * and first TD, and a game has 10 to 20 bets that move together (a shootout
 * lifts every over), so it takes the props sample sizes plus 25 actual winners.
 */
export const ATTD_GATE: Gate = {
  minGames: 30,
  minWeeks: 3,
  minBets: 100,
  minWins: 25,
  minT: 2.33,
  minPairedT: 1.645,
  maxNew: 2,
  ddSd: 3,
  ddSlack: 3,
  moveMin: 20,
  rollbackGames: 20,
  rollbackT: 1.645,
};

// ------------------------------------------------------------------- views

export interface EntryView extends Entry {
  /** Evidence since it registered, judged against the gate. */
  ev?: Evidence;
  /** Record since it went live (active or rolled back). */
  live?: { bets: number; w: number; l: number; p: number; units: number; games: number };
}

export interface SectionView {
  section: string;
  gate: Gate;
  lastReviewAt?: string;
  lastReviewWeek?: number;
  entries: EntryView[];
  journal: JournalLine[];
}

/** What a page shows for a section, computed fresh from the saved state and today's data. */
export function sectionView(gate: Gate, s: SectionState, cands: Candidate[], journal: JournalLine[]): SectionView {
  const byId = new Map(cands.map((c) => [c.id, c]));
  // A slice whose definition was retired never gathers evidence again; only a live one (its record) stays in view.
  const entries = Object.values(s.entries).filter((e) => byId.has(e.id) || e.activatedAt).map((e): EntryView => {
    const c = byId.get(e.id);
    if (!c) return e;
    const ev = evidence(gate, c, e.registeredAt, e.parent ? byId.get(e.parent) : undefined);
    if (!e.activatedAt) return { ...e, ev };
    const bets = c.bets.filter((b) => b.at >= e.activatedAt! && (!e.endedAt || b.at < e.endedAt));
    const w = bets.filter((b) => b.net > 0).length;
    const l = bets.filter((b) => b.net < 0).length;
    return { ...e, ev, live: { bets: bets.length, w, l, p: bets.length - w - l, units: r2(bets.reduce((a, b) => a + b.net, 0)), games: new Set(bets.map((b) => b.game)).size } };
  });
  return { section: s.section, gate, lastReviewAt: s.lastReviewAt, lastReviewWeek: s.lastReviewWeek, entries, journal };
}

/** Bets that counted while a slice was live, for money charts. */
export function liveBets(s: SectionState, cands: Candidate[]): Bet[] {
  const byId = new Map(cands.map((c) => [c.id, c]));
  return Object.values(s.entries).flatMap((e) =>
    e.activatedAt ? (byId.get(e.id)?.bets ?? []).filter((b) => b.at >= e.activatedAt! && (!e.endedAt || b.at < e.endedAt)) : [],
  );
}
