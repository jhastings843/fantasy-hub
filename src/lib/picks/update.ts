// Game-day updates: what changed since Tuesday's card, at the current line. Pure.
//
// Tuesday's card goes out as soon as every board is up, because the lines
// move toward the models fastest early in the week (one week measured: by
// Wednesday night the NFL line had moved 0.60 points toward Sam's side, of
// the 0.69 it moved by kickoff). By game day the board has been re-tiered at
// a newer line, so the Saturday (college) and Sunday (NFL) updates say three
// things: which issued plays still qualify and at what number, which no
// longer do and why, and which games qualify now that did not on Tuesday.
//
// A game counts once in the forward record: at the line it was FIRST sent.
// An update only issues games no earlier email this week sent.

import { type BoardGame, key } from "./engine";
import { etDate } from "./hold";
import type { IssuedPlay, IssuedRecord, IssuedTotal } from "./issued";
import type { PicksReport } from "./report";
import type { TotalsBoardGame } from "./totals";

/**
 * Which send issued a record. "tue", "sat", "sun": the old Tuesday card and
 * game-day updates (records before 2026-10-09). "g" + weekday: the daily 9am
 * bets email on that game day (run.ts). Records are ordered by issuedAt.
 */
export type GameDaySlot = "gsun" | "gmon" | "gtue" | "gwed" | "gthu" | "gfri" | "gsat";
export type Slot = "tue" | "sat" | "sun" | GameDaySlot;
export const SLOT_ORDER: Slot[] = ["tue", "sat", "sun"];
export const GAME_DAY_SLOTS: GameDaySlot[] = ["gsun", "gmon", "gtue", "gwed", "gthu", "gfri", "gsat"];

/** Earliest send first: by issue time, the legacy slot order as a tiebreak. */
export const bySendTime = (a: { issuedAt?: string; slot?: Slot }, b: { issuedAt?: string; slot?: Slot }) =>
  (a.issuedAt ?? "").localeCompare(b.issuedAt ?? "") || SLOT_ORDER.indexOf(a.slot ?? "tue") - SLOT_ORDER.indexOf(b.slot ?? "tue");

export interface StillOn {
  sent: IssuedPlay;
  /** Home-side line now. */
  nowLine: number;
  /** Points the number moved in the bettor's favor since it was sent (negative: worse now). */
  moved: number;
  /** Today's quoted price on the same side. */
  nowPrice?: number;
}

export interface Off {
  sent: IssuedPlay;
  reason: string;
}

export interface TotalStillOn {
  sent: IssuedTotal;
  nowLine: number;
  /** Points better (+) or worse (-) for the bettor than when sent. */
  moved: number;
  nowPrice?: number;
}

export interface TotalOff {
  sent: IssuedTotal;
  reason: string;
}

export interface UpdateDiff {
  week: number;
  stillOn: StillOn[];
  /**
   * Advice changed for anyone who has NOT bet yet: the play no longer
   * qualifies at today's line or price. An issued bet stands as sent and is
   * graded as sent; an update never erases or reverses it.
   */
  off: Off[];
  totalsStillOn: TotalStillOn[];
  totalsOff: TotalOff[];
  /** Plays at the current line that no earlier email this week sent. */
  added: BoardGame[];
  /** Of those, games an earlier card listed only on the page ("plus N more"), by key. */
  pageOnly: string[];
  /** Totals plays at the current total that no earlier email sent. */
  addedTotals: TotalsBoardGame[];
  /** Sent plays whose game has kicked off: nothing to act on. */
  kickedOff: number;
  /** Sent plays with no current quote before kickoff (feed gap or stale quotes): can't recheck them now. */
  noQuote: number;
  /** Kept for older readers: kickedOff + noQuote. */
  gone: number;
}

/** Every play sent this week, earliest slot first. */
export function sentThisWeek(records: IssuedRecord[], week: number): { plays: IssuedPlay[]; totals: IssuedTotal[] } {
  const recs = records
    .filter((r) => r.week === week)
    .sort(bySendTime);
  return {
    plays: recs.flatMap((r) => r.plays.filter((p) => p.shownInEmail)),
    totals: recs.flatMap((r) => (r.totals ?? []).filter((p) => p.shownInEmail)),
  };
}

