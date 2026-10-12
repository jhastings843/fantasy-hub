import { describe, expect, it } from "vitest";
import { allocate, type Exposure } from "../allocate";
import type { IssuedRecord } from "../issued";
import type { League } from "../parse";
import { BASELINE_POLICY, FLAT_POLICY, type StakingPolicy } from "../policy";
import { decide, evaluate, laterHypotheses, type IssuedBet } from "./model";
import { type DecisionRecord, type SizingCandidate, coverageGaps, replay, reproductionGaps, sizeFor, sizingEvidence, toDecision } from "./replay";

// Live sizing is flat 1u; the challenger is quarter Kelly (p1). A 40-10 tier
// reads as 60% at -110, so quarter Kelly wants 4u where flat wants 1u.
const FLAT = FLAT_POLICY.staking;
const KELLY = BASELINE_POLICY.staking;
const STRONG = { w: 40, l: 10 };
const T0 = "2026-10-13T11:00:00Z";

function cand(league: League, week: number, n: string, o: Partial<SizingCandidate> = {}): SizingCandidate {
  const key = `${week}:A${n}@H${n}`;
  return { id: `ats:${key}`, game: key, league, week, key, kind: "ats", side: "home", line: -3, price: -110, rec: STRONG, eligible: true, held: false, rival: false, issuable: true, ...o };
}

/** A decision as the live (flat) system made it: live stakes from the real allocator on the actual exposure. */
function dec(o: { at: string; sendKey: string; league?: League; week?: number; order?: number; exposure?: Partial<DecisionRecord["exposure"]>; candidates: SizingCandidate[]; settled?: string[]; finalsKnown?: string[]; staking?: StakingPolicy }): DecisionRecord {
  const league = o.league ?? "nfl";
  const week = o.week ?? 6;
  const staking = o.staking ?? FLAT;
  const exposure = { weekly: 0, outstanding: 0, reserved: 0, perGame: [] as [string, number][], ...o.exposure };
  const ex: Exposure = { ...exposure, perGame: new Map(exposure.perGame) };
  const a = allocate(o.candidates.map((c) => ({ id: c.id, game: c.game, ...sizeFor(c, staking) })), ex);
  return {
    v: 1, at: o.at, sendKey: o.sendKey, league, season: 2026, week, calWeek: week - (league === "cfb" ? 1 : 0), order: o.order ?? 0,
    policyId: "p2", staking, exposure, candidates: o.candidates, live: Object.fromEntries(a.stakes), settled: o.settled ?? [], finalsKnown: o.finalsKnown ?? [],
  };
}

/** The issued record a decision's live bets would have produced. */
function issuedFor(d: DecisionRecord, status: IssuedRecord["status"] = "sent"): IssuedRecord {
  const plays = d.candidates
    .filter((c) => c.issuable && !c.rival && (d.live[c.id] ?? 0) > 0)
    .map((c) => {
      const [, teams] = c.key.split(":");
      const [away, home] = teams.split("@");
      return { home, away, tier: "t1" as const, side: c.side as "home", homeLine: c.line, play: "", basis: "reference" as const, shownInEmail: true, units: d.live[c.id], price: c.price, p: 0.6 };
    });
  return { league: d.league, season: 2026, week: d.week, slot: "sat", status, idempotencyKey: d.sendKey, issuedAt: d.at, provenance: "issued", subject: "", ruleVersion: "", rule: null, second: null, suMethod: { id: "avg", label: "" }, plays, su: [], unverified: [] } as IssuedRecord;
}

const WIN = { home: 24, away: 10 };
const LOSS = { home: 10, away: 24 };
const stakesOf = (runs: ReturnType<typeof replay>, i: number) => Object.fromEntries(runs[i].stakes);

