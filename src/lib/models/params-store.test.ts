import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/redis/client", () => ({ redis: { mget: vi.fn(async () => [{ params: { k: 0.3 } }, null, null, null, null, null, null, null]) } }));

describe("model settings from the database", () => {
  it("a stored refit overrides its fields; everything else stays on the defaults", async () => {
    const { live, primeParams } = await import("./params-store");
    const P = live("nba-props", { k: 0.1, other: 5 });
    expect(P.k).toBe(0.1);
    await primeParams(1e12);
    expect(P.k).toBe(0.3);
    expect(P.other).toBe(5);
    expect(live("nba-fb", { k: 1 }).k).toBe(1);
  });

  it("refuses unknown settings and changed shapes", async () => {
    const { checkParams } = await import("./params-store");
    const d = { a: 1, w: [1, 2], o: { x: 1 } };
    expect(checkParams(d, { a: 2, w: [3, 4], o: { x: 2 } })).toEqual([]);
    expect(checkParams(d, { b: 1 })).toEqual(["unknown setting b"]);
    expect(checkParams(d, { a: Number.NaN, w: [1] })).toEqual(["a changed shape", "w changed shape"]);
  });
});
