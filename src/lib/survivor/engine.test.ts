import { describe, expect, it } from "vitest";
import { assembleReport, currentWeek, resolveCompleted } from "./engine";
import { DEFAULT_POOL, type Game, type InjuryNote } from "./types";

function game(
  week: number,
  home: string,
  away: string,
  p: number,
  extra: Partial<Game> = {},
): Game {
  return {
    week,
    home,
    away,
    kickoff: `2026-09-${String(6 + week).padStart(2, "0")}T17:00:00Z`,
    homeSpread: null,
    homeMoneyline: null,
    awayMoneyline: null,
    overUnder: null,
    homeWinProb: p,
    probSource: "moneyline",
    completed: false,
    homeScore: null,
    awayScore: null,
    ...extra,
  };
}

const BEFORE_WEEK_1 = new Date("2026-09-06T00:00:00Z");

// A complete, flat distribution. Every candidate then has the same conditional
// field-survival rate, so leverage cancels and the tests isolate one variable.
const EVEN: Record<string, number> = {
  KC: 1 / 6, DEN: 1 / 6, PHI: 1 / 6, NYG: 1 / 6, BUF: 1 / 6, NYJ: 1 / 6,
};

function report(
  games: Game[],
  picks: Record<string, number>,
  pool = {},
  now = BEFORE_WEEK_1,
  injuries: InjuryNote[] = [],
  publicByWeek?: Record<string, Record<string, number>>,
) {
  return assembleReport({
    season: 2026,
    games,
    publicByWeek: publicByWeek ?? { "1": picks },
    publicPulledAt: now.toISOString(),
    injuries,
    pool: { ...DEFAULT_POOL, ...pool },
    now,
  });
}

describe("currentWeek", () => {
  const games = [game(1, "KC", "DEN", 0.8), game(2, "BUF", "NYJ", 0.7)];

  it("is the earliest week with a game still to come", () => {
    expect(currentWeek(games, BEFORE_WEEK_1)).toBe(1);
  });

  it("does not roll forward just because one game has kicked off", () => {
    const mid = [
      game(1, "KC", "DEN", 0.8, { kickoff: "2026-09-07T00:00:00Z" }),
      game(1, "PHI", "NYG", 0.7, { kickoff: "2026-09-07T20:00:00Z" }),
      game(2, "BUF", "NYJ", 0.7),
    ];
    expect(currentWeek(mid, new Date("2026-09-07T10:00:00Z"))).toBe(1);
  });

  it("moves on once the whole week has started", () => {
    expect(currentWeek(games, new Date("2026-09-07T18:00:00Z"))).toBe(2);
  });

  it("settles on the last week when the season is over", () => {
    expect(currentWeek(games, new Date("2027-01-01T00:00:00Z"))).toBe(18);
  });
});

describe("resolveCompleted", () => {
  it("collapses a finished game to a certainty", () => {
    const [g] = resolveCompleted([
      game(1, "KC", "DEN", 0.8, { completed: true, homeScore: 10, awayScore: 24 }),
    ]);
    expect(g.homeWinProb).toBe(0);
  });

  it("does the same for a home win", () => {
    const [g] = resolveCompleted([
      game(1, "KC", "DEN", 0.8, { completed: true, homeScore: 24, awayScore: 10 }),
    ]);
    expect(g.homeWinProb).toBe(1);
  });

  it("leaves a tie at a coin flip", () => {
    const [g] = resolveCompleted([
      game(1, "KC", "DEN", 0.8, { completed: true, homeScore: 17, awayScore: 17 }),
    ]);
    expect(g.homeWinProb).toBe(0.5);
  });

  it("leaves games in progress alone", () => {
    const [g] = resolveCompleted([game(1, "KC", "DEN", 0.8)]);
    expect(g.homeWinProb).toBe(0.8);
  });
});

