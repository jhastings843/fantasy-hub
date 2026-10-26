import { describe, expect, it } from "vitest";
import { bestBets, bestCost, bookPrice } from "./ftd-price";
import type { FtdGame } from "@/lib/firsttd/parse";

const kalshi = (ask: number) => ({ players: [{ name: "Ja'Marr Chase", ask }] }) as never;
const dk = (price: number) => ({ at: "x", prices: { jamarrchase: price } });

describe("best First TD price", () => {
  it("matches a board name to a book key", () => {
    expect(bookPrice(dk(650), "J.Chase")).toBe(650);
    expect(bookPrice(dk(650), "T.Higgins")).toBeNull();
  });

  it("takes the cheaper of Kalshi with fee and DK", () => {
    const k = bestCost({ kalshi: kalshi(0.14) }, "J.Chase")!;
    expect(k.book).toBe("kalshi");
    const b = bestCost({ kalshi: kalshi(0.14), dk: dk(650) }, "J.Chase")!;
    expect(b.book).toBe("dk");
    expect(b.cost).toBeCloseTo(100 / 750, 6);
    expect(bestCost({ kalshi: kalshi(0.1), dk: dk(650) }, "J.Chase")!.book).toBe("kalshi");
    expect(bestCost({}, "J.Chase")).toBeNull();
  });

  it("grades a winning bet at the best price", () => {
    const game = { teams: [{ team: "CIN", pFirst: 0.5, players: [{ key: "CIN_J.Chase", name: "J.Chase", team: "CIN", p: 0.2, thin: false, out: false, touches: 0, tds: 0 }], rest: 0, thin: 0 }] } as unknown as FtdGame;
    const result = { key: "CIN_J.Chase" } as never;
    const bets = bestBets([{ game, result, kalshi: kalshi(0.14), dk: dk(650) }], (p, c) => p.p > c);
    expect(bets).toHaveLength(1);
    expect(bets[0].book).toBe("dk");
    expect(bets[0].net).toBeCloseTo(6.5, 6);
  });
});
