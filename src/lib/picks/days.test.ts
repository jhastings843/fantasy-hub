import { describe, expect, it } from "vitest";
import { groupByDay } from "./days";

const g = (id: string, kickoff?: string) => ({ id, kickoff });
const k = (x: { kickoff?: string }) => x.kickoff;
// Thu Oct 8 2026, 10:30am ET
const now = new Date("2026-10-08T14:30:00Z");

describe("groupByDay", () => {
  it("labels today and tomorrow, orders days by kickoff, puts TBD last", () => {
    const out = groupByDay(
      [g("sun", "2026-10-11T17:00:00Z"), g("tbd"), g("thu", "2026-10-09T00:15:00Z"), g("fri", "2026-10-09T23:00:00Z"), g("sat", "2026-10-10T16:00:00Z")],
      k,
      now,
    );
    expect(out.map((d) => d.label)).toEqual(["Today · Thu", "Tomorrow · Fri", "Saturday", "Sunday", "Time TBD"]);
  });

  it("uses the Eastern day: 8:15pm Thursday ET is 00:15 UTC Friday but stays Thursday", () => {
    const out = groupByDay([g("tnf", "2026-10-09T00:15:00Z")], k, now);
    expect(out[0]).toMatchObject({ key: "2026-10-08", label: "Today · Thu" });
  });

  it("keeps games of one day together in kickoff order", () => {
    const out = groupByDay([g("late", "2026-10-11T20:25:00Z"), g("early", "2026-10-11T17:00:00Z")], k, now);
    expect(out).toHaveLength(1);
    expect(out[0].games.map((x) => x.id)).toEqual(["early", "late"]);
  });
});
