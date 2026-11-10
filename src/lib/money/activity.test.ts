import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/redis/client", () => ({ redis: {} }));
import { runText } from "./activity";

describe("runText", () => {
  it("counts each non-empty list in the report, problems apart", () => {
    expect(runText("NBA picks", { season: 2026, saved: ["a", "b"], settled: [], review: null, problems: ["x"] }, ["x"])).toBe("NBA picks: saved 2, 1 problem");
    expect(runText("NBA props", { captured: [1], kept: [1, 2], paywalled: [] })).toBe("NBA props: captured 1, kept 2");
    expect(runText("Line archive", { saved: [] })).toBe("Line archive: nothing new");
  });
});
