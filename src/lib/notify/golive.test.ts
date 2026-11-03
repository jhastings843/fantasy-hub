import { beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, unknown>();
vi.mock("server-only", () => ({}));
vi.mock("@/lib/redis/client", () => ({
  redis: {
    set: vi.fn(async (k: string, v: unknown, o?: { nx?: boolean }) => {
      if (o?.nx && store.has(k)) return null;
      store.set(k, v);
      return "OK";
    }),
    getset: vi.fn(async (k: string, v: unknown) => {
      const old = store.has(k) ? store.get(k) : null;
      store.set(k, v);
      return old;
    }),
  },
}));
const pushes: { title: string; message: string }[] = [];
vi.mock("./pushover", () => ({ push: vi.fn(async (p: { title: string; message: string }) => (pushes.push(p), { pushed: true })) }));

import { alertFor, alertKind, nbaGatePush, notifyJournal, notifyNbaGate, recordSince } from "./golive";
import type { JournalLine, SectionState } from "@/lib/learning/engine";

const at = "2026-11-02T12:00:00.000Z";
const activated: JournalLine = { at, week: 3, kind: "activated", id: "edge:under", text: "Activated Edges on the under: 55 bets over 31 games, +9.4u, t 2.5." };
const paused: JournalLine = { at, week: 3, kind: "rolled back", id: "edge:under", text: "Paused Edges on the under for the rest of week 3: down 10.5u this week, past its 10u cap." };
const rolled: JournalLine = { at, week: 3, kind: "rolled back", id: "edge:under", text: "Rolled back Edges on the under: lost since going live: 20 games, -8u, t -1.9." };
const review: JournalLine = { at, week: 3, kind: "review", text: "Reviewed 10 slices." };
const state: SectionState = { v: 1, section: "nba-props-ours", entries: { "edge:under": { id: "edge:under", label: "Edges on the under", status: "active", registeredAt: "2026-10-01T00:00:00.000Z", registeredWeek: 1 } } };
const cands = [{ id: "edge:under", label: "Edges on the under", bets: [{ game: "a", week: 1, at: "2026-10-02T00:00:00.000Z", net: 0.9 }, { game: "b", week: 1, at: "2026-10-03T00:00:00.000Z", net: -1 }, { game: "c", week: 1, at: "2026-09-01T00:00:00.000Z", net: 5 }] }];

beforeEach(() => {
  store.clear();
  pushes.length = 0;
});

describe("alertKind", () => {
  it("reads live, paused and rolled back; nothing else pushes", () => {
    expect(alertKind(activated)).toBe("live");
    expect(alertKind(paused)).toBe("paused");
    expect(alertKind(rolled)).toBe("rolled back");
    expect(alertKind(review)).toBeNull();
    expect(alertKind({ ...activated, kind: "registered" })).toBeNull();
  });
});

describe("alertFor", () => {
  it("names the section and the record, no em dashes", () => {
    const p = alertFor("nba-props-ours", activated, { w: 34, l: 21, units: 9.42 }, "Unders 2+ pts")!;
    expect(p.title).toBe("Now live: NBA props");
    expect(p.message).toBe("NBA props: Unders 2+ pts is now live (34-21, +9.4u). Its bets are sized by the section's staking scheme (flat 1u unless it has switched).");
    expect(p.message).not.toMatch(/—/);
  });
  it("pauses and drops carry the journal text", () => {
    expect(alertFor("nfl-attd-ours", paused)!.title).toBe("Paused: NFL Anytime TD");
    expect(alertFor("nfl-attd-ours", rolled)!.message).toContain("Rolled back Edges on the under");
    expect(alertFor("x", review)).toBeNull();
  });
});

describe("recordSince", () => {
  it("counts bets from registration on", () => {
    expect(recordSince(cands[0], "2026-10-01T00:00:00.000Z")).toEqual({ w: 1, l: 1, units: -0.1 });
  });
});

describe("notifyJournal", () => {
  it("pushes each live/paused/rolled line once, however many reruns", async () => {
    expect(await notifyJournal("nba-props-ours", 2026, [activated, review], state, cands)).toBe(1);
    expect(await notifyJournal("nba-props-ours", 2026, [activated, review], state, cands)).toBe(0);
    expect(pushes).toHaveLength(1);
    expect(pushes[0].message).toContain("Edges on the under is now live (1-1, -0.1u)");
    expect(await notifyJournal("nba-props-ours", 2026, [paused], state, cands)).toBe(1);
  });
});

describe("NBA gate", () => {
  it("pushes on a flip only", async () => {
    expect(await notifyNbaGate(2026, false)).toBe(false); // first read, off: quiet
    expect(await notifyNbaGate(2026, true, { label: "Edge 3+", w: 60, l: 40, units: 14 })).toBe(true);
    expect(await notifyNbaGate(2026, true)).toBe(false);
    expect(await notifyNbaGate(2026, false)).toBe(true);
    expect(pushes.map((p) => p.title)).toEqual(["Now live: NBA picks", "Off: NBA picks"]);
  });
  it("words both ways", () => {
    expect(nbaGatePush(true, { label: "Edge 3+", w: 60, l: 40, units: 14 }).message).toBe("NBA picks are now live: tier bets carry stakes under NBA's own limits (tier 1: Edge 3+, 60-40, +14u).");
    expect(nbaGatePush(false).title).toBe("Off: NBA picks");
  });
});
