import { describe, expect, it } from "vitest";
import { partialFailure } from "./outcome";

describe("partialFailure", () => {
  it("is silent when everything worked", () => {
    expect(partialFailure("leagues rebuilt", 3, [])).toBeNull();
  });

  it("names what failed, so a job that half worked is not a job that worked", () => {
    // The waiver refresh reported "0 of 3 leagues rebuilt" as a success,
    // because it returned normally. A refresh that rebuilt nothing is a
    // failure with a friendly sentence attached.
    const msg = partialFailure("leagues rebuilt", 3, [
      "Sunday Scaries #2: RosterAudit request failed: 404",
      "Dah Dynasty: timed out",
    ]);
    expect(msg).toBe(
      "1 of 3 leagues rebuilt. Failed: Sunday Scaries #2: RosterAudit request failed: 404; Dah Dynasty: timed out",
    );
  });
});
