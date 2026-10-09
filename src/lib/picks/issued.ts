// What the picks emails actually issued. Pure.
//
// The live record used to grade a board snapshot that the report kept
// rewriting until the email froze it, and the snapshot held every Tier 1 and
// 2 game (including ones the email cut off), the models' average winner (not
// the straight-up method the email followed) and no side or line for a PEM
// split play. An issued record is built from the same selection the email
// renders, once, at send time, and never rewritten. Board snapshots stay as
// research history; only issued records feed "plays as sent".

import type { ClosingLine } from "./closing";
import { clvPoints } from "./closing";
import {
  type BoardGame,
  type CutTest,
  type Record,
  type Result,
  type RefLine,
  grade,
  key,
  marginBand,
  marginLabel,
  suPick,
  tally,
} from "./engine";
import type { League } from "./parse";
import type { PicksReport } from "./report";
import { type OU, type TotalsBoardGame, type TotalsTest, clvTotal, gradeTotal } from "./totals";
import { type Slot, type UpdateDiff, firstSends } from "./update";

/** Bump when the tiering logic changes, so a record says which logic issued it. */
export const RULE_VERSION = "2026-10-08 reference-line agreement, Tier 2 on added games";

export interface IssuedPlay {
  home: string;
  away: string;
  tier: "t1" | "t2";
  side: "home" | "away";
  /** Home-side line the play was issued at. */
  homeLine: number;
  play: string;
  basis: "reference" | "source";
  /** The quote the play was judged at (reference basis only). */
  ref?: RefLine;
  pemPick?: boolean;
  /** In the email itself, or only on the page ("plus N more"). */
  shownInEmail: boolean;
  /** Units risked. Absent on plays sent before units existed. */
  units?: number;
  /** American price on the quote it was sent with (always quoted; no stake without one). */
  price?: number;
  priceSource?: "quoted";
  /** The estimated win probability the stake was sized from (an estimate; see staking.ts). */
  p?: number;
  kickoff?: string;
}

export interface IssuedSu {
  home: string;
  away: string;
  side: "home" | "away";
  margin: number;
  /** As printed, e.g. "By 6+". */
  band: string;
  shownInEmail: boolean;
}

export interface IssuedTotal {
  home: string;
  away: string;
  side: OU;
  /** The total the play was issued at. */
  line: number;
  play: string;
  source: string;
  fetchedAt: string;
  shownInEmail: boolean;
  units?: number;
  price?: number;
  priceSource?: "quoted";
  p?: number;
  kickoff?: string;
}

/** Legacy shape: parlays were briefly sized on 2026-10-08 but never sent. Kept for reading only. */
export interface IssuedParlay {
  legs: { home: string; away: string; side: "home" | "away"; homeLine: number; price: number }[];
  /** Units risked. */
  units: number;
  /** Decimal payout per unit risked, as quoted from the legs' prices. */
  decimal: number;
  shownInEmail: boolean;
}

export interface IssuedCut {
  id: string;
  label: string;
  test: CutTest | null;
  /** The evidence the cut was chosen on, as it stood at issue. */
  evidence: Record | null;
}

export interface IssuedRecord {
  league: League;
  season: number;
  week: number;
  /** Which send: Tuesday's card, or the Saturday/Sunday game-day update. Absent means Tuesday. */
  slot?: Slot;
  /**
   * "pending": written before the email is sent (the intent), so a failure
   * after sending can never leave a sent email with no record; "sent" once
   * the send is confirmed. Absent on records from before 2026-10-09 (sent).
   * Pending records count toward exposure but are not graded until sent.
   */
  status?: "pending" | "sent" | "unconfirmed";
  /** The email idempotency key the send used; a retry reuses it, so it can't duplicate. */
  idempotencyKey?: string;
  /** The picks policy the card was made under (policy.ts). */
  policyId?: string;
  issuedAt: string;
  /** "issued": written at send time. "recovered": rebuilt later from the delivered email. */
  provenance: "issued" | "recovered";
  emailId?: string;
  subject: string;
  ruleVersion: string;
  rule: IssuedCut | null;
  second: IssuedCut | null;
  suMethod: { id: string; label: string };
  plays: IssuedPlay[];
  su: IssuedSu[];
  /** Over/under plays (only when a totals rule qualified that week). Absent on older records. */
  totals?: IssuedTotal[];
  /** Two-leg parlays sent with the card (Tuesday only). */
  parlays?: IssuedParlay[];
  totalsRule?: { id: string; label: string; test: TotalsTest; evidence: Record } | null;
  /** Anything the record cannot vouch for. */
  unverified: string[];
}

