import { describe, expect, it } from "vitest";
import { heldUntil, nextNflRelease } from "./hold";

// 2026: EDT until Sun Nov 1 2am, then EST.
const tue = new Date("2026-10-13T21:30:00Z"); // Tue Oct 13, 5:30pm EDT
const sunRelease = "2026-10-18T13:00:00.000Z"; // Sun Oct 18, 9:00am EDT

describe("nextNflRelease", () => {
  it("is the coming Sunday 9am ET", () => {
    expect(nextNflRelease(tue).toISOString()).toBe(sunRelease);
  });
  it("on Sunday before 9am it is that morning; after 9am it is next week", () => {
    expect(nextNflRelease(new Date("2026-10-18T12:00:00Z")).toISOString()).toBe(sunRelease);
    expect(nextNflRelease(new Date("2026-10-18T13:00:00Z")).toISOString()).toBe("2026-10-25T13:00:00.000Z");
  });
  it("lands on 9am EST across the November DST change", () => {
    expect(nextNflRelease(new Date("2026-10-27T21:30:00Z")).toISOString()).toBe("2026-11-01T14:00:00.000Z");
  });
});

describe("heldUntil", () => {
  it("holds Sunday and Monday NFL games on Tuesday, not Thursday's", () => {
    expect(heldUntil("nfl", "2026-10-15T00:15:00Z", tue)).toBeNull(); // TNF
    expect(heldUntil("nfl", "2026-10-18T17:00:00Z", tue)).toBe(sunRelease); // Sun 1pm
    expect(heldUntil("nfl", "2026-10-20T00:15:00Z", tue)).toBe(sunRelease); // MNF
  });
  it("releases everything at the Sunday brief", () => {
    const brief = new Date("2026-10-18T13:00:00Z");
    expect(heldUntil("nfl", "2026-10-18T17:00:00Z", brief)).toBeNull();
    expect(heldUntil("nfl", "2026-10-20T00:15:00Z", brief)).toBeNull();
  });
  it("never holds college or a game without a kickoff", () => {
    expect(heldUntil("cfb", "2026-10-17T16:00:00Z", tue)).toBeNull();
    expect(heldUntil("nfl", undefined, tue)).toBeNull();
  });
});
