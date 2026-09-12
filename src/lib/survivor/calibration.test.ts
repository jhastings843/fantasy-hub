import { describe, expect, it } from "vitest";
import { calibrate, fitAlpha, projectOwnership, type Observation } from "./calibration";

const PUBLIC = { KC: 0.5, PHI: 0.3, BUF: 0.15, NYJ: 0.05 };

function sum(o: Record<string, number>): number {
  return Object.values(o).reduce((a, b) => a + b, 0);
}

describe("projectOwnership", () => {
  it("is the identity at alpha 1", () => {
    const out = projectOwnership(PUBLIC, 1);
    for (const k of Object.keys(PUBLIC)) {
      expect(out[k]).toBeCloseTo(PUBLIC[k as keyof typeof PUBLIC], 6);
    }
  });

  it("always returns a distribution", () => {
    for (const a of [0.4, 1, 1.8, 3]) {
      expect(sum(projectOwnership(PUBLIC, a))).toBeCloseTo(1, 6);
    }
  });

  it("concentrates on the chalk above alpha 1", () => {
    const out = projectOwnership(PUBLIC, 2);
    expect(out.KC).toBeGreaterThan(PUBLIC.KC);
    expect(out.NYJ).toBeLessThan(PUBLIC.NYJ);
  });

  it("flattens the field below alpha 1", () => {
    const out = projectOwnership(PUBLIC, 0.5);
    expect(out.KC).toBeLessThan(PUBLIC.KC);
    expect(out.NYJ).toBeGreaterThan(PUBLIC.NYJ);
  });

  it("preserves the ordering at any alpha", () => {
    const out = projectOwnership(PUBLIC, 2.5);
    expect(out.KC).toBeGreaterThan(out.PHI);
    expect(out.PHI).toBeGreaterThan(out.BUF);
    expect(out.BUF).toBeGreaterThan(out.NYJ);
  });

  it("restricts to the teams asked for and renormalises", () => {
    const out = projectOwnership(PUBLIC, 1, ["KC", "PHI"]);
    expect(Object.keys(out).sort()).toEqual(["KC", "PHI"]);
    expect(sum(out)).toBeCloseTo(1, 6);
    expect(out.KC).toBeCloseTo(0.5 / 0.8, 6);
  });

  it("falls back to uniform rather than dividing by zero", () => {
    const out = projectOwnership({ KC: 0, PHI: 0 }, 2);
    expect(out.KC).toBeCloseTo(0.5, 6);
  });
});

describe("fitAlpha", () => {
  it("recovers the factor used to generate the data", () => {
    for (const truth of [0.6, 1, 1.5, 2.2]) {
      const obs: Observation[] = [
        { week: 1, publicPicks: PUBLIC, poolPicks: projectOwnership(PUBLIC, truth) },
      ];
      expect(fitAlpha(obs)).toBeCloseTo(truth, 1);
    }
  });

  it("pools several weeks into one estimate", () => {
    const wk2 = { KC: 0.2, PHI: 0.45, BUF: 0.25, NYJ: 0.1 };
    const obs: Observation[] = [
      { week: 1, publicPicks: PUBLIC, poolPicks: projectOwnership(PUBLIC, 1.8) },
      { week: 2, publicPicks: wk2, poolPicks: projectOwnership(wk2, 1.8) },
    ];
    expect(fitAlpha(obs)).toBeCloseTo(1.8, 1);
  });

  it("returns 1 when there is nothing to fit", () => {
    expect(fitAlpha([])).toBe(1);
    expect(
      fitAlpha([{ week: 1, publicPicks: PUBLIC, poolPicks: { KC: 1 } }]),
    ).toBe(1);
  });

  it("ignores teams the public snapshot never listed", () => {
    const obs: Observation[] = [
      {
        week: 1,
        publicPicks: PUBLIC,
        poolPicks: { ...projectOwnership(PUBLIC, 1.6), XXX: 0.4 },
      },
    ];
    expect(fitAlpha(obs)).toBeCloseTo(1.6, 1);
  });
});

