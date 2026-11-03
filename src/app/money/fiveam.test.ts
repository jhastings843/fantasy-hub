import { describe, expect, it } from "vitest";
import { fiveAmEt } from "./desks";

describe("fiveAmEt: the stock learner's run time", () => {
  it("uses EDT before the clocks change", () => expect(fiveAmEt("2026-10-31")).toBe("2026-10-31T09:00:00.000Z"));
  it("uses EST after", () => expect(fiveAmEt("2026-11-07")).toBe("2026-11-07T10:00:00.000Z"));
});
