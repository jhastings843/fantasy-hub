import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/redis/cached", () => ({ cached: vi.fn() }));
vi.mock("@/lib/redis/client", () => ({ redis: {} }));
import { byesFrom } from "./projections";

describe("byesFrom", () => {
  // Sleeper lists every team every week; a team on bye just projects zero.
  it("finds a bye as a team with nobody projected above zero, this week included", () => {
    const byes = byesFrom([
      { week: 8, projections: [{ team: "NYG", points: 0 }, { team: "NYG", points: 0 }, { team: "TEN", points: 12 }] },
      { week: 9, projections: [{ team: "NYG", points: 14 }, { team: "TEN", points: 0 }] },
    ]);
    expect(byes).toEqual({ NYG: 8, TEN: 9 });
  });
});