describe("sizing replay through the real allocator", () => {
  it("replaying the live sizing reproduces the live stakes (the honesty check)", () => {
    const d = dec({ at: "2026-10-18T13:00:00Z", sendKey: "s1", exposure: { weekly: 27 }, candidates: [cand("nfl", 6, "1"), cand("nfl", 6, "2")] });
    expect(reproductionGaps([d])).toEqual([]);
  });

  it("partial weekly exposure: with 3u of room left, Kelly's two 4u wants are scaled to fit", () => {
    const d = dec({ at: "2026-10-18T13:00:00Z", sendKey: "s1", exposure: { weekly: 27, outstanding: 5 }, candidates: [cand("nfl", 6, "1"), cand("nfl", 6, "2")] });
    expect(sizeFor(d.candidates[0], KELLY).want).toBe(4);
    expect(Object.values(d.live)).toEqual([1, 1]);
    const k = replay([d], () => KELLY);
    // 3u of room, 8u wanted: scaled to 1.5 each (quarter units, rounded down).
    expect(stakesOf(k, 0)).toEqual({ "ats:6:A1@H1": 1.5, "ats:6:A2@H2": 1.5 });
  });

  it("cross-sport budget: Kelly's bigger NFL stakes in the same send leave college less room", () => {
    const nfl = dec({ at: "2026-10-18T13:00:00Z", sendKey: "s1", league: "nfl", week: 6, order: 0, exposure: { weekly: 20, outstanding: 20 }, candidates: [cand("nfl", 6, "1")] });
    // College saw NFL's 1u live stake as reserved.
    const cfb = dec({ at: "2026-10-18T13:00:00Z", sendKey: "s1", league: "cfb", week: 7, order: 1, exposure: { weekly: 20, outstanding: 20, reserved: 1 }, candidates: [cand("cfb", 7, "9"), cand("cfb", 7, "8")] });
    expect(reproductionGaps([nfl, cfb])).toEqual([]);
    const k = replay([cfb, nfl], () => KELLY);
    // NFL takes 4u; college then sees 4u reserved: 30 - 20 - 4 = 6u for two 4u wants.
    expect(stakesOf(k, 0)).toEqual({ "ats:6:A1@H1": 4 });
    expect(stakesOf(k, 1)).toEqual({ "ats:7:A9@H9": 3, "ats:7:A8@H8": 3 });
  });

  it("held rivals of the other sport take their share of the room under the replayed sizing too", () => {
    const rival = cand("cfb", 7, "R", { id: "rival:ats:cfb:A@H", game: "rival:cfb:A@H", rival: true, issuable: false, held: true });
    const d = dec({ at: "2026-10-18T13:00:00Z", sendKey: "s1", exposure: { weekly: 24 }, candidates: [cand("nfl", 6, "1"), rival] });
    expect(d.live).toEqual({ "ats:6:A1@H1": 1, "rival:ats:cfb:A@H": 1 });
    // Kelly: 6u of room, 4u + 4u wanted, both scaled to 3u; the rival's 3u is only a reservation.
    expect(stakesOf(replay([d], () => KELLY), 0)).toEqual({ "ats:6:A1@H1": 3, "rival:ats:cfb:A@H": 3 });
  });

  it("per-game cap: a spread and a total on one game share 5u under Kelly", () => {
    const ats = cand("nfl", 6, "1");
    const ou = { ...cand("nfl", 6, "1"), id: "ou:6:A1@H1", kind: "ou" as const, side: "over" as const, line: 44.5 };
    const d = dec({ at: "2026-10-18T13:00:00Z", sendKey: "s1", candidates: [ats, ou] });
    const k = replay([d], () => KELLY)[0];
    expect([...k.stakes.values()].reduce((a, b) => a + b, 0)).toBe(5);
    expect(k.cut.size).toBe(1);
  });

  it("unsettled bets: the policy's own open stakes count against the open-bets cap until their game is final as known then", () => {
    // Week 6 Saturday: one bet. Week 7 Saturday (a new weekly budget): its game not yet final.
    const a = dec({ at: "2026-10-17T13:00:00Z", sendKey: "s1", week: 6, exposure: { weekly: 0, outstanding: 25 }, candidates: [cand("nfl", 6, "1")] });
    const b = dec({ at: "2026-10-24T13:00:00Z", sendKey: "s2", week: 7, exposure: { weekly: 0, outstanding: 26 }, candidates: [cand("nfl", 7, "2")] });
    // Live: 30 - 26 = 4u of room, flat bets 1u. Kelly: open = 26 - 1 + 4 = 29, room 1u.
    expect(stakesOf(replay([a, b], () => KELLY), 1)).toEqual({ "ats:7:A2@H2": 1 });
    // The same send with the week 6 game known final: it no longer counts.
    const known = dec({ at: b.at, sendKey: "s2", week: 7, exposure: { weekly: 0, outstanding: 25 }, candidates: b.candidates, settled: ["nfl:6:A1@H1"] });
    expect(stakesOf(replay([a, known], () => KELLY), 1)).toEqual({ "ats:7:A2@H2": 4 });
  });

  it("information after a decision: a game only the challenger bet stays open until its final was known AT the later decision", () => {
    // Live here is eighth Kelly. A 25-10 tier is eligible (quarter Kelly 1.75u)
    // but eighth Kelly sizes it under 1u, so live passes; quarter Kelly bets it.
    const EIGHTH = { ...KELLY, kellyScale: 0.125 };
    const thin = cand("nfl", 6, "1", { rec: { w: 25, l: 10 } });
    const a = dec({ at: "2026-10-17T13:00:00Z", sendKey: "s1", week: 6, staking: EIGHTH, candidates: [thin] });
    expect(a.live).toEqual({});
    expect(stakesOf(replay([a], () => KELLY), 0)).toEqual({ "ats:6:A1@H1": 1.75 });
    // Next week, 28u open live. The week 6 final was not yet on file at 9am.
    const b = dec({ at: "2026-10-24T13:00:00Z", sendKey: "s2", week: 7, staking: EIGHTH, exposure: { outstanding: 28 }, candidates: [cand("nfl", 7, "2")], finalsKnown: [] });
    expect(b.live).toEqual({ "ats:7:A2@H2": 2 });
    // Quarter Kelly: 28 + 1.75 open leaves 0.25u, so no bet, even though
    // the final (learned later) is in the scoring data.
    const finalsLater = [{ league: "nfl" as const, map: new Map([["6:A1@H1", WIN], ["7:A2@H2", WIN]]) }];
    const ev = sizingEvidence([a, b], [{ league: "nfl", records: [issuedFor(b)] }], finalsLater, { challenger: KELLY, incumbent: EIGHTH, since: T0 });
    expect(ev.gaps).toEqual([]);
    expect(ev.pairs.map((p) => [p.id, p.ch.stake, p.inc.stake])).toEqual([["ats:6:A1@H1", 1.75, 0], ["ats:7:A2@H2", 0, 2]]);
    // Had the final been known at 9am, the room would have been there.
    const b2 = { ...b, finalsKnown: ["nfl:6:A1@H1"] };
    expect(stakesOf(replay([a, b2], () => KELLY), 1)).toEqual({ "ats:7:A2@H2": 2 });
  });
});

