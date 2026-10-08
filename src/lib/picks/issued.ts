// What the Wednesday email actually issued. Pure.
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
}

/** The one selection the email renders and the issued record stores. */
export function selectForEmail(r: PicksReport, playLimit: number, suLimit: number): EmailSelection {
  const tiered = r.board.filter((g) => g.tier === "t1" || g.tier === "t2");
  const plays = tiered
    .filter((g) => g.basis === "reference" && g.side && g.homeLine !== undefined)
    .sort((a, b) => (a.tier === b.tier ? (b.read?.avgEdge ?? 0) - (a.read?.avgEdge ?? 0) : a.tier === "t1" ? -1 : 1));
  const method = r.su.best?.id ?? "avg";
  const su = r.board
    .flatMap((g) => {
      const p = suPick(method, g.sam, g.david, g.ref?.line);
      return p ? [{ g, ...p, band: marginLabel(r.league, marginBand(r.league, p.margin)) }] : [];
    })
    .sort((x, y) => y.margin - x.margin);
  return {
    league: r.league,
    plays,
    shownPlays: Math.min(playLimit, plays.length),
    sourceOnly: tiered.length - plays.length,
    waiting: r.board.filter((g) => g.tier === "wait").length,
    su,
    shownSu: Math.min(suLimit, su.length),
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
      basis: g.basis,
      ref: g.ref,
      pemPick: g.pemPick,
      shownInEmail: i < sel.shownPlays,
    })),
    su: sel.su.map((x, i) => ({
      home: x.g.home,
      away: x.g.away,
      side: x.side,
      margin: Math.round(x.margin * 10) / 10,
      band: x.band,
      shownInEmail: i < sel.shownSu,
    })),
    unverified: [],
  };
}

// ------------------------------------------------------------------ grading

export interface IssuedWeek {
  week: number;
  provenance: IssuedRecord["provenance"];
  rule: string | null;
  t1: Record;
  t2: Record;
  su: { w: number; l: number };
  pending: number;
  unverified: string[];
}

/** Only what the email showed counts as sent. */
export function gradeIssued(
  records: IssuedRecord[],
  finals: Map<string, { home: number; away: number }>,
): IssuedWeek[] {
  return records
    .slice()
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
      const pending = sent.filter((p) => !finals.has(key({ week: rec.week, home: p.home, away: p.away }))).length;
      return {
        week: rec.week,
        provenance: rec.provenance,
        rule: rec.rule?.label ?? null,
        t1: tally(res("t1")),
        t2: tally(res("t2")),
        su: { w, l },
        pending,
        unverified: rec.unverified,
      };
    });
}

/** Closing-line value of the plays as sent, by tier. */
export function issuedClv(records: IssuedRecord[], closes: Map<string, ClosingLine>) {
  const at = (tier: "t1" | "t2") =>
    records.flatMap((rec) =>
      rec.plays.flatMap((p) => {
        const c = closes.get(key({ week: rec.week, home: p.home, away: p.away }))?.close;
        return p.shownInEmail && p.tier === tier && c !== null && c !== undefined
          ? [clvPoints(p.side, p.homeLine, c)]
          : [];
      }),
    );
  return { t1: at("t1"), t2: at("t2") };
}

/** Every game an issued record needs a final or a close for. */
export function issuedGames(records: IssuedRecord[]): { week: number; home: string; away: string }[] {
  return records.flatMap((rec) => [...rec.plays, ...rec.su].map((p) => ({ week: rec.week, home: p.home, away: p.away })));
}
