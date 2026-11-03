import { describe, expect, it } from "vitest";
import type { Bet } from "@/lib/learning/engine";
import { PROPS_GATE, emptyState, review, sectionView, type Candidate } from "@/lib/learning/engine";
import { SWITCH_RULE, chanceOf, costToAmerican, decideScheme, schemeStats, stakeFor, stakingBase, switchTest } from "./staking";
import { limitProps, sizeStakes, stakeText, stakedPush, type StakedBet } from "./staked-core";
import { alertFor, alertKind } from "@/lib/notify/golive";

describe("stakeFor", () => {
  it("flat is 1u whatever the bet", () => {
    expect(stakeFor("flat", { p: 0.3, price: -110 })).toBe(1);
    expect(stakeFor("flat", { p: 0.9, price: 900 })).toBe(1);
  });

  it("to win 1u risks 1 / payout, capped at 3u", () => {
    expect(stakeFor("towin", { p: 0.6, price: -200 })).toBe(2);
    expect(stakeFor("towin", { p: 0.6, price: -110 })).toBe(1.1);
    expect(stakeFor("towin", { p: 0.3, price: 300 })).toBe(0.33);
    expect(stakeFor("towin", { p: 0.8, price: -500 })).toBe(3);
  });

  it("quarter Kelly: 1u = 1%, 0.25u steps, 0.25u floor, 3u cap, 0 with no edge", () => {
    // p .55 at -110: full Kelly 5.5%, quarter 1.375% -> 1.5u
    expect(stakeFor("kelly25", { p: 0.55, price: -110 })).toBe(1.5);
    // p .6 at -110: quarter Kelly 4% -> capped
    expect(stakeFor("kelly25", { p: 0.6, price: -110 })).toBe(3);
    // a sliver over break-even still bets the floor
    expect(stakeFor("kelly25", { p: 0.525, price: -110 })).toBe(0.25);
    // at or under break-even: no bet
    expect(stakeFor("kelly25", { p: 0.52, price: -110 })).toBe(0);
    // long shot: p .12 at +900 -> f = (.12*10 - 1)/9 = 2.2%, quarter .56% -> 0.5u
    expect(stakeFor("kelly25", { p: 0.12, price: 900 })).toBe(0.5);
  });

  it("shrunk Kelly pulls our chance halfway to the break-even first", () => {
    // p .55 at -110 -> .5369 -> quarter Kelly .69% -> 0.75u
    expect(stakeFor("kelly25shrunk", { p: 0.55, price: -110 })).toBe(0.75);
    expect(stakeFor("kelly25shrunk", { p: 0.55, price: -110 })).toBeLessThan(stakeFor("kelly25", { p: 0.55, price: -110 }));
    expect(stakeFor("kelly25shrunk", { p: 0.5, price: -110 })).toBe(0);
  });

  it("by edge: 1u at the bar, +0.5u per 3 more points, 3u cap, 0 under the bar", () => {
    // break-even at -110 is 52.38%
    expect(stakeFor("edge", { p: 0.53, price: -110 })).toBe(1);
    expect(stakeFor("edge", { p: 0.56, price: -110 })).toBe(1.5); // 3.6 pts
    expect(stakeFor("edge", { p: 0.62, price: -110 })).toBe(2.5); // 9.6 pts
    expect(stakeFor("edge", { p: 0.8, price: -110 })).toBe(3);
    expect(stakeFor("edge", { p: 0.5, price: -110 })).toBe(0);
    // a 2-point bar (First TD's edge rule): 1u from 2 points on
    expect(stakeFor("edge", { p: 0.12, price: 900 }, 2)).toBe(1); // 2 pts over 10%
    expect(stakeFor("edge", { p: 0.11, price: 900 }, 2)).toBe(0);
  });

  it("cost prices convert to American both ways round", () => {
    expect(costToAmerican(0.1)).toBeCloseTo(900);
    expect(costToAmerican(0.5)).toBeCloseTo(100);
    expect(costToAmerican(0.6)).toBeCloseTo(-150);
  });
});

