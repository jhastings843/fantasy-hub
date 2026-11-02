import { describe, expect, it } from "vitest";
import {
  advancement,
  bestCandidate,
  bracketProb,
  buildCandidates,
  chalk,
  fillBracket,
  gameTeams,
  GAMES,
  mostLikely,
  mulberry32,
  N_GAMES,
  oneIn,
  poolTable,
  poolValue,
  prepare,
  scoreBracket,
  setupOptimizer,
  simulate,
  slotTeams,
  upsetRows,
  winMatrix,
} from "./bracket";
import type { BracketField } from "./bracket-types";
import { FIELD_FIXTURE } from "./field-fixture";

const flatField = (): BracketField => ({ ...FIELD_FIXTURE, teams: FIELD_FIXTURE.teams.map((t) => ({ ...t, rating: 0 })) });

describe("layout", () => {
  it("puts 64 teams in seed order, 1v16 first in each region", () => {
    const teams = slotTeams(FIELD_FIXTURE);
    expect(teams).toHaveLength(64);
    expect(teams.slice(0, 4).map((t) => t.seed)).toEqual([1, 16, 8, 9]);
    expect(new Set(teams.map((t) => t.id)).size).toBe(64);
    expect(teams[0].region).toBe(FIELD_FIXTURE.semis[0][0]);
    expect(teams[16].region).toBe(FIELD_FIXTURE.semis[0][1]);
  });
  it("throws on a region missing a seed", () => {
    const bad = { ...FIELD_FIXTURE, teams: FIELD_FIXTURE.teams.slice(1) };
    expect(() => slotTeams(bad)).toThrow(/exactly one/);
  });
});

describe("exact advancement", () => {
  const p = prepare(FIELD_FIXTURE);
  it("each round's chances add up to its number of games", () => {
    p.adv.forEach((row, r) => expect(row.reduce((a, b) => a + b, 0)).toBeCloseTo(GAMES[r], 9));
    p.pub.forEach((row, r) => expect(row.reduce((a, b) => a + b, 0)).toBeCloseTo(GAMES[r], 9));
  });
  it("gives every team 1 in 64 when all are equal", () => {
    const f = flatField();
    const adv = advancement(winMatrix(slotTeams(f), f.sigma));
    adv[5].forEach((x) => expect(x).toBeCloseTo(1 / 64, 7));
    adv[0].forEach((x) => expect(x).toBeCloseTo(0.5, 7));
  });
  it("matches a Monte Carlo of the same games", () => {
    const sims = simulate(p, { T: 20000, K: 1, seed: 7 });
    const champ = new Array(64).fill(0);
    const ff = new Array(64).fill(0);
    for (let t = 0; t < sims.T; t++) {
      champ[sims.outcomes[t * N_GAMES + 62]]++;
      for (let k = 56; k < 60; k++) ff[sims.outcomes[t * N_GAMES + k]]++;
    }
    for (let i = 0; i < 64; i++) {
      expect(Math.abs(champ[i] / sims.T - p.adv[5][i])).toBeLessThan(0.012);
      expect(Math.abs(ff[i] / sims.T - p.adv[3][i])).toBeLessThan(0.015);
    }
  });
  it("the public estimate over-picks 1 seeds and under-picks 12s", () => {
    for (let i = 0; i < 64; i++) {
      if (p.teams[i].seed === 1) expect(p.pub[0][i]).toBeGreaterThan(p.adv[0][i]);
      if (p.teams[i].seed === 12) expect(p.pub[0][i]).toBeLessThan(p.adv[0][i]);
    }
    expect(p.pubEstimated).toBe(true);
  });
  it("uses posted shares when every team has them", () => {
    const f = { ...FIELD_FIXTURE, publicSource: "yahoo" as const, teams: FIELD_FIXTURE.teams.map((t) => ({ ...t, publicPick: [0.5, 0.25, 0.125, 0.0625, 0.03125, 1 / 64] })) };
    const q = prepare(f);
    expect(q.pubEstimated).toBe(false);
    expect(q.pub[5][3]).toBeCloseTo(1 / 64);
  });
});

