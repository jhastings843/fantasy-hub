import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/redis/client", () => ({ redis: {} }));

import { SEARCH_USES, researchPrompt } from "./research";

describe("waiver research search budget", () => {
  // Oct 6 to 27: dynasty's searches overran a cap of six, every search after it failed, and the list came back empty.
  it("tells the model the same budget the tool enforces", () => {
    for (const f of ["dynasty", "redraft"] as const) expect(researchPrompt(f, "2026", 9)).toContain(`You have ${SEARCH_USES} web searches`);
  });

  it("leaves room for every column the dynasty prompt names", () => {
    expect(SEARCH_USES).toBeGreaterThanOrEqual(10);
  });
});
