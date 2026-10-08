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
import type { IssuedPlay, IssuedRecord, IssuedTotal } from "./issued";
import type { PicksReport } from "./report";
import type { TotalsBoardGame } from "./totals";

export type Slot = "tue" | "sat" | "sun";
export const SLOT_ORDER: Slot[] = ["tue", "sat", "sun"];

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
    .sort((a, b) => SLOT_ORDER.indexOf(a.slot ?? "tue") - SLOT_ORDER.indexOf(b.slot ?? "tue"));
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
  const sentPlayKeys = new Set(sent.plays.map((p) => key({ week, home: p.home, away: p.away })));
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
      g.basis === "reference" &&
      g.side &&
      g.homeLine !== undefined &&
      !sentPlayKeys.has(key({ week, home: g.home, away: g.away })),
  );
  const addedTotals = (r.totals?.board ?? []).filter(
    (g) =>
      g.tier === "t1" &&
      !!g.stake &&
      g.side &&
      g.line !== undefined &&
      g.ref &&
      !sent.totals.some((t) => t.home === g.home && t.away === g.away),
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
 * One game, once: the first slot that sent it. Later slots only add games no
 * earlier email sent, but a record written by hand could overlap, so the
 * grading guards against it too.
 */
export function firstSends(records: IssuedRecord[]): IssuedRecord[] {
  const order = records
    .slice()
    .sort((a, b) => a.week - b.week || SLOT_ORDER.indexOf(a.slot ?? "tue") - SLOT_ORDER.indexOf(b.slot ?? "tue"));
  const seen = new Set<string>();
  const seenTotals = new Set<string>();
  return order.map((rec) => ({
    ...rec,
    plays: rec.plays.filter((p) => {
      const k = key({ week: rec.week, home: p.home, away: p.away });
      if (!p.shownInEmail) return true;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    }),
    totals: (rec.totals ?? []).filter((p) => {
      const k = key({ week: rec.week, home: p.home, away: p.away });
      if (!p.shownInEmail) return true;
      if (seenTotals.has(k)) return false;
      seenTotals.add(k);
      return true;
    }),
  }));
}