describe("assembleReport", () => {
  const slate = [
    game(1, "KC", "DEN", 0.85),
    game(1, "PHI", "NYG", 0.8),
    game(1, "BUF", "NYJ", 0.75),
    game(2, "KC", "LV", 0.9),
    game(2, "PHI", "DAL", 0.7),
    game(2, "BUF", "MIA", 0.7),
  ];

  it("puts a candidate on the board for both sides of every open game", () => {
    const r = report(slate, {});
    expect(r.candidates).toHaveLength(6);
    expect(r.week).toBe(1);
  });

  it("never offers a team that has already been burned", () => {
    const r = report(slate, {}, { usedTeams: ["KC", "PHI"] });
    expect(r.candidates.map((c) => c.team)).not.toContain("KC");
    expect(r.candidates.map((c) => c.team)).not.toContain("PHI");
  });

  it("drops the games that have already kicked off, keeping the rest", () => {
    // Thursday night is gone, Sunday is not. Still Week 1, four teams fewer.
    const mixed = [
      game(1, "KC", "DEN", 0.85, { kickoff: "2026-09-07T00:00:00Z" }),
      game(1, "PHI", "NYG", 0.8, { kickoff: "2026-09-07T20:00:00Z" }),
      game(1, "BUF", "NYJ", 0.75, { kickoff: "2026-09-07T20:00:00Z" }),
    ];
    const r = report(mixed, {}, {}, new Date("2026-09-07T10:00:00Z"));
    expect(r.week).toBe(1);
    expect(r.candidates.map((c) => c.team).sort()).toEqual([
      "BUF",
      "NYG",
      "NYJ",
      "PHI",
    ]);
    expect(r.notes.some((n) => n.includes("already kicked off"))).toBe(true);
  });

  it("takes the safest team when nothing later needs it", () => {
    // One week only, so there is no future value to weigh against safety.
    const oneWeek = slate.filter((g) => g.week === 1);
    const r = report(oneWeek, EVEN);
    expect(r.bestTeam).toBe("KC");
    expect(r.safestTeam).toBe("KC");
    expect(r.safetyGiveUp).toBe(0);
  });

  it("gives up this week to keep a team that is worth more next week", () => {
    // KC is 85% now and 90% in Week 2, and it is the only strong Week 2 option.
    // Burning it leaves a 70% Week 2 (0.85 x 0.70 = 0.595); saving it makes the
    // pair 0.80 x 0.90 = 0.720. Surviving both weeks beats surviving this one,
    // so the engine spends the second-best team now and holds KC back.
    const r = report(slate, EVEN);
    expect(r.safestTeam).toBe("KC");
    expect(r.bestTeam).toBe("PHI");
    expect(r.plan[1].team).toBe("KC");
    const kc = r.candidates.find((c) => c.team === "KC")!;
    expect(kc.bestFutureWeek).toBe(2);
    expect(kc.futureCost).toBeGreaterThan(0);
    expect(kc.flags.some((f) => f.kind === "scarcity")).toBe(true);
  });

  it("fades a favourite the whole field is already on", () => {
    // KC is safest at 85% but carries 90% of the field; PHI is 80% on 2%.
    const r = report(slate, { KC: 0.9, PHI: 0.02, BUF: 0.02, DEN: 0.02 });
    expect(r.safestTeam).toBe("KC");
    expect(r.bestTeam).not.toBe("KC");
    expect(r.safetyGiveUp).toBeGreaterThan(0);
  });

  it("warns loudly when the leverage play is a big concession", () => {
    const wide = [
      game(1, "KC", "DEN", 0.95),
      game(1, "BUF", "NYJ", 0.6),
    ];
    const r = report(wide, { KC: 0.98, BUF: 0.01 });
    expect(r.safetyGiveUp).toBeGreaterThan(0.08);
    expect(r.notes.some((n) => n.includes("points of win probability"))).toBe(true);
  });

  it("charges future value against a team the rest of the season needs", () => {
    const kc = report(slate, {}).candidates.find((c) => c.team === "KC");
    expect(kc?.futureCost).toBeGreaterThan(0);
    expect(kc?.bestFutureWeek).toBe(2);
  });

  it("prices a team with no future games at zero future cost", () => {
    const nyj = report(slate, {}).candidates.find((c) => c.team === "NYJ");
    expect(nyj?.futureCost).toBe(0);
  });

  it("plans one team per week and never repeats one", () => {
    const r = report(slate, {});
    const teams = r.plan.map((p) => p.team);
    expect(new Set(teams).size).toBe(teams.length);
    expect(r.plan[0].week).toBe(1);
    expect(r.plan[0].team).toBe(r.bestTeam);
  });

  it("reports the survival of the path it actually shows", () => {
    const r = report(slate, {}, { horizon: 2 });
    expect(r.plan).toHaveLength(2);
    expect(r.planSurvival).toBeCloseTo(
      r.plan[0].winProb * r.plan[1].winProb,
      6,
    );
  });

  it("flags a slate whose plan leans on beating one team over and over", () => {
    const lopsided = [
      game(1, "KC", "ARI", 0.9),
      game(2, "PHI", "ARI", 0.9),
      game(3, "BUF", "ARI", 0.9),
      game(1, "SF", "SEA", 0.6),
    ];
    const r = report(lopsided, {}, { horizon: 3 });
    expect(r.notes.some((n) => n.includes("ARI in 3"))).toBe(true);
  });

  it("prefers a pasted pool distribution over the national one", () => {
    const r = report(slate, EVEN, {
      weeklyPicks: { "1": { KC: 90, DEN: 2, PHI: 3, NYG: 2, BUF: 2, NYJ: 1 } },
    });
    expect(r.ownership.source).toBe("manual");
    expect(r.bestTeam).not.toBe("KC");
    expect(r.notes.some((n) => n.includes("you logged for this week"))).toBe(true);
  });

  it("says so rather than guessing when no distribution loaded", () => {
    const r = report(slate, {});
    expect(r.notes.some((n) => n.includes("evenly spread"))).toBe(true);
  });

  it("refuses to invent ownership from a half-empty snapshot", () => {
    // 6% of the field listed. The old behaviour handed the missing 94% to the
    // three unlisted teams and read them as 31% chalk each.
    const r = report(slate, { KC: 0.02, PHI: 0.02, BUF: 0.02 });
    for (const c of r.candidates) expect(c.ownership).toBeCloseTo(1 / 6, 6);
    expect(r.notes.some((n) => n.includes("evenly spread"))).toBe(true);
  });

  it("warns when the snapshot covers only part of the field", () => {
    const r = report(slate, { KC: 0.4, PHI: 0.2, BUF: 0.1 });
    expect(r.notes.some((n) => n.includes("70% of the field"))).toBe(true);
  });

  it("survives a week where every team is already used", () => {
    const r = report(slate, {}, {
      usedTeams: ["KC", "DEN", "PHI", "NYG", "BUF", "NYJ"],
    });
    expect(r.candidates).toHaveLength(0);
    expect(r.bestTeam).toBeNull();
    expect(r.headline).toContain("nothing legal");
  });

  it("puts a quarterback on the card and leaves the rest of the report off it", () => {
    const injuries: InjuryNote[] = [
      { team: "KC", player: "Starter QB", position: "QB", status: "Out", comment: "", premium: false },
      { team: "KC", player: "A Back", position: "RB", status: "Out", comment: "", premium: false },
      { team: "KC", player: "A Corner", position: "CB", status: "Questionable", comment: "", premium: false },
    ];
    const kc = report(slate, {}, {}, BEFORE_WEEK_1, injuries).candidates.find(
      (c) => c.team === "KC",
    );
    const texts = kc!.flags.filter((f) => f.kind === "injury").map((f) => f.text);
    expect(texts.some((t) => t.includes("Starter QB"))).toBe(true);
    expect(texts.some((t) => t.includes("A Back"))).toBe(false);
  });

  describe("learning from logged weeks", () => {
    // Week 1 is finished, Week 2 is the live slate.
    const played = (
      week: number,
      home: string,
      away: string,
      hs: number,
      as_: number,
    ): Game =>
      game(week, home, away, 0.5, {
        completed: true,
        homeScore: hs,
        awayScore: as_,
      });

    const twoWeeks = [
      played(1, "KC", "DEN", 30, 10),
      played(1, "PHI", "NYG", 21, 7), // NYG busts, so the 30% on it are out
      game(2, "BUF", "NYJ", 0.8),
      game(2, "SF", "SEA", 0.6),
    ];
    // After Week 1 kicked off (09-07 17:00Z) and before Week 2 does (09-08 17:00Z).
    const NOW_WEEK_2 = new Date("2026-09-08T00:00:00Z");
    const publicByWeek = {
      "1": { KC: 0.6, NYG: 0.4 },
      "2": { BUF: 0.7, NYJ: 0.05, SF: 0.2, SEA: 0.05 },
    };

    function wk2(pool: Record<string, unknown>) {
      return assembleReport({
        season: 2026,
        games: twoWeeks,
        publicByWeek,
        publicPulledAt: NOW_WEEK_2.toISOString(),
        injuries: [],
        pool: { ...DEFAULT_POOL, poolSize: 500, ...pool },
        now: NOW_WEEK_2,
      });
    }

    it("asks for the finished week it has not been given", () => {
      const r = wk2({});
      expect(r.week).toBe(2);
      expect(r.unloggedWeeks).toEqual([1]);
      expect(r.notes.some((n) => n.includes("have not been logged"))).toBe(true);
    });

    it("stops asking once that week is logged", () => {
      const r = wk2({ weeklyPicks: { "1": { KC: 70, NYG: 30 } } });
      expect(r.unloggedWeeks).toEqual([]);
    });

    it("derives entries alive instead of trusting the typed number", () => {
      // 70% took KC and survived, 30% took NYG and busted.
      const r = wk2({
        weeklyPicks: { "1": { KC: 70, NYG: 30 } },
        entriesAlive: 999, // deliberately wrong
      });
      expect(r.entriesAlive).toBe(350);
      expect(r.field.entriesAlive).toBe(350);
      expect(r.field.weeksLogged).toBe(1);
    });

    it("falls back to the typed number when nothing is logged", () => {
      expect(wk2({ entriesAlive: 420 }).entriesAlive).toBe(420);
    });

    it("knows which teams the surviving field can no longer use", () => {
      const r = wk2({ weeklyPicks: { "1": { KC: 70, NYG: 30 } } });
      expect(r.field.burned.KC).toBeCloseTo(1, 4);
      expect(r.field.burned.NYG ?? 0).toBeCloseTo(0, 4);
    });

    it("fits how far the pool leans off the public", () => {
      const r = wk2({ weeklyPicks: { "1": { KC: 90, NYG: 10 } } });
      // The pool went harder on the chalk than Yahoo's 60/40.
      expect(r.calibration.weeks).toBe(1);
      expect(r.calibration.alpha).toBeGreaterThan(1);
      expect(r.ownership.source).toBe("projected");
    });

    it("says it is projecting and how much it trusts the fit", () => {
      const r = wk2({ weeklyPicks: { "1": { KC: 90, NYG: 10 } } });
      expect(r.notes.some((n) => n.includes("chalk factor"))).toBe(true);
      expect(r.calibration.confidence).toBe("low");
    });

    it("uses raw public numbers before anything is logged", () => {
      expect(wk2({}).ownership.source).toBe("yahoo");
      expect(wk2({}).calibration.alpha).toBe(1);
    });

    it("flags a team most of the field can no longer follow you onto", () => {
      // Everyone alive used BUF in week 1, so it is unavailable to them now.
      const burnedBuf = [
        played(1, "BUF", "NYJ", 30, 10),
        game(2, "BUF", "NYJ", 0.8),
        game(2, "SF", "SEA", 0.6),
      ];
      const r = assembleReport({
        season: 2026,
        games: burnedBuf,
        publicByWeek: { "1": { BUF: 1 }, "2": { BUF: 0.7, SF: 0.3 } },
        publicPulledAt: NOW_WEEK_2.toISOString(),
        injuries: [],
        pool: {
          ...DEFAULT_POOL,
          poolSize: 500,
          weeklyPicks: { "1": { BUF: 100 } },
        },
        now: NOW_WEEK_2,
      });
      const buf = r.candidates.find((c) => c.team === "BUF")!;
      expect(buf.ownership).toBeCloseTo(0, 4);
      expect(
        buf.flags.some((f) => f.text.includes("cannot follow you here")),
      ).toBe(true);
    });

    it("ignores a logged week whose results are not all in", () => {
      const halfPlayed = [
        played(1, "KC", "DEN", 30, 10),
        game(1, "PHI", "NYG", 0.7), // never finished
        game(2, "BUF", "NYJ", 0.8),
      ];
      const r = assembleReport({
        season: 2026,
        games: halfPlayed,
        publicByWeek,
        publicPulledAt: NOW_WEEK_2.toISOString(),
        injuries: [],
        pool: {
          ...DEFAULT_POOL,
          poolSize: 500,
          weeklyPicks: { "1": { KC: 70, NYG: 30 } },
        },
        now: NOW_WEEK_2,
      });
      expect(r.field.weeksLogged).toBe(0);
      expect(r.field.unscored).toEqual([1]);
      expect(r.entriesAlive).toBe(500);
    });
  });

  it("marks a game with no line as soft rather than quoting it as fact", () => {
    const soft = [game(1, "KC", "DEN", 0.7, { probSource: "rating" })];
    const r = report(soft, {});
    expect(r.candidates[0].flags.some((f) => f.kind === "data")).toBe(true);
    expect(r.notes.some((n) => n.includes("no line posted"))).toBe(true);
  });
});

