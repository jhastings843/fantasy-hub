import { describe, expect, it } from "vitest";
import { parsePickemRosters } from "./sleeper-pickem";
import { deriveFromEntries } from "./entries";

// Real shapes from SURVIVING DIDDY YR 2!!!, week 3. An entry that LOST still
// holds a pick for every week it played, which is the trap: inferring alive
// from "has a pick every week" reads the whole graveyard as alive.
const ROSTERS = [
  {
    roster_id: 1,
    owner_id: "u1",
    metadata: {
      is_eliminated: "true",
      previous_picks: { "v1:regular:1": ["JAX"], "v1:regular:2": ["TB"] },
    },
  },
  {
    roster_id: 2,
    owner_id: "u2",
    metadata: {
      is_eliminated: "false",
      previous_picks: { "v1:regular:1": ["JAX"], "v1:regular:2": ["SF"] },
    },
  },
  {
    roster_id: 3,
    owner_id: "u2",
    metadata: {
      is_eliminated: "false",
      previous_picks: { "v1:regular:1": ["PIT"], "v1:regular:2": ["SF"] },
    },
  },
];

const USERS = [
  { user_id: "u1", display_name: "TlawMvp4real" },
  { user_id: "u2", display_name: "WalkerJanora" },
];

describe("parsePickemRosters", () => {
  const board = parsePickemRosters(ROSTERS, USERS);

  it("reads the whole field, not just the survivors", () => {
    expect(board.total).toBe(3);
    expect(board.alive).toBe(2);
  });

  it("believes the elimination flag over the picks", () => {
    const dead = board.entries.find((e) => e.name === "TlawMvp4real");
    expect(dead?.eliminated).toBe(true);
    expect(dead?.picks).toEqual({ "1": "JAX", "2": "TB" });
  });

  it("tells one person's entries apart", () => {
    // 1,584 rosters against 477 users in the real pool, so the names repeat.
    expect(board.entries.map((e) => e.name)).toEqual([
      "TlawMvp4real",
      "WalkerJanora",
      "WalkerJanora #2",
    ]);
  });

  it("turns leg ids into week numbers", () => {
    expect(board.entries[1].picks).toEqual({ "1": "JAX", "2": "SF" });
  });

  it("feeds the same derivation a screenshot does", () => {
    const d = deriveFromEntries(board.entries, 2, 3);
    expect(d.alive).toBe(2);
    // The eliminated entry's TB must not count against the survivors.
    expect(d.burned.TB).toBeUndefined();
    expect(d.burned.SF).toBeCloseTo(1, 5);
    expect(d.burned.JAX).toBeCloseTo(0.5, 5);
  });
});
