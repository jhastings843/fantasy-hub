import { describe, expect, it } from "vitest";
import type { RefLine } from "./engine";
import { applyShop, norm, parseShop, priceWithBook, teamOf, type OddsGame, type ShopGame } from "./shop";

const ref: RefLine = { line: -10.5, total: 42.5, homePrice: -108, awayPrice: -112, overPrice: -112, underPrice: -108, source: "DraftKings via ESPN", fetchedAt: "2026-10-25T13:00:00Z" };

const shop = (books: ShopGame["books"]): ShopGame => ({ home: "HOU", away: "NYG", commence: "2026-10-25T17:00:00Z", books });

describe("price shopping", () => {
  it("takes FanDuel's -110 at DraftKings' own number (NYG +10.5, Week 7)", () => {
    const out = applyShop(ref, shop({ fanduel: { title: "FanDuel", spread: { home: { point: -10.5, price: -110 }, away: { point: 10.5, price: -110 } } } }), "t");
    expect(out.awayPrice).toBe(-110);
    expect(out.homePrice).toBe(-108); // DK's -108 already beats FanDuel's -110
    expect(out.shop).toEqual({ at: "t", away: "FanDuel", dk: { homePrice: -108, awayPrice: -112, overPrice: -112, underPrice: -108 } });
    expect(priceWithBook("-110", out, "away")).toBe("-110 FanDuel");
    expect(priceWithBook("-108", out, "home")).toBe("-108");
  });

  it("ignores a better price at a different number, and the read's own DraftKings", () => {
    const out = applyShop(
      ref,
      shop({
        fanatics: { title: "Fanatics", spread: { away: { point: 10, price: -102 } } },
        draftkings: { title: "DraftKings", spread: { away: { point: 10.5, price: -105 } } },
      }),
      "t",
    );
    expect(out).toBe(ref);
  });

  it("shops totals and takes the best of several books", () => {
    const out = applyShop(
      ref,
      shop({
        fanduel: { title: "FanDuel", total: { over: { point: 42.5, price: -108 } } },
        fanatics: { title: "Fanatics", total: { over: { point: 42.5, price: +100 } } },
      }),
      "t",
    );
    expect(out.overPrice).toBe(100);
    expect(out.shop?.over).toBe("Fanatics");
  });

  it("names college teams by school, longest first", () => {
    const names = ["texas", "texas tech", "hawaii", "sacramento state", "miami"];
    expect(teamOf("cfb", "Texas Tech Red Raiders", names)).toBe("texas tech");
    expect(teamOf("cfb", "Texas Longhorns", names)).toBe("texas");
    expect(teamOf("cfb", "Hawai'i Rainbow Warriors", names)).toBe("hawaii");
    expect(teamOf("cfb", "Sacramento St Hornets", names)).toBe("sacramento state");
    expect(teamOf("cfb", "Ohio State Buckeyes", names)).toBeNull();
    expect(norm("Texas A&M Aggies")).toBe("texas a and m aggies");
    expect(teamOf("nfl", "New York Giants", [])).toBe("NYG");
  });

  it("parses The Odds API's spreads and totals", () => {
    const body: OddsGame[] = [
      {
        id: "x",
        commence_time: "2026-10-25T17:00:00Z",
        home_team: "Houston Texans",
        away_team: "New York Giants",
        bookmakers: [
          {
            key: "fanduel",
            title: "FanDuel",
            markets: [
              { key: "spreads", outcomes: [{ name: "Houston Texans", price: -110, point: -10.5 }, { name: "New York Giants", price: -110, point: 10.5 }] },
              { key: "totals", outcomes: [{ name: "Over", price: -105, point: 42.5 }, { name: "Under", price: -115, point: 42.5 }] },
            ],
          },
        ],
      },
      { id: "y", commence_time: "2026-10-25T17:00:00Z", home_team: "Nowhere FC", away_team: "New York Giants", bookmakers: [] },
    ];
    const g = parseShop("nfl", body, []);
    expect(g).toHaveLength(1);
    expect(g[0]).toMatchObject({ home: "HOU", away: "NYG", books: { fanduel: { spread: { away: { point: 10.5, price: -110 } }, total: { under: { point: 42.5, price: -115 } } } } });
  });
});
