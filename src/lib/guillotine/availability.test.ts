import { describe, expect, it } from "vitest";
import { availability, injuryFor } from "./availability";
import type { InjuryNote } from "@/lib/survivor/types";

const espn = (player: string, status: string, comment = ""): InjuryNote => ({
  team: "ARI",
  player,
  position: "QB",
  status,
  comment,
  premium: true,
});

// The three real cases from week 3 of 2026, which is where all of this came
// from. Sleeper had Murray and Nacua flagged Out and was projecting both of
// them as starters; it had Daniels flagged Out and projected at zero.
describe("availability", () => {
  it("believes ESPN over a stale Sleeper tag", () => {
    const a = availability("Out", espn("Kyler Murray", "Active", "His return sends Wentz to the bench."), 17.6);
    expect(a.plays).toBe(1);
    expect(a.disputed).toContain("Sleeper has him Out");
    expect(a.note).toContain("Wentz");
  });

  it("keeps a questionable player as most of a player", () => {
    const a = availability("Out", espn("Puka Nacua", "Questionable", "Groin. McVay hopeful."), 14.4);
    expect(a.plays).toBe(0.75);
    expect(a.disputed).toContain("ESPN has him Questionable");
  });

  it("treats a zeroed projection as the final word", () => {
    // Doubtful at ESPN, but Sleeper has stopped projecting him at all.
    const a = availability("Out", espn("Jayden Daniels", "Doubtful", "Dislocated elbow, no timetable."), 0);
    expect(a.plays).toBe(0);
    expect(a.note).toContain("timetable");
  });

  it("splits the difference when only Sleeper has an opinion and it argues with itself", () => {
    const a = availability("Out", null, 17.6);
    expect(a.plays).toBe(0.5);
    expect(a.disputed).toContain("still projects 17.6 points");
  });

  it("leaves a healthy player alone", () => {
    expect(availability(null, null, 18).plays).toBe(1);
  });

  it("still trusts a Sleeper tag nobody is reporting on", () => {
    expect(availability("Out", null, null).plays).toBe(0);
  });
});

describe("injuryFor", () => {
  const feed = [espn("Kyler Murray", "Active"), espn("Bill Murray", "Active")];

  it("matches the right Murray", () => {
    expect(injuryFor("Kyler Murray", feed)?.status).toBe("Active");
  });

  it("does not match a player who is not in the feed", () => {
    // ESPN lists the hurt, not the healthy, so a miss means no injury.
    expect(injuryFor("Joe Burrow", feed)).toBeNull();
  });
});
