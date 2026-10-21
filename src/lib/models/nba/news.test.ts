import { describe, expect, it } from "vitest";
import type { PropMarket } from "@/lib/props/parse";
import { affected, changes, followup, readFeed } from "./news";

const mk = (id: string, model: number, line: number, over: number, under: number, side: "over" | "under" | null = null): PropMarket =>
  ({
    id,
    stat: id.split("|")[0],
    statLabel: "Points",
    player: id.split("|")[1],
    team: "CLE",
    model,
    line,
    gap: null,
    clears: side !== null,
    weight: null,
    books: [{ book: "DraftKings", line, over, under, win: side !== null }],
    consensus: line,
    side,
    lean: null,
  }) as PropMarket;

describe("injury feed", () => {
  it("reads ids from the player link", () => {
    const f = readFeed({ injuries: [{ injuries: [{ status: "Out", shortComment: "ankle", athlete: { displayName: "A B", links: [{ href: "https://www.espn.com/nba/player/_/id/4712863/a-b" }], team: { abbreviation: "ATL" } } }] }] });
    expect(f).toEqual([{ id: "4712863", name: "A B", team: "ATL", status: "Out", comment: "ankle" }]);
  });

  it("finds new outs and players back from out, nothing else", () => {
    const now = [
      { id: "1", name: "New Out", team: "CLE", status: "Out", comment: "" },
      { id: "2", name: "Still Out", team: "CLE", status: "Out", comment: "" },
      { id: "3", name: "Now DTD", team: "CLE", status: "Day-To-Day", comment: "" },
      { id: "5", name: "Was DTD", team: "CLE", status: "Out", comment: "" },
    ];
    const c = changes({ "2": "Out", "3": "Out", "4": "Out", "5": "Day-To-Day" }, now, { "4": { name: "Gone", team: "CLE" } });
    expect(c.map((x) => `${x.name}:${x.change}`).sort()).toEqual(["Gone:back", "New Out:out", "Now DTD:back", "Was DTD:out"]);
  });
});

describe("affected props", () => {
  const before = [mk("pts|Mobley", 18, 17.5, -110, -110), mk("reb|Mobley", 9, 9.5, -110, -110), mk("pts|Allen", 12, 12.5, -110, -110)];
  const after = [mk("pts|Mobley", 20.4, 17.5, -110, -110, "over"), mk("reb|Mobley", 9.1, 9.5, -110, -110), mk("pts|Allen", 13.5, 12.5, -110, -110)];
  const extra = { "pts|Mobley": { over: 0.66, under: 0.34, games: 4 }, "pts|Allen": { over: 0.55, under: 0.45, games: 2 } };
  const a = affected(before, after, extra);

  it("keeps props that moved, biggest move first, with the edge flag", () => {
    expect(a.map((x) => x.id)).toEqual(["pts|Mobley", "pts|Allen"]);
    expect(a[0]).toMatchObject({ side: "over", price: -110, chance: 0.66, fair: 0.5, gap: 0.16, edge: true });
    expect(a[1].edge).toBe(false); // no DK edge flag, and only 2 games
  });

  it("follows DK to its last pregame line", () => {
    const f = followup(a[0], mk("pts|Mobley", 20.4, 19.5, -110, -110), "W");
    expect(f).toMatchObject({ line: 19.5, lineMove: 2, outcome: "W" });
    const g = followup(a[0], mk("pts|Mobley", 20.4, 17.5, -140, 110));
    expect(g.lineMove).toBe(0);
    expect(g.fairMove).toBeGreaterThan(0.05);
  });
});
