// Learner slices for the three Props sections that had none (Jack,
// 2026-10-26): NFL Anytime TD, NBA lottos and NBA King of the Court. Same
// engine as the other sections (lib/learning/engine.ts): every slice is
// tracked from the day a review first sees it, on later games only, and goes
// live only when it clears its gate. Pure.
//
// What a bet is in each:
// - Anytime TD: one unit on a player's anytime TD at DraftKings' price when our
//   chance beats its break-even (by slice). The unit of evidence is the game.
// - Lottos: one unit on a long-shot "N+" rung (+250 to +2000) where our chance
//   times the payout beats 1 (by slice), and the nightly 3-leg ticket. The
//   unit is the game (rungs) or the night (tickets).
// - King of the Court: the crown itself has no price (the pool is shared and
//   its backers unknown), so the learner tracks the prop we would tag: the
//   player's biggest model edge priced -200 or longer, at DK's price, by how
//   likely we made him to lead the slate. The unit is the night.
//
//   attdCandidates([{ slug, week, at, rows, result }]) -> [{ id: "attd:value", bets: [...] }, ...]

import type { Bet, Candidate, Entry } from "@/lib/learning/engine";
import { implied, nbaWeek, payout } from "@/lib/props/parse";
import type { AttdGraded } from "./nfl/anytime";
import { STAKE, type Rung, type Ticket } from "./nba/lotto";
import type { OurStoredProps } from "./nba/store";
import type { KotcNight } from "./nba/kotc-store";

export const SECTIONS = {
  nflAttd: "nfl-attd-ours",
  nbaLotto: "nba-lotto-ours",
  nbaKotc: "nba-kotc-ours",
} as const;

const r3 = (x: number) => Math.round(x * 1000) / 1000;

// ------------------------------------------------------------- Anytime TD

type AttdKeep = (ours: number, price: number) => boolean;

export const ATTD_SLICES: [string, string, AttdKeep][] = [
  ["attd:value", "Our chance above DK's break-even", (o, p) => o > implied(p)],
  ["attd:edge5", "Above DK's break-even by 5+ points (the tab's edge rule)", (o, p) => o >= implied(p) + 0.05],
  ["attd:edge10", "Above DK's break-even by 10+ points", (o, p) => o >= implied(p) + 0.1],
  ["attd:short", "Priced shorter than +150, ours above it", (o, p) => p < 150 && o > implied(p)],
  ["attd:long", "Priced +150 or longer, ours above it", (o, p) => p >= 150 && o > implied(p)],
];

/** Graded Anytime TD boards (with kickoff) into the engine's candidates. Players who didn't play are void and left out. */
export function attdCandidates(games: (AttdGraded & { at: string })[]): Candidate[] {
  return ATTD_SLICES.map(([id, label, keep]) => ({
    id,
    label,
    ...(id === "attd:value" ? {} : { parent: "attd:value" }),
    bets: games.flatMap((g) =>
      g.rows.flatMap((r): Bet[] => {
        const t = g.result[r.key];
        if (r.dk === undefined || t === null || t === undefined || !keep(r.anytime, r.dk)) return [];
        return [{ game: g.slug, week: g.week, at: g.at, net: r3(t > 0 ? payout(r.dk) : -1) }];
      }),
    ),
  }));
}

// ----------------------------------------------------------------- Lottos

type RungKeep = (r: Rung) => boolean;

export const LOTTO_SLICES: [string, string, RungKeep][] = [
  ["lotto:value", "Every long rung with value at our chance", (r) => r.ev > 0],
  ["lotto:value10", "Value 0.10+ (10 cents a dollar at our number)", (r) => r.ev >= 0.1],
  ["lotto:short", "Priced +250 to +399", (r) => r.ev > 0 && r.over < 400],
  ["lotto:mid", "Priced +400 to +699", (r) => r.ev > 0 && r.over >= 400 && r.over < 700],
  ["lotto:long", "Priced +700 or longer", (r) => r.ev > 0 && r.over >= 700],
  ["lotto:pts", "Points rungs", (r) => r.ev > 0 && r.stat === "pts"],
  ["lotto:reb", "Rebounds rungs", (r) => r.ev > 0 && r.stat === "reb"],
  ["lotto:ast", "Assists rungs", (r) => r.ev > 0 && r.stat === "ast"],
  ["lotto:threes", "Threes rungs", (r) => r.ev > 0 && r.stat === "threes"],
];