describe("calibrate", () => {
  it("stays neutral with no data and says so", () => {
    const c = calibrate([]);
    expect(c.alpha).toBe(1);
    expect(c.weeks).toBe(0);
    expect(c.confidence).toBe("none");
    expect(c.summary).toContain("No completed weeks");
  });

  it("shrinks a single week only a third of the way", () => {
    const obs: Observation[] = [
      { week: 1, publicPicks: PUBLIC, poolPicks: projectOwnership(PUBLIC, 2.5) },
    ];
    const c = calibrate(obs);
    expect(c.rawAlpha).toBeCloseTo(2.5, 1);
    // 1 + (2.5 - 1) * 1/3 = 1.5
    expect(c.alpha).toBeCloseTo(1.5, 1);
    expect(c.alpha).toBeLessThan(c.rawAlpha);
  });

  it("trusts the fit more as weeks accumulate", () => {
    const one = calibrate([
      { week: 1, publicPicks: PUBLIC, poolPicks: projectOwnership(PUBLIC, 2) },
    ]);
    const six = calibrate(
      Array.from({ length: 6 }, (_, i) => ({
        week: i + 1,
        publicPicks: PUBLIC,
        poolPicks: projectOwnership(PUBLIC, 2),
      })),
    );
    expect(six.alpha).toBeGreaterThan(one.alpha);
    expect(six.alpha).toBeCloseTo(2, 0);
    expect(six.confidence).toBe("good");
  });

  it("grades its own confidence by sample size", () => {
    const obs = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        week: i + 1,
        publicPicks: PUBLIC,
        poolPicks: projectOwnership(PUBLIC, 1.4),
      }));
    expect(calibrate(obs(1)).confidence).toBe("low");
    expect(calibrate(obs(4)).confidence).toBe("medium");
    expect(calibrate(obs(8)).confidence).toBe("good");
  });

  it("names the direction in plain language", () => {
    const chalky = calibrate(
      Array.from({ length: 5 }, (_, i) => ({
        week: i + 1,
        publicPicks: PUBLIC,
        poolPicks: projectOwnership(PUBLIC, 2.2),
      })),
    );
    expect(chalky.summary).toContain("piles onto the chalk");

    const flat = calibrate(
      Array.from({ length: 5 }, (_, i) => ({
        week: i + 1,
        publicPicks: PUBLIC,
        poolPicks: projectOwnership(PUBLIC, 0.5),
      })),
    );
    expect(flat.summary).toContain("spreads out more");

    const same = calibrate([
      { week: 1, publicPicks: PUBLIC, poolPicks: PUBLIC },
    ]);
    expect(same.summary).toContain("tracked the public closely");
  });

  it("never returns an alpha outside the search range", () => {
    const extreme = calibrate(
      Array.from({ length: 20 }, (_, i) => ({
        week: i + 1,
        publicPicks: PUBLIC,
        poolPicks: { KC: 0.999, PHI: 0.001 },
      })),
    );
    expect(extreme.alpha).toBeGreaterThanOrEqual(0.25);
    expect(extreme.alpha).toBeLessThanOrEqual(4);
  });
});

describe("calibrate, by pool size", () => {
  // A 30-entry pool's distribution is a much noisier measurement than a
  // 500-entry pool's: one person is 3.3 percentage points, and a 30% share has a
  // sampling SD of 8.4 points against 2.0 points at 500 entries. Information
  // goes as the entry count, so a week of 30-entry data is worth about a
  // sixteenth of a week of 500-entry data and cannot be allowed to move the
  // chalk factor as far.
  function chalkyWeek(week: number) {
    return {
      week,
      publicPicks: { KC: 0.4, PHI: 0.3, BUF: 0.2, NYJ: 0.1 },
      poolPicks: { KC: 0.7, PHI: 0.2, BUF: 0.07, NYJ: 0.03 },
    };
  }

  it("matches the old weeks-only shrinkage at 500 entries", () => {
    // The anchor: 500 entries reproduces weeks/(weeks+2) exactly, so adding
    // pool size did not quietly re-tune the pool this was calibrated on.
    const one = calibrate([chalkyWeek(1)], 500);
    const raw = one.rawAlpha;
    expect(one.alpha).toBeCloseTo(1 + (raw - 1) / 3, 9);
  });

  it("moves far less on one week of a 30-entry pool", () => {
    const big = calibrate([chalkyWeek(1)], 500);
    const small = calibrate([chalkyWeek(1)], 30);
    expect(small.rawAlpha).toBeCloseTo(big.rawAlpha, 9);
    expect(Math.abs(small.alpha - 1)).toBeLessThan(Math.abs(big.alpha - 1) / 5);
  });

  it("never reports better than medium confidence for a 30-entry pool", () => {
    const weeks = Array.from({ length: 12 }, (_, i) => chalkyWeek(i + 1));
    expect(calibrate(weeks, 30).confidence).not.toBe("good");
    expect(calibrate(weeks, 500).confidence).toBe("good");
  });

  it("still says low after one week however many entries there are", () => {
    // The weeks cap stays: one week is a coincidence at any pool size.
    expect(calibrate([chalkyWeek(1)], 5000).confidence).toBe("low");
  });

  it("says when the entry count is what is holding confidence down", () => {
    const weeks = Array.from({ length: 8 }, (_, i) => chalkyWeek(i + 1));
    expect(calibrate(weeks, 30).summary).toMatch(/30 entries|entry count|entries a week/i);
  });
});
