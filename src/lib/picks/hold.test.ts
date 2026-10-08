import { describe, expect, it } from "vitest";
import { etDate, heldUntil, releaseOn } from "./hold";

// 2026: EDT until Sun Nov 1 2am, then EST.
const tue = new Date("2026-10-13T21:30:00Z"); // Tue Oct 13, 5:30pm EDT

describe("releaseOn", () => {
  it("is 9am ET on the game's ET day, even for a night game that is the next day in UTC", () => {
    expect(releaseOn(new Date("2026-10-16T00:15:00Z")).toISOString()).toBe("2026-10-15T13:00:00.000Z"); // TNF Thu 8:15pm
  });
  it("is 9am EST on the day the clocks change", () => {
    expect(releaseOn(new Date("2026-11-01T18:00:00Z")).toISOString()).toBe("2026-11-01T14:00:00.000Z");
  });
});

describe("heldUntil", () => {
  it("holds every game until 9am ET on its game day, both sports", () => {
    expect(heldUntil("nfl", "2026-10-16T00:15:00Z", tue)).toBe("2026-10-15T13:00:00.000Z"); // TNF
    expect(heldUntil("nfl", "2026-10-18T17:00:00Z", tue)).toBe("2026-10-18T13:00:00.000Z"); // Sun 1pm
    expect(heldUntil("cfb", "2026-10-17T16:00:00Z", tue)).toBe("2026-10-17T13:00:00.000Z"); // Sat noon
  });
  it("releases a game at 9am on its day, not before", () => {
    expect(heldUntil("nfl", "2026-10-16T00:15:00Z", new Date("2026-10-15T12:59:00Z"))).not.toBeNull();
    expect(heldUntil("nfl", "2026-10-16T00:15:00Z", new Date("2026-10-15T13:00:00Z"))).toBeNull();
  });
  it("a Tuesday-night college game is live after 9am Tuesday", () => {
    expect(heldUntil("cfb", "2026-10-13T23:30:00Z", tue)).toBeNull();
  });
  it("a kickoff before 10am ET releases an hour before kickoff", () => {
    expect(heldUntil("nfl", "2026-10-18T13:30:00Z", tue)).toBe("2026-10-18T12:30:00.000Z"); // London 9:30am
  });
  it("never holds a game without a kickoff", () => {
    expect(heldUntil("nfl", undefined, tue)).toBeNull();
  });
});

describe("etDate", () => {
  it("is the Eastern calendar day", () => {
    expect(etDate(new Date("2026-10-16T00:15:00Z"))).toBe("2026-10-15");
  });
});
