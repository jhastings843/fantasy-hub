import { describe, expect, it } from "vitest";
import { MAX_TRIES, afterAnswer, isDone, unusable } from "../../../scripts/relay-retry.mjs";

const now = new Date("2026-11-03T22:00:00Z");
// The three Harris answers that went unnoticed (weeks 8 to 10).
const harrisW10 = { ok: true, week: 10, games: 0, picks: 13, verified: false, problems: [] };
const pemW10 = { ok: true, week: 10, games: 62, verified: true, problems: [] };

describe("relay retry", () => {
  it("treats ok with games 0 or verified false as unusable", () => {
    expect(unusable(harrisW10)).toBe(true);
    expect(unusable({ ok: true, games: 40, verified: false })).toBe(true);
    expect(unusable(pemW10)).toBe(false);
    expect(unusable({ ok: true, skipped: true, reason: "already read this post" })).toBe(false);
    expect(unusable({ ok: false, error: "x" })).toBe(false);
  });

  it("marks a verified card done with no alert", () => {
    const r = afterAnswer(undefined, pemW10, "PEM card", "", now);
    expect(r.alert).toBeNull();
    expect(isDone(r.entry)).toBe(true);
  });

  it("stores nothing for a failed answer", () => {
    expect(afterAnswer(undefined, { ok: false, error: "boom" }, "PEM card")).toEqual({ entry: null, alert: null });
  });

  it("retries an unusable sheet up to MAX_TRIES, alerting on the first and last try", () => {
    let entry: ReturnType<typeof afterAnswer>["entry"] | undefined;
    const alerts: string[] = [];
    for (let i = 0; i < MAX_TRIES; i++) {
      expect(isDone(entry)).toBe(false);
      const r = afterAnswer(entry, harrisW10, "Harris sheet", "1 image on the post", now);
      entry = r.entry!;
      if (r.alert) alerts.push(r.alert.title);
    }
    expect(entry && "tries" in entry ? entry.tries : 0).toBe(MAX_TRIES);
    expect(isDone(entry)).toBe(true);
    expect(alerts).toEqual(["Harris sheet: post read but not usable", `Harris sheet: gave up after ${MAX_TRIES} tries`]);
  });

  it("stops retrying once a later try verifies", () => {
    const first = afterAnswer(undefined, harrisW10, "Harris sheet", "", now).entry!;
    const second = afterAnswer(first, { ...harrisW10, games: 40, verified: true }, "Harris sheet", "", now);
    expect(second.alert).toBeNull();
    expect(isDone(second.entry)).toBe(true);
  });

  it("leaves entries from before tries were counted as done", () => {
    expect(isDone({ at: "2026-10-20T22:43:47.270Z", result: { ok: true, week: 8, games: 0, picks: 6, verified: false } })).toBe(true);
    expect(isDone(undefined)).toBe(false);
  });
});