/** Graded rungs (with kickoff) and nightly tickets into candidates. Season sets the week numbers. */
export function lottoCandidates(rungs: Rung[], tickets: Ticket[], season: number): Candidate[] {
  const graded = rungs.filter((r) => r.hit === true || r.hit === false);
  const rungSlices = LOTTO_SLICES.map(([id, label, keep]): Candidate => ({
    id,
    label,
    ...(id === "lotto:value" ? {} : { parent: "lotto:value" }),
    bets: graded.filter(keep).map((r) => ({ game: r.game, week: nbaWeek(new Date(r.at), season), at: r.at, net: r3(r.hit ? payout(r.over) : -1) })),
  }));
  // The ticket at its real stake: one per night, so it needs the long gate's patience.
  const ticket: Candidate = {
    id: "lotto:ticket",
    label: `The nightly 3-leg ticket (${STAKE}u)`,
    bets: tickets
      .filter((t) => t.outcome !== null)
      .map((t) => {
        const at = graded.find((r) => r.date === t.date)?.at ?? `${t.date}T23:00:00.000Z`;
        return { game: `ticket:${t.date}`, week: nbaWeek(new Date(at), season), at, net: r3(t.outcome === "W" ? STAKE * payout(t.price) : -STAKE) };
      }),
  };
  return [...rungSlices, ticket];
}

// ------------------------------------------------------- King of the Court

/** DK's rule for the tagged prop. */
export const KOTC_QUALIFIES = -200;
/** NBA games a player needs this season before his prop edge counts (as the props board). */
const CARD_GAMES = 3;

/**
 * The prop we would tag for a player on a night: his biggest model edge priced
 * -200 or longer, graded from the board's result (null when he has none, the
 * game isn't graded yet, or he didn't play).
 */
export function taggedProp(boards: OurStoredProps[], name: string): { id: string; net: number } | null {
  let best: { board: OurStoredProps; id: string; gap: number } | null = null;
  for (const b of boards)
    for (const m of b.game.markets) {
      if (m.player !== name || !m.clears || !m.side || m.gap === null) continue;
      if ((b.extra[m.id]?.games ?? 0) < CARD_GAMES) continue;
      const price = m.books[0]?.[m.side];
      if (price === null || price === undefined || price < KOTC_QUALIFIES) continue;
      if (!best || m.gap > best.gap) best = { board: b, id: m.id, gap: m.gap };
    }
  if (!best || !best.board.result) return null;
  const play = best.board.result.markets.find((x) => x.id === best.id)?.play;
  return play ? { id: best.id, net: play.net } : null;
}

const KOTC_SLICES: [string, string, number][] = [
  ["kotc:top10", "Tag the prop of anyone in our top 10", 10],
  ["kotc:top5", "Our top 5", 5],
  ["kotc:top3", "Our top 3", 3],
  ["kotc:fav", "Our favorite only", 1],
];

/** Graded nights into candidates: each night's tagged props for our top N, at DK's prices. */
export function kotcCandidates(nights: KotcNight[], boards: OurStoredProps[], season: number): Candidate[] {
  const graded = nights.filter((n) => n.result);
  return KOTC_SLICES.map(([id, label, top]) => ({
    id,
    label,
    ...(id === "kotc:top10" ? {} : { parent: "kotc:top10" }),
    bets: graded.flatMap((n) => {
      const mine = boards.filter((b) => n.games.some((g) => g.id === b.espnId));
      return n.board.rows.slice(0, top).flatMap((row): Bet[] => {
        const t = taggedProp(mine, row.name);
        return t ? [{ game: n.date, week: nbaWeek(new Date(n.firstTip), season), at: n.firstTip, net: r3(t.net) }] : [];
      });
    }),
  }));
}

// --------------------------------------------------- live slices mark bets
//
// Jack, 2026-10-26: these three learn like the rest, so a slice that clears its
// gate changes the board: from the moment it went live, a play it keeps is a
// bet (the card says so), not a tracked edge. A play that started before the
// slice went live was never bet, whatever the slice says now. A rolled-back
// slice stops marking. Pure.

type LiveEntry = Pick<Entry, "id" | "status" | "activatedAt">;

/** Ids of slices live for a play starting at `at`. */
const liveFor = (entries: LiveEntry[], at: string | undefined) =>
  new Set(entries.filter((e) => e.status === "active" && e.activatedAt && at && Date.parse(at) >= Date.parse(e.activatedAt)).map((e) => e.id));

/** Anytime TD: a live slice keeps this player at DK's price. */
export function attdStaked(entries: LiveEntry[], kickoff: string | undefined, ours: number, price: number | undefined): boolean {
  if (price === undefined) return false;
  const live = liveFor(entries, kickoff);
  return ATTD_SLICES.some(([id, , keep]) => live.has(id) && keep(ours, price));
}

/** Lottos: a live rung slice keeps this rung. */
export function rungStaked(entries: LiveEntry[], r: Pick<Rung, "over" | "ev" | "stat" | "at">): boolean {
  const live = liveFor(entries, r.at);
  return LOTTO_SLICES.some(([id, , keep]) => live.has(id) && keep(r as Rung));
}

/** Lottos: the nightly ticket's slice is live for a night tipping at `at`. */
export const ticketStaked = (entries: LiveEntry[], at: string | undefined) => liveFor(entries, at).has("lotto:ticket");

/** King of the Court: how many of our top players get their prop bet tonight (the widest live slice), 0 when none. */
export function kotcStakedTop(entries: LiveEntry[], firstTip: string): number {
  const live = liveFor(entries, firstTip);
  return Math.max(0, ...KOTC_SLICES.filter(([id]) => live.has(id)).map(([, , top]) => top));
}