/** n bets at -110 with chance p; bet i wins when win(i). Weeks of 60 bets. */
function run(n: number, p: number, win: (i: number) => boolean, perWeek = 60): Bet[] {
  return Array.from({ length: n }, (_, i) => ({
    game: `g${i}`,
    key: `g${i}|x`,
    week: 1 + Math.floor(i / perWeek),
    at: new Date(Date.UTC(2026, 9, 1) + i * 3_600_000).toISOString(),
    net: win(i) ? Math.round((100 / 110) * 1000) / 1000 : -1,
    p,
    price: -110,
  }));
}
const wins60 = (i: number) => i % 5 < 3;
const wins40 = (i: number) => i % 5 < 2;

describe("schemeStats", () => {
  it("units, risk, ROI, drawdown and log-growth, bet by bet", () => {
    const bets = run(5, 0.6, (i) => i !== 1 && i !== 2); // W L L W W
    const flat = schemeStats(bets, "flat");
    expect(flat).toMatchObject({ bets: 5, risked: 5, drawdown: 2 });
    expect(flat.units).toBeCloseTo(3 * 0.909 - 2, 2);
    expect(flat.logGrowth).toBeCloseTo(3 * Math.log(1.00909) + 2 * Math.log(0.99), 4);
    const k = schemeStats(bets, "kelly25");
    expect(k.risked).toBe(15);
    expect(k.units).toBeCloseTo(3 * flat.units, 1);
    expect(k.drawdown).toBe(6);
  });

  it("leaves out bets with no saved chance", () => {
    const bets: Bet[] = [...run(3, 0.6, () => true), { game: "old", week: 1, at: "2026-09-01T00:00:00Z", net: -1 }];
    expect(schemeStats(bets, "flat").bets).toBe(3);
  });
});

describe("switch rule", () => {
  it("is pinned: 200 bets, 4 weeks, paired t 1.645", () => {
    expect(SWITCH_RULE).toEqual({ minBets: 200, minWeeks: 4, minT: 1.645 });
  });

  it("switches to the scheme that grows the bankroll most once it clears every bar", () => {
    const bets = run(240, 0.6, wins60);
    const t = switchTest(bets, "kelly25");
    expect(t).toMatchObject({ bets: 240, weeks: 4, pass: true });
    expect(t.t).toBeGreaterThanOrEqual(1.645);
    const d = decideScheme(bets, "flat");
    expect(d).toMatchObject({ scheme: "kelly25", changed: true });
  });

  it("stays flat under 200 bets or under 4 weeks", () => {
    expect(decideScheme(run(199, 0.6, wins60, 50), "flat")).toMatchObject({ scheme: "flat", changed: false });
    expect(decideScheme(run(240, 0.6, wins60, 80), "flat")).toMatchObject({ scheme: "flat", changed: false }); // 3 weeks
  });

  it("stays flat when no scheme's t clears 1.645", () => {
    // 54% winners at p .6: Kelly's bigger stakes barely help or hurt
    expect(decideScheme(run(400, 0.6, (i) => i % 50 < 27), "flat").scheme).toBe("flat");
  });

  it("goes back to flat once the scheme falls below flat, and holds while above", () => {
    expect(decideScheme(run(240, 0.6, wins60), "kelly25")).toMatchObject({ scheme: "kelly25", changed: false });
    expect(decideScheme(run(240, 0.6, wins40), "kelly25")).toMatchObject({ scheme: "flat", changed: true });
  });
});