describe("evidence checks: no filled-in history", () => {
  const a = dec({ at: "2026-10-17T13:00:00Z", sendKey: "s1", candidates: [cand("nfl", 6, "1")] });
  const b = dec({ at: "2026-10-24T13:00:00Z", sendKey: "s2", week: 7, candidates: [cand("nfl", 7, "2")] });

  it("a staked send with no recorded decision is a gap, and the sample restarts after it", () => {
    const orphan = { ...issuedFor(a), idempotencyKey: "s0", issuedAt: "2026-10-20T13:00:00Z" };
    const gaps = coverageGaps([a, b], [{ league: "nfl", records: [issuedFor(a), orphan, issuedFor(b)] }], T0);
    expect(gaps.map((g) => g.why)).toEqual([expect.stringMatching(/no recorded decision/)]);
    const ev = sizingEvidence([a, b], [{ league: "nfl", records: [issuedFor(a), orphan, issuedFor(b)] }], [], { challenger: KELLY, incumbent: FLAT, since: T0 });
    expect(ev.decisions).toBe(1);
    expect(ev.since).toBe(b.at);
  });

  it("bets decided but never confirmed sent, or sent differently, are gaps", () => {
    expect(coverageGaps([a], [{ league: "nfl", records: [] }], T0)[0].why).toMatch(/never confirmed sent/);
    const changed = issuedFor(a);
    changed.plays[0].units = 2;
    expect(coverageGaps([a], [{ league: "nfl", records: [changed] }], T0)[0].why).toMatch(/don't match/);
    expect(coverageGaps([a], [{ league: "nfl", records: [issuedFor(a, "unconfirmed")] }], T0)[0].why).toMatch(/unconfirmed/);
  });

  it("a decision missing a candidate the live allocator used (a rival without its record) fails reproduction", () => {
    const d = dec({ at: "2026-10-18T13:00:00Z", sendKey: "s1", exposure: { weekly: 28 }, candidates: [cand("nfl", 6, "1")] });
    // Live actually gave a rival the last 1u; the record couldn't describe the rival, so it isn't in candidates.
    const broken = { ...d, live: { "rival:ats:cfb:A@H": 1 } };
    expect(reproductionGaps([broken])[0].why).toMatch(/did not reproduce/);
  });

  it("with nothing recorded, a sizing challenger can't be promoted however good the old estimate looks", () => {
    const h = laterHypotheses(T0)[0];
    const bets: IssuedBet[] = Array.from({ length: 60 }, (_, i) => ({ league: "nfl", week: 7 + (i % 4), key: `k${i}`, at: "2026-10-20T13:00:00Z", p: 0.6, price: -110, units: 1, result: i % 3 ? "W" : "L" }));
    const e = evaluate(h, { opps: [], issued: bets, active: FLAT_POLICY, ruleTest: {}, sizing: { decisions: [], issued: [], finals: [] } });
    expect(e.sizing?.unconstrained?.challenger.units).toBeGreaterThan(e.sizing!.unconstrained!.incumbent.units);
    const d = decide(h, e, { calibration: { n: 60, meanP: 0.6, winRate: 0.6, brier: 0.24, calibrated: true }, active: FLAT_POLICY });
    expect(d.verdict).toBe("retain");
    expect(d.why).toMatch(/no sends recorded/);
  });

  it("toDecision marks only this sport's released, today's picks as issuable", () => {
    const sizing = {
      candidates: [
        { ...cand("nfl", 6, "1", { kickoff: "2026-10-18T17:00:00Z" }) },
        { ...cand("nfl", 6, "2", { kickoff: "2026-10-19T00:20:00Z", held: true }) },
        { ...cand("cfb", 7, "R", { id: "rival:ats:cfb:A@H", game: "rival:cfb:A@H", rival: true, held: true, kickoff: "2026-10-18T17:00:00Z" }) },
      ].map((c) => {
        const { issuable, ...rest } = c;
        void issuable;
        return rest;
      }),
      exposure: { weekly: 0, outstanding: 0, reserved: 0, perGame: [] as [string, number][] },
      live: {},
      settled: [],
    };
    const d = toDecision({ league: "nfl", season: 2026, week: 6, policy: { id: "p2", staking: FLAT }, sizing }, { at: "2026-10-18T13:00:00Z", sendKey: "s", order: 0, finalsKnown: [], onSendDate: (k) => !!k && k.startsWith("2026-10-18") })!;
    expect(d.candidates.map((c) => c.issuable)).toEqual([true, false, false]);
    expect(d.calWeek).toBe(6);
  });
});

describe("uncapped Kelly looks better; the capped portfolio does not", () => {
  // Saturday: one strong pick, which loses. Sunday, same calendar week: two
  // strong picks, both win. 8u of weekly room at the start (22u already out).
  const sat = dec({ at: "2026-10-17T13:00:00Z", sendKey: "sat", week: 6, exposure: { weekly: 22, outstanding: 22 }, candidates: [cand("nfl", 6, "1")] });
  // Sunday: Saturday's live 1u is on the books; its game is final.
  const sun = dec({ at: "2026-10-18T13:00:00Z", sendKey: "sun", week: 6, exposure: { weekly: 23, outstanding: 22 }, candidates: [cand("nfl", 6, "2"), cand("nfl", 6, "3")], settled: ["nfl:6:A1@H1"], finalsKnown: ["nfl:6:A1@H1"] });
  const finals = [{ league: "nfl" as const, map: new Map([["6:A1@H1", LOSS], ["6:A2@H2", WIN], ["6:A3@H3", WIN]]) }];
  const records = [{ league: "nfl" as const, records: [issuedFor(sat), issuedFor(sun)] }];
  const bets: IssuedBet[] = [
    { league: "nfl", week: 6, key: "6:A1@H1", at: sat.at, p: 0.6, price: -110, units: 1, result: "L" },
    { league: "nfl", week: 6, key: "6:A2@H2", at: sun.at, p: 0.6, price: -110, units: 1, result: "W" },
    { league: "nfl", week: 6, key: "6:A3@H3", at: sun.at, p: 0.6, price: -110, units: 1, result: "W" },
  ];

  it("the old estimate says Kelly wins; the replay through the weekly budget says it loses", () => {
    const h = laterHypotheses(T0)[0];
    const e = evaluate(h, { opps: [], issued: bets, active: FLAT_POLICY, ruleTest: {}, sizing: { decisions: [sat, sun], issued: records, finals } });
    const old = e.sizing!.unconstrained!;
    // Uncapped: 4u on each. -4 + 2 x 3.64 = +3.27 vs flat's +0.82.
    expect(old.challenger.units).toBeCloseTo(3.273, 2);
    expect(old.incumbent.units).toBeCloseTo(0.818, 2);
    const c = e.comparison!;
    // Capped: Kelly's 4u loser leaves 4u for Sunday, so the two winners get 2u each.
    expect(c.challenger).toMatchObject({ bets: 3, risked: 8 });
    expect(c.challenger.units).toBeCloseTo(-0.364, 2);
    expect(c.incumbent).toMatchObject({ bets: 3, risked: 3 });
    expect(c.incumbent.units).toBeCloseTo(0.818, 2);
    expect(e.sizing).toMatchObject({ decisions: 2, gaps: 0, cut: { challenger: 2, incumbent: 0 } });
    expect(decide(h, e, { calibration: { n: 60, meanP: 0.6, winRate: 0.6, brier: 0.24, calibrated: true }, active: FLAT_POLICY }).verdict).toBe("retain");
  });

  it("the weekly t needs the 95% value for its week count, never less than MIN_T", async () => {
    const { t95 } = await import("./model");
    expect(t95(2)).toBe(2.92);
    expect(t95(11)).toBe(1.812);
    expect(t95(500)).toBe(1.658);
    expect(t95(0)).toBe(Infinity);
  });
});

describe("fixes from the independent review (Astra, 2026-10-12)", () => {
  it("settlement: a game live bet follows the live settled list however old; a game only the replay bet ages out", () => {
    // Week 6: Kelly risks 4u where flat (live) risks 1u.
    const a = dec({ at: "2026-10-17T13:00:00Z", sendKey: "s1", week: 6, candidates: [cand("nfl", 6, "1")] });
    // Week 10, 28u open live. The live list carries every issued game's status.
    const settled = dec({ at: "2026-11-14T13:00:00Z", sendKey: "s3", week: 10, exposure: { outstanding: 28 }, candidates: [cand("nfl", 10, "2")], settled: ["nfl:6:A1@H1"] });
    expect(stakesOf(replay([a, settled], () => KELLY), 1)).toEqual({ "ats:10:A2@H2": 2 });
    // Never settled (say, postponed): live still counts its 1u open, so Kelly's 4u stays open too.
    const postponed = dec({ at: "2026-11-14T13:00:00Z", sendKey: "s3", week: 10, exposure: { outstanding: 28 }, candidates: [cand("nfl", 10, "2")], settled: [] });
    expect(reproductionGaps([a, postponed])).toEqual([]);
    expect(stakesOf(replay([a, postponed], () => KELLY), 1)).toEqual({});
    // A game only the replay bet (live passed it under eighth Kelly) ages out after the horizon.
    const EIGHTH = { ...KELLY, kellyScale: 0.125 };
    const thin = dec({ at: "2026-10-17T13:00:00Z", sendKey: "s1", week: 6, staking: EIGHTH, candidates: [cand("nfl", 6, "1", { rec: { w: 25, l: 10 } })] });
    const later = dec({ at: "2026-11-14T13:00:00Z", sendKey: "s3", week: 10, staking: EIGHTH, exposure: { outstanding: 28 }, candidates: [cand("nfl", 10, "2")] });
    expect(stakesOf(replay([thin, later], () => KELLY), 1)).toEqual({ "ats:10:A2@H2": 2 });
  });

  it("the latest attempt per send wins, whatever order the writes landed in", async () => {
    const { latestDecisions } = await import("./replay");
    const early = dec({ at: "2026-10-17T13:00:00Z", sendKey: "s1", candidates: [cand("nfl", 6, "1")] });
    const retry = dec({ at: "2026-10-17T14:00:00Z", sendKey: "s1", candidates: [cand("nfl", 6, "2")] });
    expect(latestDecisions([retry, early])).toEqual([retry]);
  });

  it("a morning with no record at all is a gap, and the sample restarts after it", async () => {
    const { missingDays } = await import("./replay");
    expect(missingDays(["picks-day:2026-10-17", "picks-day:2026-10-19"], T0).map((g) => g.why)).toEqual(["no 9am decision recorded for 2026-10-18"]);
    const a = dec({ at: "2026-10-17T13:00:00Z", sendKey: "picks-day:2026-10-17", candidates: [cand("nfl", 6, "1")] });
    const b = dec({ at: "2026-10-19T13:00:00Z", sendKey: "picks-day:2026-10-19", candidates: [cand("nfl", 6, "2")] });
    const ev = sizingEvidence([a, b], [{ league: "nfl", records: [issuedFor(a), issuedFor(b)] }], [], { challenger: KELLY, incumbent: FLAT, since: T0, days: ["picks-day:2026-10-17", "picks-day:2026-10-19"] });
    expect(ev.since).toBe(b.at);
    expect(ev.decisions).toBe(1);
  });

  it("sizing up is judged per bet: capped Kelly risking less in total still needs calibration", async () => {
    const { decide } = await import("./model");
    const h = laterHypotheses(T0)[0];
    const comparison = { n: 40, weeks: [7, 8, 9], meanDiff: 0.3, t: 4, tNeeded: 2.92, challenger: { bets: 12, units: 6, risked: 28.5, roi: 0.2, clv: null, clvN: 0, drawdown: 2 }, incumbent: { bets: 30, units: 2, risked: 30, roi: 0.07, clv: null, clvN: 0, drawdown: 2 } };
    const sizing = { since: T0, decisions: 9, gaps: 0, unsettled: 0, sizesUp: true, refused: { challenger: 18, incumbent: 0 }, cut: { challenger: 0, incumbent: 0 } };
    const d = decide(h, { id: h.id, comparison, sizing }, { calibration: { n: 0, meanP: 0, winRate: 0, brier: 0, calibrated: false }, active: FLAT_POLICY });
    expect(d.verdict).toBe("retain");
    expect(d.why).toMatch(/calibrated/);
    const one = dec({ at: "2026-10-18T13:00:00Z", sendKey: "s", candidates: [cand("nfl", 6, "1")] });
    const ev = sizingEvidence([one], [{ league: "nfl", records: [issuedFor(one)] }], [], { challenger: KELLY, incumbent: FLAT, since: T0 });
    expect(ev.sizesUp).toBe(true);
  });

  it("a calendar week with any unsettled replayed bet is left out until it is complete", () => {
    const a = dec({ at: "2026-10-17T13:00:00Z", sendKey: "s1", week: 6, candidates: [cand("nfl", 6, "1"), cand("nfl", 6, "2")] });
    const finals = [{ league: "nfl" as const, map: new Map([["6:A1@H1", WIN]]) }];
    const ev = sizingEvidence([a], [{ league: "nfl", records: [issuedFor(a)] }], finals, { challenger: KELLY, incumbent: FLAT, since: T0 });
    expect(ev.pairs).toEqual([]);
    expect(ev.pendingWeeks).toEqual([6]);
    expect(ev.unsettled).toBe(1);
  });

  it("coverage compares the whole wager: a different price on the same units is a gap", () => {
    const a = dec({ at: "2026-10-17T13:00:00Z", sendKey: "s1", candidates: [cand("nfl", 6, "1")] });
    const moved = issuedFor(a);
    moved.plays[0].price = -125;
    expect(coverageGaps([a], [{ league: "nfl", records: [moved] }], T0)[0].why).toMatch(/don't match/);
    const flipped = issuedFor(a);
    flipped.plays[0].homeLine = -2.5;
    expect(coverageGaps([a], [{ league: "nfl", records: [flipped] }], T0)).toHaveLength(1);
  });
});