/** Kicked off by the board's say-so, or by the kickoff time the bet was sent with. */
function isStarted(basis: string | undefined, kickoff: string | undefined, now: Date): boolean {
  return basis === "started" || (!!kickoff && new Date(kickoff).getTime() <= now.getTime());
}

export function diffUpdate(r: PicksReport, records: IssuedRecord[], now = new Date()): UpdateDiff {
  const week = r.week as number;
  const sent = sentThisWeek(records, week);
  const board = new Map(r.board.map((g) => [key({ week, home: g.home, away: g.away }), g]));
  // Only a send that carried a stake blocks a new one: an unstaked mention
  // (the old Tuesday card) is superseded by a staked game-day bet. Every sent
  // pick still gets on/off advice, since it may have been bet.
  const staked = sent.plays.filter((p) => !!p.units);
  const sentPlayKeys = new Set(staked.map((p) => key({ week, home: p.home, away: p.away })));
  const stillOn: StillOn[] = [];
  const off: Off[] = [];
  let kickedOff = 0;
  let noQuote = 0;
  const seen = new Set<string>();
  for (const p of sent.plays) {
    const k = key({ week, home: p.home, away: p.away });
    if (seen.has(k)) continue;
    seen.add(k);
    const g = board.get(k);
    // Older records keep the kickoff inside the quote they were sent with.
    if (isStarted(g?.basis, p.kickoff ?? p.ref?.kickoff ?? g?.ref?.kickoff, now)) {
      kickedOff++;
      continue;
    }
    if (!g || g.basis !== "reference") {
      noQuote++;
      continue;
    }
    const bettor = p.side === "home" ? 1 : -1;
    const sameSide = (g.tier === "t1" || g.tier === "t2") && g.side === p.side && g.homeLine !== undefined;
    // Still on means still worth a bet at today's number AND today's price:
    // the policy still wants a stake (limits aside, since this bet is
    // already part of the exposure).
    if (sameSide && (g.want ?? 0) > 0) {
      stillOn.push({ sent: p, nowLine: g.homeLine!, moved: Math.round((g.homeLine! - p.homeLine) * bettor * 10) / 10, nowPrice: g.price });
      continue;
    }
    const reason = sameSide
      ? g.priceSource === "missing"
        ? "No price quoted now: can't confirm it's still worth a bet"
        : `Price now ${g.price! > 0 ? "+" : ""}${g.price}: no longer worth a bet at today's number`
      : g.tier === "split"
        ? "The models now split at the current line"
        : g.tier === "wait"
          ? "Now depends on a PEM line that isn't on file"
          : g.side && g.side !== p.side
            ? "Both models now sit on the other side"
            : `No longer fits ${p.tier === "t1" ? "Tier 1" : "Tier 2"} at the current line`;
    off.push({ sent: p, reason });
  }

  // Issued totals, rechecked the same way.
  const tBoard = new Map((r.totals?.board ?? []).map((g) => [key({ week, home: g.home, away: g.away }), g]));
  const totalsStillOn: TotalStillOn[] = [];
  const totalsOff: TotalOff[] = [];
  const stakedTotals = sent.totals.filter((x) => !!x.units);
  for (const t of sent.totals) {
    const k = key({ week, home: t.home, away: t.away });
    const g = tBoard.get(k);
    const bg = board.get(k);
    if (isStarted(bg?.basis, t.kickoff ?? g?.ref?.kickoff, now)) {
      kickedOff++;
      continue;
    }
    if (!g?.ref) {
      noQuote++;
      continue;
    }
    const better = t.side === "over" ? t.line - g.ref.total : g.ref.total - t.line;
    if (g.tier === "t1" && g.side === t.side && (g.want ?? 0) > 0) {
      totalsStillOn.push({ sent: t, nowLine: g.ref.total, moved: Math.round(better * 10) / 10, nowPrice: g.price });
    } else {
      totalsOff.push({
        sent: t,
        reason:
          g.tier === "t1" && g.side === t.side
            ? `Price now ${g.price ?? "not quoted"}: no longer worth a bet`
            : g.side && g.side !== t.side
              ? "Both models now lean the other way"
              : "No longer fits the totals rule at the current total",
      });
    }
  }

  const added = r.board.filter(
    (g) =>
      (g.tier === "t1" || g.tier === "t2") &&
      !!g.stake &&
      !g.held &&
      g.basis === "reference" &&
      g.side &&
      g.homeLine !== undefined &&
      !sentPlayKeys.has(key({ week, home: g.home, away: g.away })),
  );
  const addedTotals = (r.totals?.board ?? []).filter(
    (g) =>
      g.tier === "t1" &&
      !!g.stake &&
      !g.held &&
      g.side &&
      g.line !== undefined &&
      g.ref &&
      !stakedTotals.some((t) => t.home === g.home && t.away === g.away),
  );
  const unshown = new Set(
    records
      .filter((x) => x.week === week)
      .flatMap((x) => x.plays.filter((p) => !p.shownInEmail).map((p) => key({ week, home: p.home, away: p.away }))),
  );
  const pageOnly = added.map((g) => key({ week, home: g.home, away: g.away })).filter((k) => unshown.has(k));
  return { week, stillOn, off, totalsStillOn, totalsOff, added, pageOnly, addedTotals, kickedOff, noQuote, gone: kickedOff + noQuote };
}

