import { describe, expect, it } from "vitest";
import { tempoFor } from "./tempo";

// Every instant here is written in UTC and asserted in New York, which is the
// whole point of the exercise: GitHub Actions fires on UTC and the NFL runs on
// Eastern, so the two hours a year those disagree are exactly when a schedule
// expressed in cron would quietly slip.

/** An ET wall-clock time written as the UTC instant it happens at. */
const at = (iso: string) => new Date(iso);

describe("tempoFor, timed jobs", () => {
  it("refreshes after the early Wednesday waivers while the tier is idle", () => {
    // Wednesday 2026-09-16, 3:30am ET.
    const tempo = tempoFor(at("2026-09-16T07:30:00Z"));
    expect(tempo.tier).toBe("idle");
    expect(tempo.dueJobs).toEqual(["refresh-all-early"]);
  });

  it("does not refresh before its time", () => {
    // Wednesday 2026-09-16, 3:15am ET.
    expect(tempoFor(at("2026-09-16T07:15:00Z")).dueJobs).toEqual([]);
  });

  it("keeps both jobs due after the late Wednesday waivers", () => {
    // Wednesday 2026-09-16, 5:35am ET.
    const tempo = tempoFor(at("2026-09-16T09:35:00Z"));
    expect(tempo.tier).toBe("idle");
    expect(tempo.dueJobs).toEqual(["refresh-all-early", "refresh-all-late"]);
    // Wednesday 11:59pm ET is already Thursday in UTC.
    expect(tempoFor(at("2026-09-17T03:59:00Z")).dueJobs).toEqual(tempo.dueJobs);
    expect(tempoFor(at("2026-09-17T04:00:00Z")).dueJobs).toEqual([]);
  });

  it("does not refresh on Tuesday", () => {
    // Tuesday 2026-09-15, 3:30am ET.
    expect(tempoFor(at("2026-09-15T07:30:00Z")).dueJobs).toEqual([]);
  });

  it("refreshes in March outside the email season", () => {
    // Wednesday 2027-03-10, 3:30am ET. Standard time is still UTC-5.
    expect(tempoFor(at("2027-03-10T08:30:00Z")).dueJobs).toEqual(["refresh-all-early"]);
  });
});

describe("tempoFor, tiers", () => {
  it("is live through Sunday afternoon", () => {
    // Sunday 2026-09-13, 12:15pm ET.
    expect(tempoFor(at("2026-09-13T16:15:00Z")).tier).toBe("live");
  });

  it("is live on Thursday night", () => {
    // Thursday 2026-09-17, 8:30pm ET.
    expect(tempoFor(at("2026-09-18T00:30:00Z")).tier).toBe("live");
  });

  it("is live on Monday night", () => {
    // Monday 2026-09-14, 7:00pm ET.
    expect(tempoFor(at("2026-09-14T23:00:00Z")).tier).toBe("live");
  });

  it("is not live on Sunday evening once the late games are done", () => {
    // Sunday 2026-09-13, 8:30pm ET. The 4pm games are over, the night game is
    // on, and nothing in this app can be acted on until Monday.
    expect(tempoFor(at("2026-09-14T00:30:00Z")).tier).not.toBe("live");
  });

  it("claims the whole hour for the hourly tier, late run or not", () => {
    // Tuesday 2026-09-15, 8:05am and 8:20am ET. Both are the 8am hour. Which
    // of them does the work is the runner's debounce to decide; a minute
    // window here would drop the hour entirely when Actions runs late.
    expect(tempoFor(at("2026-09-15T12:05:00Z")).tier).toBe("hourly");
    expect(tempoFor(at("2026-09-15T12:20:00Z")).tier).toBe("hourly");
  });

  it("does the slow work at 4am", () => {
    // Wednesday 2026-09-16, 4:05am ET.
    expect(tempoFor(at("2026-09-16T08:05:00Z")).tier).toBe("overnight");
  });

  it("sleeps overnight", () => {
    // Wednesday 2026-09-16, 2:00am ET.
    expect(tempoFor(at("2026-09-16T06:00:00Z")).tier).toBe("idle");
  });

  it("reads the window in Eastern time in January, not in UTC", () => {
    // Sunday 2026-01-11, 1:00pm ET. Standard time, so UTC-5: a schedule
    // written in UTC for the summer would have this an hour out.
    const t = tempoFor(at("2026-01-11T18:00:00Z"));
    expect(t.tier).toBe("live");
    expect(t.et.hour).toBe(13);
  });
});

describe("tempoFor, the season", () => {
  it("has no live windows in August", () => {
    // Sunday 2026-08-16, 12:05pm ET. Preseason: rankings and values still move,
    // nothing needs watching by the quarter hour.
    expect(tempoFor(at("2026-08-16T16:05:00Z")).tier).toBe("hourly");
  });

  it("only does the overnight run in the true offseason", () => {
    // Sunday 2026-03-15. Nothing to refresh but values.
    expect(tempoFor(at("2026-03-15T16:05:00Z")).tier).toBe("idle");
    expect(tempoFor(at("2026-03-15T08:05:00Z")).tier).toBe("overnight");
  });

  it("sends nothing in the offseason", () => {
    // Sunday 2026-03-15, 9:00am ET: the Sunday send's own time.
    expect(tempoFor(at("2026-03-15T13:00:00Z")).dueSends).toEqual([]);
  });
});

describe("tempoFor, sends", () => {
  it("puts each send on its own morning", () => {
    expect(tempoFor(at("2026-09-15T12:00:00Z")).dueSends).toContain("faab");
    expect(tempoFor(at("2026-09-16T12:00:00Z")).dueSends).toContain("midweek");
    expect(tempoFor(at("2026-09-17T12:00:00Z")).dueSends).toContain("thursday");
    expect(tempoFor(at("2026-09-13T13:00:00Z")).dueSends).toContain("sunday");
  });

  it("does not send before its time", () => {
    // Thursday 7:45am ET, fifteen minutes early.
    expect(tempoFor(at("2026-09-17T11:45:00Z")).dueSends).not.toContain("thursday");
  });

  it("keeps a missed send due for the rest of the day", () => {
    // Tuesday 8:20pm ET. Actions was down all morning; the send log is what
    // stops this going out twice, not the clock.
    expect(tempoFor(at("2026-09-16T00:20:00Z")).dueSends).toContain("faab");
  });

  it("stops being due the next day", () => {
    // Wednesday 8:00am ET is the midweek send's morning, not FAAB's.
    const due = tempoFor(at("2026-09-16T12:00:00Z")).dueSends;
    expect(due).toContain("midweek");
    expect(due).not.toContain("faab");
  });

  it("holds the Sunday alarm until inactives have landed", () => {
    const nine = tempoFor(at("2026-09-13T13:00:00Z")).dueSends;
    expect(nine).toContain("sunday");
    expect(nine).not.toContain("alarm");

    const quarterTo = tempoFor(at("2026-09-13T15:45:00Z")).dueSends;
    expect(quarterTo).toContain("alarm");
  });

  it("stops the alarm once the afternoon games are under way", () => {
    // Sunday 4:30pm ET. Everything it could shout about is locked, and an
    // alarm nobody can act on is the noise this send exists to avoid.
    expect(tempoFor(at("2026-09-13T20:30:00Z")).dueSends).not.toContain("alarm");
  });

  it("follows a configured send day", () => {
    // The commissioner drops the chopped roster on Wednesday one week.
    const due = tempoFor(at("2026-09-16T12:00:00Z"), { faabDay: 3 }).dueSends;
    expect(due).toContain("faab");
  });
});
