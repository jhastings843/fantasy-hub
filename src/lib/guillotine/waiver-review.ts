// The Wednesday look back at the guillotine waiver run.
//
// Tuesday's advisor makes three bets: what the room will pay, who it will pay
// it for, and where that leaves Jack's lineup against everyone else's. This
// grades all three the morning after, from the one feed that knows: Sleeper's
// transactions, failed claims included. The failed claims are the whole point.
// A winning bid says what one team paid; the losing bids under it say what
// the room thought he was worth, and how far off Jack's number was.

import { lineupTotal, projectRoomClaims, type RoomCandidate, type RoomTeam } from "./room-claims";
import type { LineupPlayer } from "./lineup";

export interface ReviewTransaction {
  type?: string;
  status?: string;
  roster_ids?: number[];
  adds?: Record<string, number> | null;
  drops?: Record<string, number> | null;
  settings?: { waiver_bid?: number } | null;
}

export interface ReviewTeam {
  rosterId: number;
  name: string;
  isMine: boolean;
  /** FAAB left AFTER the run. */
  faabLeft: number;
  /** Rostered now, after the run, with this week's points. */
  players: LineupPlayer[];
}

export interface ClaimedPlayer {
  playerId: string;
  name: string;
  position: string;
  winner: string;
  winnerIsMe: boolean;
  price: number;
  /** The best losing bid, which is what the winner actually had to beat. */
  runnerUp: number | null;
  bidders: number;
  myBid: number | null;
  /** What he adds to the winner's lineup this week. */
  gain: number;
}

export interface FieldMove {
  rosterId: number;
  name: string;
  isMine: boolean;
  before: number;
  after: number;
  /** 1 is the lowest projection, the way the chop line counts. */
  rankBefore: number;
  rankAfter: number;
}

export interface WaiverReview {
  leagueName: string;
  week: number;
  teamsAlive: number;
  roomSpent: number;
  claims: ClaimedPlayer[];
  /** Jack's claims that lost, with what won. */
  myLosses: {
    name: string;
    myBid: number;
    price: number | null;
    runnerUp: number | null;
    winner: string | null;
  }[];
  myWins: { name: string; price: number }[];
  field: FieldMove[];
  me: FieldMove | null;
  /**
   * The room-claims model, replayed on the pre-waiver rosters: did it see the
   * field coming? Null when it had nothing to say.
   */
  prediction: {
    predictedMyRank: number;
    actualMyRank: number;
    /** Of the players it expected to be claimed, how many were. */
    called: number;
    predicted: number;
    missed: string[];
  } | null;
  /** Plain-language takeaways, most important first. */
  lessons: string[];
}

