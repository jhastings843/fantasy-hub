import { describe, expect, it } from "vitest";
import type { WaiverContext } from "@/lib/waivers/build";
import { sourceName } from "@/lib/waivers/source-names";
import { pulledFrom, renderMidweekEmail } from "./email";

const league = (over: Partial<WaiverContext>): WaiverContext => ({
  leagueId: "1",
  leagueName: "2026 Half PPR",
  week: 11,
  budgetLeft: 18,
  budgetTotal: 100,
  freeAgentCount: 0,
  listTitle: null,
  listUpdatedLabel: null,
  seasonListTitle: "",
  seasonListMatchesScoring: true,
  report: { startable: [], seasonUpgrades: [], dropCandidates: [], untouchable: [] },
  pacing: null,
  source: { label: "", fresh: false, note: null },
  blocked: null,
  ...over,
});

describe("midweek email sources line", () => {
  it("names each source once, in the order first seen", () => {
    const a = league({ sources: ["Flock Fantasy", "FantasyPros", "Sleeper"] });
    const b = league({ sources: ["Dynasty Nerds", "fantasypros", "Sleeper", "Reddit"] });
    expect(pulledFrom([a, b])).toBe("Pulled from Flock Fantasy, FantasyPros, Sleeper, Dynasty Nerds, Reddit.");
  });

  it("prints nothing when no league reports a source", () => {
    expect(pulledFrom([league({})])).toBe("");
  });

  it("turns research URLs into site names", () => {
    expect(sourceName("https://www.fantasypros.com/2026/11/waiver-wire-week-11/")).toBe("FantasyPros");
    expect(sourceName("RotoBaller FAAB column (https://www.rotoballer.com/x)")).toBe("RotoBaller");
    expect(sourceName("https://sports.yahoo.com/fantasy/article/abc")).toBe("Yahoo Fantasy");
    expect(sourceName("https://www.someblog.net/post")).toBe("Someblog");
    expect(sourceName("Dynasty Daddy")).toBe("Dynasty Daddy");
  });
});

describe("midweek email league with no claims", () => {
  const input = (l: WaiverContext) => ({ leagues: [l], guillotine: null, week: 11, generatedAt: "2026-11-17T20:00:00-05:00", appUrl: "https://x" });

  it("says no bids and drops the 'claims below' line when nothing is below (week 11 Half PPR)", () => {
    const html = renderMidweekEmail(
      input(
        league({
          sources: ["Flock Fantasy", "Sleeper"],
          blocked:
            "His latest weekly list is for week 10 and this is week 11, so the this-week half of this page waits for his new post. The claims below still stand.",
        }),
      ),
    );
    expect(html).toContain("No bids this week for this league.");
    expect(html).not.toContain("claims below still stand");
    expect(html).toContain("waits for his new post.");
    expect(html).toContain("Pulled from Flock Fantasy, Sleeper.");
  });

  it("says no bids on a clean league too", () => {
    expect(renderMidweekEmail(input(league({})))).toContain("No bids this week for this league. Nothing on the wire beats what you have.");
  });
});