describe("brackets", () => {
  const p = prepare(FIELD_FIXTURE);
  const coherent = (picks: Uint8Array) => {
    for (let k = 0; k < N_GAMES; k++) expect(gameTeams(k, picks)).toContain(picks[k]);
  };
  it("most likely bracket is coherent, at least as likely as chalk and as picking each game's favorite", () => {
    const ml = mostLikely(p);
    coherent(ml.picks);
    expect(bracketProb(p, ml.picks)).toBeCloseTo(ml.prob, 20);
    const ch = chalk(p);
    coherent(ch.picks);
    expect(ml.prob).toBeGreaterThanOrEqual(ch.prob);
    const fav = fillBracket(p, new Map(), 0);
    expect(ml.prob).toBeGreaterThanOrEqual(bracketProb(p, fav) * (1 - 1e-12));
    expect(ml.prob).toBeGreaterThan(1e-14);
    expect(ml.prob).toBeLessThan(1e-6);
  });
  it("most likely beats every single-game flip that keeps the bracket coherent", () => {
    const ml = mostLikely(p);
    for (let k = 0; k < 32; k++) {
      const alt = new Uint8Array(ml.picks);
      const [a, b] = gameTeams(k, alt);
      const old = alt[k];
      alt[k] = old === a ? b : a;
      // Replace the loser downstream wherever it was picked.
      for (let j = k + 1; j < N_GAMES; j++) if (alt[j] === old) alt[j] = alt[k];
      expect(bracketProb(p, alt)).toBeLessThanOrEqual(ml.prob);
    }
  });
  it("candidates are coherent, distinct and force their champion", () => {
    const cands = buildCandidates(p);
    expect(cands.length).toBeGreaterThanOrEqual(30);
    expect(cands.length).toBeLessThanOrEqual(45);
    for (const c of cands) {
      coherent(c.picks);
      expect(c.picks[62]).toBe(c.champion);
    }
    expect(new Set(cands.map((c) => c.picks.join())).size).toBe(cands.length);
  });
  it("leverage only adds credible upsets", () => {
    const picks = fillBracket(p, new Map(), 0.8);
    for (const u of upsetRows(p, picks)) expect(u.h2h).toBeGreaterThanOrEqual(0.28);
    expect(upsetRows(p, fillBracket(p, new Map(), 0)).every((u) => u.h2h >= 0.5)).toBe(true);
  });
  it("scores ESPN points and the seed bonus", () => {
    const ml = mostLikely(p);
    expect(scoreBracket(ml.picks, ml.picks, "espn", p.teams)).toBe(32 * 10 + 16 * 20 + 8 * 40 + 4 * 80 + 2 * 160 + 320);
    expect(scoreBracket(ml.picks, ml.picks, "flat", p.teams)).toBe(63);
    const seeds = Array.from(ml.picks).reduce((a, w) => a + p.teams[w].seed, 0);
    expect(scoreBracket(ml.picks, ml.picks, "upset", p.teams)).toBe(32 + 32 + 32 + 32 + 32 + 32 + seeds);
  });
});

describe("pool", () => {
  const { p, sims, cands } = setupOptimizer(FIELD_FIXTURE, { T: 600, K: 200, seed: 11 });
  const tab = poolTable(p, sims, cands, "espn");
  it("is reproducible from the seed", () => {
    const a = mulberry32(5);
    const b = mulberry32(5);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
    const s2 = simulate(p, { T: 600, K: 200, seed: 11 });
    expect(s2.outcomes).toEqual(sims.outcomes);
  });
  it("a pool of one always wins, and q stays in 0..1", () => {
    expect(poolValue(tab, 0, 1, "wta").win).toBeCloseTo(1);
    for (const x of tab.q) expect(x >= 0 && x <= 1).toBe(true);
  });
  it("win chance falls as the pool grows, and top 3 cashes more often than first", () => {
    const b = bestCandidate(tab, 100, "wta").index;
    const v10 = poolValue(tab, b, 10, "wta");
    const v100 = poolValue(tab, b, 100, "wta");
    expect(v100.win).toBeLessThan(v10.win);
    const t3 = poolValue(tab, b, 100, "top3");
    expect(t3.cash).toBeGreaterThan(t3.win);
  });
  it("the best bracket beats an average entry, and a big pool takes a less popular champion", () => {
    for (const N of [10, 100, 1000]) expect(bestCandidate(tab, N, "wta").value.xAvg).toBeGreaterThan(1);
    const small = cands[bestCandidate(tab, 10, "wta").index].champion;
    const big = cands[bestCandidate(tab, 10000, "wta").index].champion;
    expect(p.pub[5][big]).toBeLessThanOrEqual(p.pub[5][small] + 1e-9);
  });
});