function rankLowFirst(rows: { rosterId: number; total: number }[]): Map<number, number> {
  const sorted = [...rows].sort((a, b) => a.total - b.total);
  return new Map(sorted.map((r, i) => [r.rosterId, i + 1]));
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function reviewWaivers(input: {
  leagueName: string;
  week: number;
  run: ReviewTransaction[];
  teams: ReviewTeam[];
  /** Every player the run touched or could have, keyed by id. */
  players: Record<string, RoomCandidate>;
  rosterPositions: string[];
}): WaiverReview {
  const { run, teams, players, rosterPositions } = input;
  const me = teams.find((t) => t.isMine) ?? null;
  const teamById = new Map(teams.map((t) => [t.rosterId, t]));
  const waivers = run.filter((t) => t.type === "waiver");
  const won = waivers.filter((t) => t.status === "complete");
  const bid = (t: ReviewTransaction) => t.settings?.waiver_bid ?? 0;
  const nameOf = (id: string) => players[id]?.name ?? id;

  // --- Rosters before the run: undo every winning claim ---
  const before = new Map(teams.map((t) => [t.rosterId, [...t.players]]));
  for (const tx of won) {
    const rosterId = tx.roster_ids?.[0];
    if (rosterId == null || !before.has(rosterId)) continue;
    const list = before.get(rosterId)!;
    for (const id of Object.keys(tx.adds ?? {})) {
      const i = list.findIndex((p) => p.playerId === id);
      if (i >= 0) list.splice(i, 1);
    }
    for (const id of Object.keys(tx.drops ?? {})) {
      const p = players[id];
      if (p) list.push(p);
    }
  }

  // --- The field, before and after ---
  const totals = teams.map((t) => ({
    rosterId: t.rosterId,
    before: lineupTotal(before.get(t.rosterId) ?? [], rosterPositions),
    after: lineupTotal(t.players, rosterPositions),
  }));
  const rankBefore = rankLowFirst(totals.map((t) => ({ rosterId: t.rosterId, total: t.before })));
  const rankAfter = rankLowFirst(totals.map((t) => ({ rosterId: t.rosterId, total: t.after })));
  const field: FieldMove[] = totals
    .map((t) => ({
      rosterId: t.rosterId,
      name: teamById.get(t.rosterId)!.name,
      isMine: teamById.get(t.rosterId)!.isMine,
      before: round1(t.before),
      after: round1(t.after),
      rankBefore: rankBefore.get(t.rosterId)!,
      rankAfter: rankAfter.get(t.rosterId)!,
    }))
    .sort((a, b) => a.rankAfter - b.rankAfter);
  const myMove = field.find((f) => f.isMine) ?? null;

  // --- Every contested player ---
  const byPlayer = new Map<string, ReviewTransaction[]>();
  for (const tx of waivers) {
    for (const id of Object.keys(tx.adds ?? {})) {
      byPlayer.set(id, [...(byPlayer.get(id) ?? []), tx]);
    }
  }
  const claims: ClaimedPlayer[] = [];
  for (const [playerId, txs] of byPlayer) {
    const winning = txs.find((t) => t.status === "complete");
    if (!winning) continue;
    const winnerId = winning.roster_ids?.[0];
    const winner = winnerId != null ? teamById.get(winnerId) : undefined;
    const losing = txs.filter((t) => t !== winning).map(bid).sort((a, b) => b - a);
    const mine = txs.find((t) => me && t.roster_ids?.[0] === me.rosterId);
    const gainRow = totals.find((t) => t.rosterId === winnerId);
    claims.push({
      playerId,
      name: nameOf(playerId),
      position: players[playerId]?.position ?? "",
      winner: winner?.name ?? "Unknown",
      winnerIsMe: winner?.isMine ?? false,
      price: bid(winning),
      runnerUp: losing[0] ?? null,
      bidders: new Set(txs.map((t) => t.roster_ids?.[0])).size,
      myBid: mine ? bid(mine) : null,
      gain: gainRow ? round1(gainRow.after - gainRow.before) : 0,
    });
  }
  claims.sort((a, b) => b.price - a.price || b.bidders - a.bidders);

  const myLosses = me
    ? waivers
        .filter((t) => t.status !== "complete" && t.roster_ids?.[0] === me.rosterId)
        .flatMap((t) =>
          Object.keys(t.adds ?? {}).map((id) => {
            const c = claims.find((x) => x.playerId === id);
            return {
              name: nameOf(id),
              myBid: bid(t),
              price: c?.price ?? null,
              runnerUp: c?.runnerUp ?? null,
              winner: c?.winner ?? null,
            };
          }),
        )
    : [];
  const myWins = claims.filter((c) => c.winnerIsMe).map((c) => ({ name: c.name, price: c.price }));

  // --- Did the room-claims model see it coming? ---
  let prediction: WaiverReview["prediction"] = null;
  if (me) {
    const claimedIds = new Set(claims.map((c) => c.playerId));
    const rostered = new Set([...before.values()].flat().map((p) => p.playerId));
    const wire = Object.values(players).filter((p) => !rostered.has(p.playerId));
    const rivals: RoomTeam[] = teams
      .filter((t) => !t.isMine)
      .map((t) => {
        const spent = won
          .filter((tx) => tx.roster_ids?.[0] === t.rosterId)
          .reduce((s, tx) => s + bid(tx), 0);
        return {
          rosterId: t.rosterId,
          name: t.name,
          faabLeft: t.faabLeft + spent,
          players: before.get(t.rosterId) ?? [],
        };
      });
    const predicted = projectRoomClaims(rivals, wire, rosterPositions);
    if (predicted.length > 0) {
      const predictedTotals = teams.map((t) => {
        const extra = predicted
          .filter((c) => c.rosterId === t.rosterId)
          .map((c) => players[c.playerId])
          .filter(Boolean);
        return {
          rosterId: t.rosterId,
          total: lineupTotal([...(before.get(t.rosterId) ?? []), ...extra], rosterPositions),
        };
      });
      const called = predicted.filter((c) => claimedIds.has(c.playerId));
      prediction = {
        predictedMyRank: rankLowFirst(predictedTotals).get(me.rosterId)!,
        actualMyRank: rankAfter.get(me.rosterId)!,
        called: called.length,
        predicted: predicted.length,
        missed: predicted.filter((c) => !claimedIds.has(c.playerId)).map((c) => c.name),
      };
    }
  }

  const roomSpent = won.reduce((s, t) => s + bid(t), 0);

  return {
    leagueName: input.leagueName,
    week: input.week,
    teamsAlive: teams.length,
    roomSpent,
    claims,
    myLosses,
    myWins,
    field,
    me: myMove,
    prediction,
    lessons: lessonsFrom(claims, myLosses, myMove, teams.length),
  };
}

/**
 * The part worth reading on a phone. Each line is a thing to do differently
 * next Tuesday, or it is not here.
 */
function lessonsFrom(
  claims: ClaimedPlayer[],
  myLosses: WaiverReview["myLosses"],
  me: FieldMove | null,
  teamsAlive: number,
): string[] {
  const lessons: string[] = [];

  if (me && me.rankAfter <= 3) {
    const where = me.rankAfter === 1 ? "the lowest projection" : `the ${ordinal(me.rankAfter)} lowest projection`;
    const slid = me.rankAfter < me.rankBefore ? `, down from ${ordinal(me.rankBefore)} lowest before the run` : "";
    lessons.push(
      `You carry ${where} of ${teamsAlive} into Sunday${slid}. Free agents are open now and cost nothing; that is the only lever left this week.`,
    );
  }

  const bigLosses = myLosses.filter((l) => l.price != null && l.price >= Math.max(50, l.myBid * 4));
  if (bigLosses.length > 0) {
    const worst = bigLosses.sort((a, b) => (b.price ?? 0) - (a.price ?? 0))[0];
    lessons.push(
      `Your bids were token bids against a room paying real money: $${worst.myBid} on ${worst.name}, who went for $${worst.price}${worst.runnerUp != null ? ` with $${worst.runnerUp} behind it` : ""}. If a player is worth winning, bid near the runner-up price, not a tenth of it.`,
    );
  }

  const alreadyNamed = new Set(bigLosses.map((l) => l.name));
  const contested = claims.filter((c) => c.bidders >= 4 && !alreadyNamed.has(c.name));
  if (contested.length > 0) {
    const top = contested[0];
    lessons.push(
      `${top.bidders} teams chased ${top.name}. The runner-up bid${top.runnerUp != null ? ` of $${top.runnerUp}` : ""} is the real market; ${top.winner} paid $${top.price}.`,
    );
  }

  return lessons;
}

function ordinal(n: number): string {
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${suffix}`;
}
