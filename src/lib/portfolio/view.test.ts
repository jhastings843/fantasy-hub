import { describe, expect, it } from "vitest";
import { fixture } from "./fixture";
import { capState, groupActions, groupHoldings, indexHistory, pctSigned, sortIdeas, staleNotes, taxLine, usd, usdSigned } from "./view";

describe("portfolio view helpers", () => {
  it("formats money and percents with signs", () => {
    expect(usd(50000)).toBe("$50,000");
    expect(usd(-1000)).toBe("−$1,000");
    expect(usdSigned(1204)).toBe("+$1,204");
    expect(pctSigned(-1.96, 2)).toBe("−1.96%");
    expect(usd(undefined)).toBe("n/a");
  });

  it("orders actions Sell, Buy now, Buy at a set price, Wait, Hold", () => {
    expect(groupActions(fixture().advisor!.actions).map((g) => g.label)).toEqual(["Sell", "Buy now", "Buy at a set price", "Wait", "Hold"]);
  });

  it("puts ready ideas first and dropped ones last; missing is []", () => {
    expect(sortIdeas(fixture().advisor!.ideas).map((i) => i.symbol)).toEqual(["GGG", "EEE", "FFF"]);
    expect(sortIdeas(undefined)).toEqual([]);
  });

  it("writes tax lines from Jack's side", () => {
    expect(taxLine(-597)).toBe("tax loss $597");
    expect(taxLine(163)).toBe("taxable gain $163");
    expect(taxLine(undefined)).toBeNull();
  });

  it("groups holdings by bucket, biggest first", () => {
    const g = groupHoldings(fixture().holdings);
    expect(g.map((x) => x.key)).toEqual(["core", "bet", "employer", "cash"]);
    expect(g[0].items.map((h) => h.symbol)).toEqual(["AAA", "DDD"]);
    expect(g[0].value).toBe(32000);
  });

  it("flags holdings older than 7 days and a missing advisor", () => {
    const s = fixture();
    expect(staleNotes(s)).toEqual([]);
    s.holdingsFrom = "2026-10-28";
    delete s.advisor;
    expect(staleNotes(s)).toEqual([
      "Holdings are from Oct 28. Download a new positions file from Fidelity after you trade.",
      "Today's advice didn't run; numbers are current.",
    ]);
  });

  it("indexes history to 100 and needs 2 points", () => {
    const h = indexHistory(fixture().history);
    expect(h.total[0].y).toBe(100);
    expect(h.spx[0].y).toBe(100);
    expect(h.total.at(-1)!.y).toBeCloseTo(98.04, 2);
    expect(indexHistory([{ date: "2026-11-05", total: 1 }]).total).toEqual([]);
  });

  it("marks a sleeve over its cap", () => {
    expect(capState(11, 10)).toBe("over");
    expect(capState(9.5, 10)).toBe("near");
    expect(capState(6, 8)).toBe("ok");
    expect(capState(null, 8)).toBe("unknown");
  });
});

describe("liveActions", () => {
  it("drops placed rows, marks held and to-do, and treats a sold-out name as placed", async () => {
    const { liveActions } = await import("./view");
    const actions = [
      { kind: "sell", symbol: "AIS" },
      { kind: "sell", symbol: "ABAT" },
      { kind: "sell", symbol: "GONE" },
      { kind: "sell", symbol: "KEEP" },
      { kind: "buy", symbol: "VOO", amount: 5000 },
      { kind: "buy", symbol: "AVGO", amount: 400 },
      { kind: "limit", symbol: "VOO", amount: 1290 },
      { kind: "hold", symbol: "NVDA" },
    ];
    const moves = [
      { id: "1", kind: "swap", sell: "AIS", buy: "VOO", status: "done" },
      { id: "2", kind: "swap", sell: "ABAT", buy: "VOO", status: "held", revisit: "2026-11-10" },
      { id: "3", kind: "swap", sell: "SMR", buy: "AVGO", status: "alerted" },
      { id: "4", kind: "limit", buy: "VOO", status: "done" },
    ];
    const holdings = [{ symbol: "ABAT" }, { symbol: "KEEP" }, { symbol: "VOO" }, { symbol: "NVDA" }];
    const r = liveActions(actions as never, moves as never, holdings as never);
    expect(r.placed).toBe(4); // AIS, GONE, VOO buy (all non-held VOO swaps done), VOO limit
    expect(r.rows.map((x) => [x.a.symbol, x.a.kind, x.status, x.until ?? null])).toEqual([
      ["ABAT", "sell", "held", "2026-11-10"],
      ["KEEP", "sell", null, null],
      ["AVGO", "buy", "todo", null],
      ["NVDA", "hold", null, null],
    ]);
  });
});

