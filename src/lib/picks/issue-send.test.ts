import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeRedis } from "../../../test/fake-redis";

const store = { r: fakeRedis() };
vi.mock("@/lib/redis/client", () => ({ redis: new Proxy({}, { get: (_t, p) => (store.r as Record<string, unknown>)[p as string] }) }));

import { issueAndSend } from "./issue-send";
import { getIssued, loadIssued } from "./issued-store";
import { alreadySent } from "@/lib/email/sent-log";
import type { IssuedRecord } from "./issued";

const rec: IssuedRecord = {
  league: "nfl", season: 2026, week: 6, slot: "tue", issuedAt: "2026-10-13T21:30:00Z", provenance: "issued", subject: "s", ruleVersion: "v",
  rule: null, second: null, suMethod: { id: "avg", label: "a" }, su: [], unverified: [],
  plays: [{ home: "H", away: "A", tier: "t1", side: "home", homeLine: 3, play: "H +3", basis: "reference", shownInEmail: true, units: 1, price: -110 }],
};
const base = { logId: "picks", season: "2026", week: 6, subject: "Week 6 picks", html: "<p>card v1</p>", idempotencyKey: "picks:2026:w6", records: [rec] };

describe("durable issuance", () => {
  beforeEach(() => {
    store.r = fakeRedis();
  });

  it("records intent before sending, then confirms and logs", async () => {
    const send = vi.fn(async () => {
      // At the moment of sending, the bet is already on file as pending.
      expect((await getIssued("nfl", 2026, 6))?.status).toBe("pending");
      return { sent: true as const, id: "e1" };
    });
    const out = await issueAndSend({ ...base, send });
    expect(out.outcome).toBe("sent");
    expect(await getIssued("nfl", 2026, 6)).toMatchObject({ status: "sent", emailId: "e1", idempotencyKey: "picks:2026:w6" });
    expect(await alreadySent("picks", "2026", 6)).toMatchObject({ messageId: "e1" });
  });

  it("a crash after sending is reconciled by resending the stored card under the same key", async () => {
    // Run 1: the email goes, then the process dies before confirming.
    const first = vi.fn(async () => {
      throw new Error("function timed out");
    });
    const out1 = await issueAndSend({ ...base, send: first });
    expect(out1.outcome).toBe("failed");
    expect((await getIssued("nfl", 2026, 6))?.status).toBe("pending");
    expect(await alreadySent("picks", "2026", 6)).toBeNull();
    // Run 2: today's board renders differently, but the card that goes is the recorded one, same key.
    const second = vi.fn(async (_s: string, html: string, key?: string) => ({ sent: true as const, id: key === "picks:2026:w6" && html === "<p>card v1</p>" ? "e1" : "WRONG" }));
    const out2 = await issueAndSend({ ...base, html: "<p>card v2</p>", send: second });
    expect(out2.outcome).toBe("resent-pending");
    expect(second).toHaveBeenCalledTimes(1);
    expect(await getIssued("nfl", 2026, 6)).toMatchObject({ status: "sent", emailId: "e1" });
    expect((await getIssued("nfl", 2026, 6))?.plays[0].play).toBe("H +3");
  });

  it("a confirmed send with a missing log entry is reconciled without a second email", async () => {
    await issueAndSend({ ...base, send: async () => ({ sent: true as const, id: "e1" }) });
    await store.r.del("email:v1:sent:picks:2026:w6");
    const send = vi.fn();
    const out = await issueAndSend({ ...base, send });
    expect(out.outcome).toBe("reconciled");
    expect(send).not.toHaveBeenCalled();
    expect(await alreadySent("picks", "2026", 6)).not.toBeNull();
  });

  it("a refused send drops the intent, so nothing counts as issued", async () => {
    const out = await issueAndSend({ ...base, send: async () => ({ sent: false as const, reason: "422 invalid" }) });
    expect(out.outcome).toBe("failed");
    expect(await getIssued("nfl", 2026, 6)).toBeNull();
    expect(await loadIssued("nfl", 2026)).toEqual([]);
  });

  it("never rewrites a sent record", async () => {
    await issueAndSend({ ...base, send: async () => ({ sent: true as const, id: "e1" }) });
    await issueAndSend({ ...base, records: [{ ...rec, plays: [] }], send: async () => ({ sent: true as const, id: "e2" }) });
    expect((await getIssued("nfl", 2026, 6))?.plays).toHaveLength(1);
  });
});