describe("the learner stores the choice and journals it", () => {
  const cand = (bets: Bet[]): Candidate[] => [{ id: "edge:all", label: "Every model edge", bets }];

  it("review switches, journals once, and the view marks it in use", () => {
    const now = "2026-10-30T12:00:00.000Z";
    const r = review(PROPS_GATE, emptyState("nba-props-ours"), cand(run(240, 0.6, wins60)), now, 5, "2026-10-30");
    expect(r.state.stake).toMatchObject({ scheme: "kelly25", at: now });
    const line = r.journal.find((j) => j.kind === "staking")!;
    expect(line.id).toBe("stake:kelly25");
    expect(line.text).toMatch(/^Stakes now quarter kelly: /);
    expect(line.text).not.toContain("—");
    // next review: no change, no new line
    const again = review(PROPS_GATE, r.state, cand(run(240, 0.6, wins60)), "2026-10-31T12:00:00.000Z", 5, "2026-10-31");
    expect(again.journal.some((j) => j.kind === "staking")).toBe(false);
    const v = sectionView(PROPS_GATE, again.state, cand(run(240, 0.6, wins60)), []);
    expect(v.staking).toMatchObject({ base: "edge:all", inUse: "kelly25" });
    expect(v.staking!.rows.map((x) => x.scheme)).toEqual(["flat", "towin", "kelly25", "kelly25shrunk", "edge"]);
    // later it turns: back to flat
    const back = review(PROPS_GATE, again.state, cand(run(240, 0.6, wins40)), "2026-11-01T12:00:00.000Z", 6, "2026-11-01");
    expect(back.state.stake?.scheme).toBe("flat");
  });

  it("sections with no saved chance get no staking table and never switch", () => {
    const bets: Bet[] = run(240, 0.6, wins60).map((b) => ({ game: b.game, key: b.key, week: b.week, at: b.at, net: b.net }));
    expect(stakingBase(cand(bets))).toBeUndefined();
    const r = review(PROPS_GATE, emptyState("nfl-props"), cand(bets), "2026-10-30T12:00:00.000Z", 5);
    expect(r.state.stake).toBeUndefined();
    expect(sectionView(PROPS_GATE, r.state, cand(bets), []).staking).toBeUndefined();
  });

  it("the switch pushes once, worded plainly", () => {
    const j = { at: "2026-10-30T12:00:00.000Z", week: 5, kind: "staking" as const, id: "stake:kelly25", text: "Stakes now quarter kelly: it beats flat." };
    expect(alertKind(j)).toBe("stake");
    expect(alertFor("nba-props-ours", j)).toEqual({ title: "Stake change: NBA props", message: "NBA props: Stakes now quarter kelly: it beats flat." });
  });
});

describe("staked bets use the section's scheme, inside the caps", () => {
  const bet = (i: number, over: Partial<StakedBet> = {}): StakedBet => ({
    id: `nba-props-ours|g${i}|pts|over`,
    section: "nba-props-ours",
    sectionName: "NBA props",
    sport: "NBA",
    game: `A${i} at B${i}`,
    pick: `Player ${i} Over 20.5 pts`,
    market: "pts",
    price: -110,
    priceText: "-110 DraftKings",
    kickoff: `2026-11-03T0${i}:00:00.000Z`,
    slice: "Edges on the over",
    stake: 1,
    href: "/props?m=nba",
    chance: { p: 0.6, price: -110 },
    ...over,
  });

  it("flat sections and bets without a chance keep 1u; the lotto ticket keeps its stake", () => {
    const flat = sizeStakes([bet(1)], new Map());
    expect(flat.bets[0].stake).toBe(1);
    const k = new Map([["nba-props-ours", "kelly25" as const]]);
    expect(sizeStakes([bet(1, { chance: undefined })], k).bets[0].stake).toBe(1);
    expect(sizeStakes([bet(1, { stake: 0.1 })], k).bets[0].stake).toBe(0.1);
  });

  it("sizes by the scheme, names it, and cuts a 0u bet", () => {
    const k = new Map([["nba-props-ours", "kelly25" as const]]);
    const r = sizeStakes([bet(1), bet(2, { chance: { p: 0.5, price: -110 } })], k);
    expect(r.bets).toHaveLength(1);
    expect(r.bets[0]).toMatchObject({ stake: 3, stakeNote: "quarter Kelly" });
    expect(r.cut[0]).toMatch(/quarter Kelly stakes nothing/);
    expect(stakeText(r.bets[0])).toBe("3u, quarter Kelly");
    expect(stakeText({ stake: 1 })).toBe("1u");
    expect(stakedPush(r.bets[0], "https://x").message).toContain("3u, quarter Kelly");
  });

  it("the day cap counts sized units: four 3u bets fit three under 10u", () => {
    const k = new Map([["nba-props-ours", "kelly25" as const]]);
    const sized = sizeStakes([1, 2, 3, 4].map((i) => bet(i)), k).bets;
    const r = limitProps(sized);
    expect(r.bets.map((b) => b.stake)).toEqual([3, 3, 3]);
    expect(r.cut[0]).toMatch(/day limit 10u/);
  });
});

describe("chanceOf", () => {
  it("keeps over and under per market from a board's extra", () => {
    expect(chanceOf({ "pts|A": { over: 0.55, under: 0.45 }, "reb|B": {} })).toEqual({ chance: { "pts|A": { over: 0.55, under: 0.45 } } });
    expect(chanceOf(undefined)).toEqual({});
  });
});