describe("pool posture", () => {
  // A slate built from the real Week 1 2026 numbers, where the top two land
  // inside the tie band pulling opposite ways: LAC is safer (80.0% to 78.7%) and
  // JAX is less owned (26.9% to 33.1%). This is the case the two pools exist to
  // answer differently.
  const SLATE = [
    game(1, "LAC", "ARI", 0.8),
    game(1, "JAX", "CLE", 0.7867),
    game(1, "DET", "NO", 0.7335),
    game(1, "PIT", "ATL", 0.696),
    game(1, "PHI", "WAS", 0.6854),
    game(2, "LAC", "DET", 0.6),
    game(2, "JAX", "PIT", 0.62),
    game(2, "PHI", "ARI", 0.75),
    game(2, "CLE", "NO", 0.55),
    game(2, "ATL", "WAS", 0.58),
  ];
  // Ownership concentrated on the favourites, as a real board's is. This
  // matters more than it looks: an earlier version of this fixture left real
  // ownership on the underdogs, which dropped field survival to 0.68, and at
  // that rate even 500 entries thin past one before week 18 and BOTH pools read
  // outright. The posture is a statement about the whole season, so the fixture
  // has to be plausible about the whole season.
  const PICKS = { LAC: 0.4, JAX: 0.3, DET: 0.15, PIT: 0.08, PHI: 0.07 };

  const big = report(SLATE, PICKS, { poolSize: 500 });
  const small = report(SLATE, PICKS, { poolSize: 30 });

  it("agrees the two teams cannot be separated on equity", () => {
    expect(big.tied).toEqual(expect.arrayContaining(["LAC", "JAX"]));
    expect(small.tied).toEqual(expect.arrayContaining(["LAC", "JAX"]));
  });

  it("takes the safer team in the pool that will thin to one entry", () => {
    expect(small.posture.mode).toBe("outright");
    expect(small.bestTeam).toBe("LAC");
  });

  it("takes the less owned team in the pool that will end up splitting", () => {
    expect(big.posture.mode).toBe("shared");
    expect(big.bestTeam).toBe("JAX");
  });

  it("reports how many entries it expects to be left", () => {
    expect(big.posture.expectedSurvivors).toBeGreaterThan(small.posture.expectedSurvivors);
  });

  it("does not let the posture reorder teams outside the band", () => {
    // DET is lightly owned at 15.5% and would be promoted by a naive leverage
    // rule, but it is a real distance behind on equity.
    expect(big.candidates[2].team).toBe("DET");
    expect(small.candidates[2].team).toBe("DET");
  });

  it("plans the season around the team it actually recommends", () => {
    expect(big.plan[0].team).toBe("JAX");
    expect(small.plan[0].team).toBe("LAC");
  });
});