describe("oneIn", () => {
  it("reads big numbers in words", () => {
    expect(oneIn(1 / 4.2e9)).toBe("1 in 4.2 billion");
    expect(oneIn(1 / 312e9)).toBe("1 in 312 billion");
    expect(oneIn(1 / 9.2e18)).toBe("1 in 9.2 quintillion");
    expect(oneIn(1 / 1234)).toBe("1 in 1,234");
    expect(oneIn(1 / 3e6)).toBe("1 in 3 million");
    expect(oneIn(0)).toBe("never");
  });
});

describe("timing", () => {
  it("full setup and one scoring table at page size", () => {
    const t0 = performance.now();
    const s = setupOptimizer(FIELD_FIXTURE, { T: 2000, K: 300, seed: 2027 });
    const t1 = performance.now();
    const tab = poolTable(s.p, s.sims, s.cands, "espn");
    const t2 = performance.now();
    for (const N of [10, 25, 50, 100, 500, 1000, 10000]) bestCandidate(tab, N, "wta");
    const t3 = performance.now();
    console.log(`setup ${(t1 - t0).toFixed(0)}ms, pool table ${(t2 - t1).toFixed(0)}ms (${s.cands.length} candidates), 7 pool sizes ${(t3 - t2).toFixed(1)}ms`);
    expect(t3 - t0).toBeLessThan(5000);
  });
});

describe("review fixes (Astra, 2026-11-02)", () => {
  it("settles ties across the tied group: identical brackets in a pool of 4 win 25%, cash top 3 75%", async () => {
    const { placeChances } = await import("./bracket");
    const pk = placeChances(0, 1, 3, 3);
    expect(pk[0]).toBeCloseTo(0.25, 6);
    expect(pk[0] + pk[1] + pk[2]).toBeCloseTo(0.75, 6);
    // No ties: the plain binomial.
    const q = 0.2;
    expect(placeChances(q, 0, 9, 1)[0]).toBeCloseTo((1 - q) ** 9, 9);
  });

  it("draws public brackets conditional on the champion", async () => {
    const { prepare, sampleGiven, mulberry32, N_GAMES } = await import("./bracket");
    const p = prepare(FIELD_FIXTURE);
    // Slots 2-3 play first-round game 1 (out[1]); its winner meets the champion in game 32. That rate must follow
    // pub(reach) * pub(beat), not the free public rate.
    const champ = 0;
    const s = p.pubWin!;
    const want = [2, 3].map((j) => p.pub[0][j] * s[champ * 64 + j]);
    const expect2 = want[0] / (want[0] + want[1]);
    const out = new Uint8Array(N_GAMES);
    const rand = mulberry32(7);
    let n2 = 0;
    const K = 20000;
    for (let k = 0; k < K; k++) {
      sampleGiven(out, 0, rand, p, champ, (a, b) => s[a * 64 + b]);
      expect(out[62]).toBe(champ);
      if (out[1] === 2) n2++;
    }
    expect(n2 / K).toBeCloseTo(expect2, 1);
  });

  it("keeps every champion's public mass in the opponent groups", async () => {
    const { prepare, opponentGroups } = await import("./bracket");
    const g = opponentGroups(prepare(FIELD_FIXTURE), 300);
    expect(g.reduce((a, x) => a + x.weight, 0)).toBeCloseTo(1, 9);
  });

  it("projects 64 from 68 and pairs overall 1 with 4 in the semis", async () => {
    const { projectField } = await import("./field");
    const confs = Array.from({ length: 32 }, (_, i) => `C${i}`);
    const teams = Array.from({ length: 200 }, (_, i) => ({ id: String(i), location: `T${i}`, short: `T${i}`, abbr: `T${i}`, rating: 30 - i * 0.2, conf: confs[i % 32] }));
    const f = projectField(teams, { season: 2026, asOf: "", sigma: 11 });
    expect(f.teams.length).toBe(64);
    const top = f.teams.slice(0, 4).map((t) => t.region);
    expect(f.semis[0]).toEqual([top[0], top[3]]);
    expect(f.semis[1]).toEqual([top[1], top[2]]);
  });
});