export interface EmailSelection {
  league: League;
  /** Current recommendations: Tier 1 and 2 at a reference line, best first. */
  plays: BoardGame[];
  shownPlays: number;
  /** Tier 1 and 2 games with no current quote: research only, never issued. */
  sourceOnly: number;
  /** Games a PEM-dependent tier is waiting on. */
  waiting: number;
  su: { g: BoardGame; side: "home" | "away"; margin: number; band: string }[];
  shownSu: number;
  /** Over/under plays under a qualifying totals rule, biggest edge first. */
  totals: TotalsBoardGame[];
  shownTotals: number;
  /** Tier 1/2 games whose quoted price sizes under the 1u minimum, or with no quoted price. */
  pricedOut: BoardGame[];
  /** Tier 1/2 games worth a bet that the weekly or per-game limits left out. */
  overBudget: BoardGame[];
  /** Tier 1/2 games worth a bet but held until a later send (hold.ts): early looks, never issued here. */
  early: BoardGame[];
}

/** The one selection the email renders and the issued record stores. */
export function selectForEmail(r: PicksReport, playLimit: number, suLimit: number, totalsLimit = 8): EmailSelection {
  const tiered = r.board.filter((g) => g.tier === "t1" || g.tier === "t2");
  const atRef = tiered.filter((g) => g.basis === "reference" && g.side && g.homeLine !== undefined);
  const pricedOut = atRef.filter((g) => !g.want);
  const overBudget = atRef.filter((g) => !!g.want && !g.stake);
  // Held until game day (hold.ts): shown as early looks, never issued here.
  const early = atRef.filter((g) => !!g.stake && !!g.held).sort((a, b) => (a.ref?.kickoff ?? "").localeCompare(b.ref?.kickoff ?? ""));
  const plays = atRef
    .filter((g) => !!g.stake && !g.held)
    .sort((a, b) => (a.tier === b.tier ? (b.read?.avgEdge ?? 0) - (a.read?.avgEdge ?? 0) : a.tier === "t1" ? -1 : 1));
  const method = r.su.best?.id ?? "avg";
  const su = r.board
    .flatMap((g) => {
      const p = suPick(method, g.sam, g.david, g.ref?.line);
      return p ? [{ g, ...p, band: marginLabel(r.league, marginBand(r.league, p.margin)) }] : [];
    })
    .sort((x, y) => y.margin - x.margin);
  const totals = (r.totals?.board ?? [])
    .filter((g) => g.tier === "t1" && g.side && g.line !== undefined && g.ref && !!g.stake && !g.held)
    .sort((a, b) => (b.read?.minEdge ?? 0) - (a.read?.minEdge ?? 0));
  return {
    league: r.league,
    plays,
    shownPlays: Math.min(playLimit, plays.length),
    sourceOnly: tiered.length - atRef.length,
    pricedOut,
    overBudget,
    early,
    waiting: r.board.filter((g) => g.tier === "wait").length,
    su,
    shownSu: Math.min(suLimit, su.length),
    totals,
    shownTotals: Math.min(totalsLimit, totals.length),
  };
}

export function toIssued(
  r: PicksReport,
  sel: EmailSelection,
  meta: { issuedAt: string; emailId?: string; subject: string },
): IssuedRecord {
  const cut = (c: PicksReport["strategies"]["rule"]): IssuedCut | null =>
    c ? { id: c.id, label: c.label, test: c.test, evidence: c.record } : null;
  return {
    league: r.league,
    season: r.season,
    week: r.week as number,
    issuedAt: meta.issuedAt,
    provenance: "issued",
    emailId: meta.emailId,
    subject: meta.subject,
    ruleVersion: RULE_VERSION,
    policyId: r.policy?.id,
    rule: cut(r.strategies.rule),
    second: cut(r.strategies.second),
    suMethod: { id: r.su.best?.id ?? "avg", label: r.su.best?.label ?? "Average of both models" },
    plays: sel.plays.map((g, i) => ({
      home: g.home,
      away: g.away,
      tier: g.tier as "t1" | "t2",
      side: g.side!,
      homeLine: g.homeLine!,
      play: g.play,
      basis: "reference" as const,
      ref: g.ref,
      pemPick: g.pemPick,
      shownInEmail: i < sel.shownPlays,
      units: g.stake,
      price: g.price,
      priceSource: "quoted" as const,
      p: g.p,
      kickoff: g.ref?.kickoff,
    })),
    su: sel.su.map((x, i) => ({
      home: x.g.home,
      away: x.g.away,
      side: x.side,
      margin: Math.round(x.margin * 10) / 10,
      band: x.band,
      shownInEmail: i < sel.shownSu,
    })),
    totals: sel.totals.map((g, i) => ({
      home: g.home,
      away: g.away,
      side: g.side!,
      line: g.line!,
      play: g.play!,
      source: g.ref!.source,
      fetchedAt: g.ref!.fetchedAt,
      shownInEmail: i < sel.shownTotals,
      units: g.stake,
      price: g.price,
      priceSource: "quoted" as const,
      p: g.p,
      kickoff: g.ref!.kickoff,
    })),
    totalsRule: r.totals?.backtest.rule
      ? { id: r.totals.backtest.rule.id, label: r.totals.backtest.rule.label, test: r.totals.backtest.rule.test, evidence: r.totals.backtest.rule.record }
      : null,
    unverified: [],
  };
}

