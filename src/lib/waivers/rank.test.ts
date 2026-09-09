import { describe, expect, it } from "vitest";
import { waiverTargets, type WaiverPlayer } from "./rank";

function p(
  over: Partial<WaiverPlayer> & { playerId: string; position: string },
): WaiverPlayer {
  return {
    name: over.playerId,
    team: "XXX",
    positionalRank: null,
    flexRank: null,
    adjustedFlexRank: null,
    opponent: "YYY",
    home: true,
    injuryStatus: null,
    onBye: false,
    unranked: false,
    seasonRank: null,
    seasonPositionRank: null,
    tier: null,
    ...over,
  } as WaiverPlayer;
}

const SLOTS = ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "FLEX", "BN", "BN"];

const roster = [
  p({ playerId: "qb1", position: "QB", positionalRank: 3, seasonRank: 40 }),
  p({ playerId: "rb1", position: "RB", positionalRank: 2, flexRank: 2, seasonRank: 5 }),
  p({ playerId: "rb2", position: "RB", positionalRank: 20, flexRank: 40, seasonRank: 55 }),
  p({ playerId: "wr1", position: "WR", positionalRank: 5, flexRank: 8, seasonRank: 12 }),
  p({ playerId: "wr2", position: "WR", positionalRank: 30, flexRank: 60, seasonRank: 70 }),
  p({ playerId: "te1", position: "TE", positionalRank: 4, flexRank: 30, seasonRank: 45 }),
  p({ playerId: "rb3", position: "RB", positionalRank: 45, flexRank: 120, seasonRank: 150 }),
  p({ playerId: "wr3", position: "WR", positionalRank: 70, flexRank: 140, seasonRank: 210 }),
  // Deep bench, nobody's idea of a starter.
  p({ playerId: "benchA", position: "WR", unranked: true, seasonRank: 260 }),
  p({ playerId: "benchB", position: "RB", unranked: true, seasonRank: null }),
];