describe("mass-elimination chalk", () => {
  it("flags a team the field has piled onto past 65%", () => {
    const games = [game(1, "KC", "DEN", 0.78), game(1, "BUF", "NYJ", 0.62)];
    const r = report(games, { KC: 0.7, BUF: 0.2, NYJ: 0.1 });
    const kc = r.candidates.find((c) => c.team === "KC");
    const flag = kc?.flags.find((f) => f.kind === "chalk");
    expect(flag?.severity).toBe("danger");
    expect(flag?.text).toMatch(/70/);
  });

  it("leaves ordinary chalk alone", () => {
    const games = [game(1, "KC", "DEN", 0.78), game(1, "BUF", "NYJ", 0.62)];
    const r = report(games, { KC: 0.35, BUF: 0.45, NYJ: 0.2 });
    const kc = r.candidates.find((c) => c.team === "KC");
    expect(kc?.flags.find((f) => f.kind === "chalk")?.severity).not.toBe("danger");
  });
});

describe("headline on a broken tie", () => {
  const SLATE = [
    game(1, "LAC", "ARI", 0.8),
    game(1, "JAX", "CLE", 0.7867),
    game(1, "DET", "NO", 0.7335),
    game(1, "PIT", "ATL", 0.696),
    game(1, "PHI", "WAS", 0.6854),
    game(2, "LAC", "DET", 0.6),
    game(2, "JAX", "PIT", 0.62),
    game(2, "PHI", "ARI", 0.75),
    game(2, "CLE", "NO", 0.55),
    game(2, "ATL", "WAS", 0.58),
  ];
  const PICKS = { LAC: 0.4, JAX: 0.3, DET: 0.15, PIT: 0.08, PHI: 0.07 };

  it("names the pick and keeps the tie as a caveat", () => {
    // "LAC or JAX, effectively tied" was the right headline while nothing could
    // separate them. It is no longer an answer now that the posture does, and a
    // headline that does not name a team is not a recommendation.
    const r = report(SLATE, PICKS, { poolSize: 30 });
    expect(r.headline).toBe("Week 1: LAC over ARI, with JAX effectively tied");
  });

  it("still leads with a taken pick over any of this", () => {
    const r = report(SLATE, PICKS, { poolSize: 30, myPicks: { "1": "DET" } });
    expect(r.headline).toBe("Week 1: you have DET over NO");
  });
});