/** A game-day update: only the games no earlier email this week sent. */
export function toIssuedUpdate(
  r: PicksReport,
  diff: UpdateDiff,
  slot: Exclude<Slot, "tue">,
  meta: { issuedAt: string; emailId?: string; subject: string },
): IssuedRecord {
  const sel: EmailSelection = {
    league: r.league,
    plays: diff.added,
    shownPlays: diff.added.length,
    sourceOnly: 0,
    waiting: 0,
    su: [],
    shownSu: 0,
    totals: diff.addedTotals,
    shownTotals: diff.addedTotals.length,
    pricedOut: [],
    overBudget: [],
    early: [],
  };
  return { ...toIssued(r, sel, meta), slot };
}

// ------------------------------------------------------------------ grading

/** Records whose send is confirmed (pending or unconfirmed intents are exposure, not results). */
export function confirmed(records: IssuedRecord[]): IssuedRecord[] {
  return records.filter((r) => r.status !== "pending" && r.status !== "unconfirmed");
}

export interface IssuedWeek {
  week: number;
  provenance: IssuedRecord["provenance"];
  rule: string | null;
  t1: Record;
  t2: Record;
  /** Over/under plays as sent. */
  totals: Record;
  su: { w: number; l: number };
  pending: number;
  unverified: string[];
}

/** Only what the email showed counts as sent. */
export function gradeIssued(
  records: IssuedRecord[],
  finals: Map<string, { home: number; away: number }>,
): IssuedWeek[] {
  // One row per week: Tuesday's card plus any game-day additions, each game
  // counted once at the line it was first sent.
  const byWeek = new Map<number, IssuedRecord[]>();
  for (const rec of firstSends(confirmed(records))) byWeek.set(rec.week, [...(byWeek.get(rec.week) ?? []), rec]);
  return [...byWeek.values()]
    .map((recs): IssuedRecord => {
      const first = recs[0];
      return {
        ...first,
        provenance: recs.some((x) => x.provenance === "recovered") ? "recovered" : "issued",
        plays: recs.flatMap((x) => x.plays),
        su: recs.flatMap((x) => x.su),
        totals: recs.flatMap((x) => x.totals ?? []),
        unverified: recs.flatMap((x) => x.unverified),
      };
    })
    .sort((a, b) => a.week - b.week)
    .map((rec) => {
      const sent = rec.plays.filter((p) => p.shownInEmail);
      const res = (tier: "t1" | "t2"): Result[] =>
        sent.flatMap((p) => {
          const f = finals.get(key({ week: rec.week, home: p.home, away: p.away }));
          return p.tier === tier && f ? [grade(f, p.homeLine, p.side)] : [];
        });
      let w = 0;
      let l = 0;
      for (const p of rec.su.filter((x) => x.shownInEmail)) {
        const f = finals.get(key({ week: rec.week, home: p.home, away: p.away }));
        if (!f || f.home === f.away) continue;
        if ((p.side === "home") === f.home > f.away) w++;
        else l++;
      }
      const ou = (rec.totals ?? []).filter((p) => p.shownInEmail).flatMap((p) => {
        const f = finals.get(key({ week: rec.week, home: p.home, away: p.away }));
        return f ? [gradeTotal(f.home + f.away, p.line, p.side)] : [];
      });
      const pending = [...sent, ...(rec.totals ?? []).filter((p) => p.shownInEmail)].filter(
        (p) => !finals.has(key({ week: rec.week, home: p.home, away: p.away })),
      ).length;
      return {
        week: rec.week,
        provenance: rec.provenance,
        rule: rec.rule?.label ?? null,
        t1: tally(res("t1")),
        t2: tally(res("t2")),
        totals: tally(ou),
        su: { w, l },
        pending,
        unverified: rec.unverified,
      };
    });
}

/** Closing-line value of the plays as sent, by tier. */
export function issuedClv(all: IssuedRecord[], closes: Map<string, ClosingLine>) {
  const records = firstSends(confirmed(all));
  const at = (tier: "t1" | "t2") =>
    records.flatMap((rec) =>
      rec.plays.flatMap((p) => {
        const c = closes.get(key({ week: rec.week, home: p.home, away: p.away }))?.close;
        return p.shownInEmail && p.tier === tier && c !== null && c !== undefined
          ? [clvPoints(p.side, p.homeLine, c)]
          : [];
      }),
    );
  const totals = records.flatMap((rec) =>
    (rec.totals ?? []).flatMap((p) => {
      const c = closes.get(key({ week: rec.week, home: p.home, away: p.away }))?.totalClose;
      return p.shownInEmail && c !== null && c !== undefined ? [clvTotal(p.side, p.line, c)] : [];
    }),
  );
  return { t1: at("t1"), t2: at("t2"), totals };
}

/** Every game an issued record needs a final or a close for. */
export function issuedGames(records: IssuedRecord[]): { week: number; home: string; away: string }[] {
  return records.flatMap((rec) =>
    [...rec.plays, ...rec.su, ...(rec.totals ?? [])].map((p) => ({ week: rec.week, home: p.home, away: p.away })),
  );
}
