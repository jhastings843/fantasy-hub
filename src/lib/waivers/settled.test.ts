import { describe, expect, it } from "vitest";
import { leagueHasProcessed, thisWeeksClaims, waiversAreSettled } from "./settled";

const tx = (type: string, status: string) => ({ type, status }) as never;

// Tuesday 9pm ET and Wednesday 1pm ET, in UTC.
const TUESDAY_NIGHT = new Date("2026-09-23T01:00:00Z");
const WEDNESDAY_MORNING = new Date("2026-09-23T13:00:00Z");
const WEDNESDAY_AFTERNOON = new Date("2026-09-23T17:00:00Z");

describe("leagueHasProcessed", () => {
  it("reads a completed claim as the run having happened", () => {
    expect(leagueHasProcessed([tx("waiver", "complete")])).toBe(true);
  });

  it("counts a failed claim too", () => {
    // Losing a bid is proof the run took place, and a week where every claim
    // failed is exactly the week the lineup email needs to know about.
    expect(leagueHasProcessed([tx("waiver", "failed")])).toBe(true);
  });

  it("does not mistake a free agent pickup for a waiver run", () => {
    // These land all week, including the night before waivers process.
    expect(leagueHasProcessed([tx("free_agent", "complete")])).toBe(false);
  });

  it("reads an empty week as not yet", () => {
    expect(leagueHasProcessed([])).toBe(false);
  });
});

describe("waiversAreSettled", () => {
  const settled = { leagueId: "1", name: "Half PPR", transactions: [tx("waiver", "complete")] };
  const pending = { leagueId: "2", name: "Sunday Scaries", transactions: [] };

  it("waits while any league still has claims to run", () => {
    const r = waiversAreSettled([settled, pending], TUESDAY_NIGHT);
    expect(r.settled).toBe(false);
    expect(r.waitingOn).toEqual(["Sunday Scaries"]);
    expect(r.reason).toContain("not the lineup you will have");
  });

  it("goes once every league has run", () => {
    expect(waiversAreSettled([settled], WEDNESDAY_MORNING).settled).toBe(true);
  });

  it("stops waiting after Wednesday noon", () => {
    // A week where nobody in the league put in a claim leaves no trace at all,
    // and an email that never arrives is worse than one with nothing to report.
    const r = waiversAreSettled([pending], WEDNESDAY_AFTERNOON);
    expect(r.settled).toBe(true);
    expect(r.reason).toContain("nothing to wait for");
  });

  it("still waits on Wednesday morning, before the leagues have run", () => {
    expect(waiversAreSettled([pending], WEDNESDAY_MORNING).settled).toBe(false);
  });

  it("does not block when there are no Sleeper leagues to wait on", () => {
    expect(waiversAreSettled([], TUESDAY_NIGHT).settled).toBe(true);
  });
});

describe("thisWeeksClaims", () => {
  // Real stamps from week 3, 2026: last Thursday's rolling claim and the
  // Wednesday run, both filed by Sleeper under week 2.
  const lastThursday = { type: "waiver", status: "complete", status_updated: Date.parse("2026-09-17T07:03:00Z") };
  const wednesdayRun = { type: "waiver", status: "failed", status_updated: Date.parse("2026-09-23T07:13:00Z") };

  it("finds the Wednesday run in the previous week's feed", () => {
    const claims = thisWeeksClaims([[lastThursday, wednesdayRun], []], WEDNESDAY_MORNING);
    expect(claims).toEqual([wednesdayRun]);
    expect(leagueHasProcessed(claims)).toBe(true);
  });

  it("does not read last Thursday's claims as this week's run", () => {
    const claims = thisWeeksClaims([[lastThursday], []], TUESDAY_NIGHT);
    expect(leagueHasProcessed(claims)).toBe(false);
  });

  it("still counts the run on the Thursday fallback day", () => {
    const thursday = new Date("2026-09-24T14:00:00Z");
    expect(thisWeeksClaims([[wednesdayRun]], thursday)).toEqual([wednesdayRun]);
  });
});