describe("waiverTargets", () => {
  describe("this week", () => {
    it("says nothing when nobody on the wire would start", () => {
      const free = [
        p({ playerId: "faDeep", position: "WR", positionalRank: 90, flexRank: 149, seasonRank: 180 }),
      ];
      const r = waiverTargets({ rosterPositions: SLOTS, roster, freeAgents: free });
      expect(r.startable).toHaveLength(0);
    });

    it("names a free agent who would crack the lineup, and who he pushes out", () => {
      const free = [p({ playerId: "faStud", position: "WR", positionalRank: 1, flexRank: 1, seasonRank: 3 })];
      const r = waiverTargets({ rosterPositions: SLOTS, roster, freeAgents: free });
      expect(r.startable).toHaveLength(1);
      expect(r.startable[0].player.playerId).toBe("faStud");
      expect(r.startable[0].displaces?.playerId).toBe("wr3");
    });

    it("never suggests a free agent who cannot play", () => {
      const free = [
        p({ playerId: "faHurt", position: "WR", flexRank: 1, injuryStatus: "Out" }),
        p({ playerId: "faBye", position: "WR", flexRank: 1, onBye: true }),
      ];
      const r = waiverTargets({ rosterPositions: SLOTS, roster, freeAgents: free });
      expect(r.startable).toHaveLength(0);
    });

    it("orders by his weekly ranking, best first", () => {
      const free = [
        p({ playerId: "faOk", position: "WR", flexRank: 20, seasonRank: 60 }),
        p({ playerId: "faBest", position: "WR", flexRank: 1, seasonRank: 3 }),
      ];
      const r = waiverTargets({ rosterPositions: SLOTS, roster, freeAgents: free });
      expect(r.startable.map((s) => s.player.playerId)).toEqual(["faBest", "faOk"]);
    });
  });

  describe("rest of season", () => {
    it("recommends a claim that beats the worst droppable player", () => {
      const free = [p({ playerId: "faGood", position: "WR", seasonRank: 115 })];
      const r = waiverTargets({ rosterPositions: SLOTS, roster, freeAgents: free });
      expect(r.seasonUpgrades[0].player.playerId).toBe("faGood");
      // benchB is unranked, so he is the worst thing on the roster.
      expect(r.seasonUpgrades[0].dropFor?.playerId).toBe("benchB");
    });

    it("does not recommend a claim worse than everyone droppable", () => {
      // A full roster whose bench is ranked, so the claim has to actually beat
      // somebody rather than beat an absence of opinion.
      const ranked = roster.map((x) =>
        x.playerId === "benchA"
          ? { ...x, unranked: false, seasonRank: 100 }
          : x.playerId === "benchB"
            ? { ...x, unranked: false, seasonRank: 110 }
            : x,
      );
      const free = [p({ playerId: "faBad", position: "WR", seasonRank: 290 })];
      const r = waiverTargets({ rosterPositions: SLOTS, roster: ranked, freeAgents: free });
      expect(r.seasonUpgrades).toHaveLength(0);
    });

    it("treats anybody he ranked as an upgrade on somebody he did not", () => {
      // benchB is unranked. A player at 290 is a poor claim in the abstract and
      // still an improvement on a player Jingles has no opinion about at all.
      const free = [p({ playerId: "faBad", position: "WR", seasonRank: 290 })];
      const r = waiverTargets({ rosterPositions: SLOTS, roster, freeAgents: free });
      expect(r.seasonUpgrades[0].dropFor?.playerId).toBe("benchB");
    });

    it("claims into a free roster spot without naming a drop", () => {
      // Six players, ten spots. Nothing has to go to make room.
      const thin = roster.slice(0, 6);
      const free = [p({ playerId: "faAny", position: "WR", seasonRank: 290 })];
      const r = waiverTargets({ rosterPositions: SLOTS, roster: thin, freeAgents: free });
      expect(r.seasonUpgrades).toHaveLength(1);
      expect(r.seasonUpgrades[0].dropFor).toBeNull();
    });

    it("ignores free agents he did not rank at all", () => {
      const free = [p({ playerId: "faUnknown", position: "WR", unranked: true })];
      const r = waiverTargets({ rosterPositions: SLOTS, roster, freeAgents: free });
      expect(r.seasonUpgrades).toHaveLength(0);
    });

    it("does not tell him to drop the same player for five different claims", () => {
      const free = [
        p({ playerId: "fa1", position: "WR", seasonRank: 100 }),
        p({ playerId: "fa2", position: "WR", seasonRank: 110 }),
        p({ playerId: "fa3", position: "WR", seasonRank: 120 }),
      ];
      const r = waiverTargets({ rosterPositions: SLOTS, roster, freeAgents: free });
      const drops = r.seasonUpgrades.map((t) => t.dropFor?.playerId);
      expect(new Set(drops).size).toBe(drops.length);
    });

    it("reports how many places better the claim is", () => {
      const free = [p({ playerId: "faGood", position: "WR", seasonRank: 100 })];
      const r = waiverTargets({ rosterPositions: SLOTS, roster, freeAgents: free });
      // Paired against benchB, who is unranked, so there is no number to give.
      expect(r.seasonUpgrades[0].placesBetter).toBeNull();
    });
  });

  describe("drops", () => {
    it("never offers up a player this week's lineup depends on", () => {
      const r = waiverTargets({ rosterPositions: SLOTS, roster, freeAgents: [] });
      const dropIds = r.dropCandidates.map((d) => d.playerId);
      // rb1 is his second best back overall and starting. wr3 is the worst
      // player on the roster by season rank but is holding a flex slot.
      expect(dropIds).not.toContain("rb1");
      expect(r.untouchable).toContain("rb1");
    });

    it("puts the worst rostered player first", () => {
      const r = waiverTargets({ rosterPositions: SLOTS, roster, freeAgents: [] });
      // benchB is unranked, which sorts behind everyone he did rank.
      expect(r.dropCandidates[0].playerId).toBe("benchB");
    });

    it("keeps a bye-week fill-in who is actually starting", () => {
      // rb1 out, so rb3 has to start, which protects him from the drop list
      // even though his season rank is poor.
      const hurt = roster.map((x) =>
        x.playerId === "rb1" ? { ...x, injuryStatus: "Out" } : x,
      );
      const r = waiverTargets({ rosterPositions: SLOTS, roster: hurt, freeAgents: [] });
      expect(r.untouchable).toContain("rb3");
      expect(r.dropCandidates.map((d) => d.playerId)).not.toContain("rb3");
    });
  });
});
