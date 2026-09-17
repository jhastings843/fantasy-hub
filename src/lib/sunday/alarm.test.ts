import { describe, expect, it } from "vitest";
import { lockAlarms, unseenAlarms } from "./alarm";

const pool = {
  pool: "500-entry pool",
  pick: "JAX",
  winProb: 0.8,
  baselineWinProb: 0.8,
  locked: false,
};

const slot = {
  league: "Sunday Scaries #2",
  slot: "WR2",
  player: "Rome Odunze",
  status: null as string | null,
};

describe("lockAlarms", () => {
  it("says nothing when everything is in order", () => {
    expect(lockAlarms({ pools: [pool], slots: [slot] })).toEqual([]);
  });

  it("shouts about a pool with no pick", () => {
    const out = lockAlarms({
      pools: [{ ...pool, pick: null, winProb: null }],
      slots: [],
    });
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("no-pick");
    expect(out[0].text).toContain("500-entry pool");
  });

  it("shouts about an empty starting slot", () => {
    const out = lockAlarms({ pools: [], slots: [{ ...slot, player: null }] });
    expect(out[0].kind).toBe("empty-slot");
    expect(out[0].text).toContain("WR2");
  });

  it("shouts about a starter who is out", () => {
    const out = lockAlarms({ pools: [], slots: [{ ...slot, status: "Out" }] });
    expect(out[0].kind).toBe("unavailable");
    expect(out[0].text).toContain("Rome Odunze");
  });

  it("treats doubtful as worth a look", () => {
    const out = lockAlarms({ pools: [], slots: [{ ...slot, status: "Doubtful" }] });
    expect(out).toHaveLength(1);
  });

  it("ignores a questionable starter", () => {
    // Half the league is questionable on a Sunday morning. An alarm that fires
    // every week is an alarm nobody reads.
    expect(lockAlarms({ pools: [], slots: [{ ...slot, status: "Questionable" }] })).toEqual([]);
  });

  it("shouts when the pick's game has moved against you since Thursday", () => {
    const out = lockAlarms({
      pools: [{ ...pool, winProb: 0.72, baselineWinProb: 0.8 }],
      slots: [],
    });
    expect(out[0].kind).toBe("line-move");
    expect(out[0].text).toContain("8.0");
  });

  it("ignores a small drift", () => {
    const out = lockAlarms({
      pools: [{ ...pool, winProb: 0.77, baselineWinProb: 0.8 }],
      slots: [],
    });
    expect(out).toEqual([]);
  });

  it("ignores a move in your favour", () => {
    const out = lockAlarms({
      pools: [{ ...pool, winProb: 0.9, baselineWinProb: 0.8 }],
      slots: [],
    });
    expect(out).toEqual([]);
  });

  it("stays quiet once the pick's game has kicked off", () => {
    // Nothing can be done, so an alarm is only an upsetting notification.
    const out = lockAlarms({
      pools: [{ ...pool, winProb: 0.6, baselineWinProb: 0.8, locked: true }],
      slots: [],
    });
    expect(out).toEqual([]);
  });

  it("still reports a missing pick after kickoff", () => {
    // A pool with no pick is a strike whether or not a game has started, and
    // Jack may still be able to enter one in a later window.
    const out = lockAlarms({
      pools: [{ ...pool, pick: null, winProb: null, locked: true }],
      slots: [],
    });
    expect(out).toHaveLength(1);
  });

  it("puts the loudest thing first", () => {
    const out = lockAlarms({
      pools: [
        { ...pool, winProb: 0.6, baselineWinProb: 0.8 },
        { ...pool, pool: "30-entry pool", pick: null, winProb: null },
      ],
      slots: [{ ...slot, player: null }],
    });
    expect(out.map((r) => r.kind)).toEqual(["no-pick", "empty-slot", "line-move"]);
  });
});

describe("alarm keys and what counts as new", () => {
  it("keys a problem by what it is about, not by the words", () => {
    const [doubtful] = lockAlarms({ pools: [], slots: [{ ...slot, status: "Doubtful" }] });
    const [out] = lockAlarms({ pools: [], slots: [{ ...slot, status: "Out" }] });
    expect(doubtful.key).toBe(out.key);
    expect(doubtful.key).toContain("Rome Odunze");
  });

  it("keeps two empty slots in the same league apart, even with the same label", () => {
    // A lineup has two WR slots and often two FLEX, and both are labelled
    // by position alone. The second FLEX going empty at 12:30 is news.
    const out = lockAlarms({
      pools: [],
      slots: [
        { ...slot, slot: "FLEX", index: 6, player: null },
        { ...slot, slot: "FLEX", index: 7, player: null },
      ],
    });
    expect(new Set(out.map((r) => r.key)).size).toBe(2);
  });

  it("reports only problems the week's earlier alarm did not cover", () => {
    const reasons = lockAlarms({
      pools: [{ ...pool, pick: null, winProb: null }],
      slots: [{ ...slot, status: "Out" }],
    });
    const sentKeys = [reasons[0].key];
    // The 11:45 alarm went out about the pool. At 12:30 the receiver is ruled
    // out: that is new information, and the week's one email must not eat it.
    expect(unseenAlarms(reasons, sentKeys).map((r) => r.kind)).toEqual(["unavailable"]);
    expect(unseenAlarms(reasons, reasons.map((r) => r.key))).toEqual([]);
    expect(unseenAlarms(reasons, [])).toHaveLength(2);
  });
});