/** Worth an email on its own (Saturday): something new, or something to stop betting. */
export function updateMatters(d: UpdateDiff): boolean {
  return d.added.length > 0 || d.addedTotals.length > 0 || d.off.length > 0 || d.totalsOff.length > 0;
}

/**
 * One game, once. The first STAKED send of a game counts; when none was
 * staked, the first send does. A staked game-day bet therefore supersedes
 * an earlier unstaked mention of the same game (the old unstaked Tuesday
 * card, 2026-10-07), so grading and units both use the bet that carried a
 * stake. Later sends only add games no earlier staked send covered, but a
 * record written by hand could overlap, so the grading guards against it.
 */
export function firstSends(records: IssuedRecord[]): IssuedRecord[] {
  const order = records
    .slice()
    .sort((a, b) => a.week - b.week || bySendTime(a, b));
  type Shown = { shownInEmail: boolean; units?: number; home: string; away: string };
  const pickWinners = <P extends Shown>(get: (r: IssuedRecord) => P[]) => {
    const win = new Map<string, P>();
    for (const rec of order)
      for (const p of get(rec)) {
        if (!p.shownInEmail) continue;
        const k = key({ week: rec.week, home: p.home, away: p.away });
        const cur = win.get(k);
        if (!cur || (!cur.units && p.units)) win.set(k, p);
      }
    return win;
  };
  const plays = pickWinners((r) => r.plays);
  const totals = pickWinners((r) => r.totals ?? []);
  return order.map((rec) => ({
    ...rec,
    plays: rec.plays.filter((p) => !p.shownInEmail || plays.get(key({ week: rec.week, home: p.home, away: p.away })) === p),
    totals: (rec.totals ?? []).filter((p) => !p.shownInEmail || totals.get(key({ week: rec.week, home: p.home, away: p.away })) === p),
  }));
}

/** A diff narrowed to games kicking off on `date` (ET). Pure. */
export function onDate(d: UpdateDiff, date: string): UpdateDiff {
  const today = (k?: string) => !!k && etDate(new Date(k)) === date;
  return {
    ...d,
    added: d.added.filter((g) => today(g.ref?.kickoff)),
    addedTotals: d.addedTotals.filter((g) => today(g.ref?.kickoff)),
    off: d.off.filter((o) => today(o.sent.kickoff ?? o.sent.ref?.kickoff)),
    totalsOff: d.totalsOff.filter((o) => today(o.sent.kickoff)),
    stillOn: d.stillOn.filter((s) => today(s.sent.kickoff ?? s.sent.ref?.kickoff)),
    totalsStillOn: d.totalsStillOn.filter((s) => today(s.sent.kickoff)),
    pageOnly: [],
  };
}

