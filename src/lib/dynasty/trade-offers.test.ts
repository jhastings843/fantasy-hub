import { describe, expect, it } from "vitest";
import type { PlayerRow, TeamSummary } from "./power-rankings";
import { chanceFor, tradeOffers } from "./trade-offers";

function player(id: string, position: string, value: number, extra: Partial<PlayerRow> = {}): PlayerRow {
  return { id, name: id, position, value, age: 25, team: null, overallRank: 0, positionRank: 0, ...extra };
}

function league(rosters: PlayerRow[][]): TeamSummary[] {
  const teams = rosters.map((players, i) => ({
    rosterId: i + 1, ownerName: `Team ${i + 1}`, players,
    totalValue: players.reduce((sum, p) => sum + p.value, 0),
    positionTotals: Object.fromEntries(["QB", "RB", "WR", "TE"].map((pos) =>
      [pos, players.filter((p) => p.position === pos).reduce((sum, p) => sum + p.value, 0)])),
    positionRanks: {} as Record<string, number>,
  }));
  for (const team of teams) {
    for (const pos of ["QB", "RB", "WR", "TE"]) {
      team.positionRanks[pos] = 1 + teams.filter((other) => other.positionTotals[pos] > team.positionTotals[pos]).length;
    }
  }
  return teams;
}

// Me: deep at WR, thin at TE. Team 2: deep at TE, thin at WR. Team 3 and 4
// have nothing that fits, so they get no offer.
function fixture() {
  return league([
    [player("myWR1", "WR", 4000), player("myWR2", "WR", 3000), player("myWR3", "WR", 2500), player("myTE", "TE", 300), player("myRB", "RB", 2000)],
    [player("theirTE1", "TE", 2600, { marketValue: 2200, jinglesPositionRank: 3, marketPositionRank: 6 }), player("theirTE2", "TE", 1800), player("theirWR", "WR", 400), player("theirRB", "RB", 2000)],
    [player("cWR", "WR", 2000), player("cTE", "TE", 1000), player("cRB", "RB", 2000)],
    [player("dWR", "WR", 1500), player("dTE", "TE", 900), player("dRB", "RB", 2100)],
  ]);
}

describe("tradeOffers", () => {
  it("gives at most one offer per partner, best first, with a message to send", () => {
    const teams = fixture();
    const offers = tradeOffers(teams[0], teams, teams.length);
    const partners = offers.map((o) => o.partnerRosterId);
    expect(new Set(partners).size).toBe(partners.length);
    const toTwo = offers.find((o) => o.partnerRosterId === 2);
    expect(toTwo).toBeDefined();
    expect(toTwo!.receive.some((p) => p.position === "TE")).toBe(true);
    expect(toTwo!.message).toContain("Team 2");
    expect(toTwo!.message).toMatch(/would you do/i);
  });

  it("explains both sides: our room, their room, the value and his list", () => {
    const teams = fixture();
    const toTwo = tradeOffers(teams[0], teams, teams.length).find((o) => o.partnerRosterId === 2)!;
    const why = toTwo.why.join(" | ");
    expect(why).toMatch(/Your TE room goes from #4 to #/);
    expect(why).toMatch(/Their WR room/);
    expect(why).toMatch(/value/i);
    expect(why).toMatch(/Jingles/);
  });

  it("never offers an untouchable", () => {
    const teams = fixture();
    for (const p of teams[0].players) if (p.position === "WR") p.untouchable = true;
    expect(tradeOffers(teams[0], teams, teams.length).every((o) => o.send.every((p) => !p.untouchable))).toBe(true);
  });
});

describe("chanceFor", () => {
  it("reads the partner's own score as a plain chance", () => {
    expect(chanceFor(20).label).toBe("Likely yes");
    expect(chanceFor(8).label).toBe("Good shot");
    expect(chanceFor(0).label).toBe("Coin flip");
  });
});
