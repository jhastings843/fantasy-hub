import { describe, expect, it } from "vitest";
import { ago, rowFor, sortRows } from "./core";

const now = new Date("2026-11-07T00:30:00Z");

describe("status rows", () => {
  it("names pulse jobs and groups outside sources", () => {
    const r = rowFor("Pulse harris-cbb", { streak: 5, pushed: true, last: "no rows matched", at: "2026-11-07T00:15:00Z" }, now);
    expect(r).toMatchObject({ group: "Outside sources", name: "Harris CBB", health: "failing", streak: 5, error: "no rows matched" });
  });
  it("a clean job is ok; a long-silent one is quiet; a pre-timestamp one is unknown", () => {
    expect(rowFor("Props capture", { streak: 0, pushed: false, at: "2026-11-06T23:00:00Z", okAt: "2026-11-06T23:00:00Z" }, now).health).toBe("ok");
    expect(rowFor("Pulse tracker", { streak: 0, pushed: false, at: "2026-10-20T00:00:00Z" }, now).health).toBe("quiet");
    expect(rowFor("Line archive", { streak: 0, pushed: false }, now).health).toBe("unknown");
  });
  it("hides old error text once the job is clean", () => {
    expect(rowFor("Pulse cbb", { streak: 0, pushed: false, last: "old", at: "2026-11-07T00:00:00Z" }, now).error).toBeUndefined();
  });
  it("sorts by group, failing first", () => {
    const rows = sortRows([
      rowFor("Pulse tracker", { streak: 0, pushed: false, at: "2026-11-07T00:00:00Z" }, now),
      rowFor("Props capture", { streak: 0, pushed: false, at: "2026-11-07T00:00:00Z" }, now),
      rowFor("Pulse cbb", { streak: 1, pushed: false, at: "2026-11-07T00:00:00Z" }, now),
    ]);
    expect(rows.map((r) => r.name)).toEqual(["College hoops board", "Bet tracker", "Props capture"]);
  });
  it("ago", () => {
    expect(ago("2026-11-07T00:29:50Z", now)).toBe("just now");
    expect(ago("2026-11-07T00:18:00Z", now)).toBe("12 min ago");
    expect(ago("2026-11-06T21:30:00Z", now)).toBe("3 h ago");
    expect(ago("2026-11-04T00:30:00Z", now)).toBe("3 days ago");
    expect(ago(undefined, now)).toBeNull();
  });
});
