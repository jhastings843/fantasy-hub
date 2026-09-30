import { describe, expect, it } from "vitest";
import { renderWatchEmail, watchItems, watchSubject } from "./email";
import type { WeeklyLineups } from "@/lib/lineup/build";

const p = (playerId: string) => ({ playerId, name: playerId }) as never;
const slot = (s: string, index: number, current: string, recommended: string) => ({
  slot: s, index, current: p(current), recommended: p(recommended), changed: current !== recommended, alternative: null, reason: "",
});

function lineups(slots: ReturnType<typeof slot>[]): WeeklyLineups {
  return {
    week: 4,
    leagues: [
      {
        leagueId: "L1",
        leagueName: "Scaries",
        advice: { slots, changes: slots.filter((s) => s.changed), problems: [], superflexFellThrough: false, adjustmentDecided: [] },
      },
    ],
  } as unknown as WeeklyLineups;
}

describe("watchItems", () => {
  it("keys a change by league, slot and the player going in", () => {
    const items = watchItems(lineups([slot("FLEX", 7, "bench", "pat")]), []);
    expect(items).toEqual([{ key: "L1:7:pat", leagueId: "L1", leagueName: "Scaries", text: "Start pat at FLEX" }]);
  });

  it("gives a free agent taking the slot its own key", () => {
    const items = watchItems(lineups([slot("FLEX", 7, "bench", "pat")]), [
      { leagueId: "L1", leagueName: "Scaries", targets: [{ player: p("jake"), slot: "FLEX", displaces: p("pat"), dropFor: null } as never] },
    ]);
    expect(items.map((i) => [i.key, i.text])).toEqual([["L1:7:fa:jake", "Add jake at FLEX"]]);
  });

  it("is empty when every lineup matches", () => {
    expect(watchItems(lineups([slot("WR", 0, "a", "a")]), [])).toEqual([]);
  });
});

describe("renderWatchEmail", () => {
  it("leads with what is new and names the league", () => {
    const l = lineups([slot("FLEX", 7, "bench", "pat")]);
    (l.leagues[0] as unknown as { scoringLabel: string; skewNotes: string[] }).scoringLabel = "full PPR";
    (l.leagues[0] as unknown as { skewNotes: string[] }).skewNotes = [];
    const fresh = watchItems(l, []);
    const html = renderWatchEmail(
      { survivors: [], survivorError: null, lineups: l, pickups: [], generatedAt: "2026-10-01T16:00:00Z", appUrl: "https://x" },
      fresh,
    );
    expect(html).toContain("New since your last email");
    expect(html).toContain("Start pat at FLEX");
    expect(watchSubject(fresh)).toBe("Lineup update: Start pat at FLEX (Scaries)");
  });
});
