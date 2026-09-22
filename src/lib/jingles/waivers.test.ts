import { describe, expect, it } from "vitest";
import { isWaiverPostTitle, parseWaivers } from "./waivers";

// A short excerpt of the real 2026-09-22 waiver post, kept verbatim in shape.
//
// Verbatim in SHAPE and not in full: four players out of thirty, with his
// markup untouched. Two things in here are load-bearing. The header row and the
// ranked row are marked up differently (the header carries the bid inside the
// bold, the ranked row leaves it outside), so a parser written against one of
// them silently misses the other. And the trailing sentence about Kyler Murray
// is a paragraph that opens with a bolded player name and a percent, which is
// the shape most likely to be mistaken for a row and bid on.
const REAL_EXCERPT = `
<p><span>Free Agent Budget amounts are based on the standard $100 salary cap. The roster percentages below are a consensus from ESPN, Yahoo and Sleeper.</span></p>
<h3><strong><span>Quarterbacks</span></strong></h3>
<p><strong><span>Tyler Shough | $5 | 47% Rostered</span></strong></p>
<p><span>At this point Shough is more than a desperation streamer. He opened the season with 410 passing yards and 3 TDs against the Lions, then followed it with 252 yards and two scores against the Ravens.</span></p>
<p><span>Now he gets the Raiders at home. I am treating him as a high end QB2 until he gives me a reason not to.</span></p>
<p><strong><span>Other QB Adds</span></strong></p>
<p><strong><span>Malik Willis</span></strong><span> | $3 | 35%</span></p>
<p><strong><span>Kyler Murray</span></strong><span> is 57% rostered, but he would be my #1 QB add if he is somehow available. I would spend up to $10.</span></p>
<h3><strong><span>Running Backs</span></strong></h3>
<p><strong><span>Jonah Coleman | $25 | 29% Rostered</span></strong></p>
<p><span>This is my priority waiver claim of the week. RJ Harvey missed Week 2 with a hamstring injury and then JK Dobbins left with one of his own, and Coleman stepped in and looked good when his chance came.</span></p>
<h3><strong><span>30 Waiver Adds Ranked</span></strong></h3>
<p><strong><span>1: RB Jonah Coleman</span></strong><span> | $25 | 29%</span></p>
<p><strong><span>2: WR Denzel Boston Jr.</span></strong><span> | $21 | 32%</span></p>
<p><strong><span>3: QB Tyler Shough </span></strong><span>| $5 | 47%</span></p>
<p><strong><span>4: QB Malik Willis</span></strong><span> | $3 | 35%</span></p>
`;

const TITLE = "Fantasy Football: Week 3 Waiver Wire & FAB Advice";

describe("isWaiverPostTitle", () => {
  it("knows his waiver post", () => {
    expect(isWaiverPostTitle(TITLE)).toBe(true);
  });

  it("leaves the weekly rankings post alone", () => {
    // These two are both titled with a week number and they must never share a
    // store: one is 500 ranked players, the other is 30 players and their bids.
    expect(isWaiverPostTitle("2026 Week 3 Fantasy Football Rankings")).toBe(false);
  });

  it("is not fooled by a betting post", () => {
    expect(isWaiverPostTitle("NFL Week 3 Betting Preview: POTD and Best Bets")).toBe(false);
  });
});

describe("parseWaivers", () => {
  const parsed = parseWaivers(REAL_EXCERPT, TITLE);

  it("reads the week from the title", () => {
    expect(parsed.week).toBe(3);
  });

  it("reads the budget his dollars are priced against", () => {
    expect(parsed.budget).toBe(100);
  });

  it("takes the ranked list as the spine", () => {
    expect(parsed.rankedRows).toBe(4);
    expect(parsed.rows.map((r) => r.rank)).toEqual([1, 2, 3, 4]);
  });

  it("reads the bid, the position and the rostered percent off a ranked row", () => {
    const coleman = parsed.rows[0];
    expect(coleman.name).toBe("Jonah Coleman");
    expect(coleman.position).toBe("RB");
    expect(coleman.faab).toBe(25);
    expect(coleman.rostered).toBe(29);
  });

  it("prices the bid as a percent of the budget", () => {
    // $25 of $100. The app bids in percentages because Jack's dynasty league
    // runs a $1000 budget and his redraft leagues do not.
    expect(parsed.rows[0].faabPercent).toBe(25);
  });

  it("folds his reasoning onto the player it belongs to", () => {
    expect(parsed.rows[0].note).toMatch(/^This is my priority waiver claim/);
    expect(parsed.rows[0].note).not.toMatch(/Denzel/);
  });

  it("keeps the note to his first paragraph", () => {
    const shough = parsed.rows.find((r) => r.name === "Tyler Shough");
    expect(shough?.note).toMatch(/desperation streamer/);
    expect(shough?.note).not.toMatch(/Raiders at home/);
  });

  it("leaves a player with no paragraph noteless rather than borrowing one", () => {
    const willis = parsed.rows.find((r) => r.name === "Malik Willis");
    expect(willis).toBeDefined();
    expect(willis?.note).toBeNull();
  });

  it("does not read a sentence about a rostered player as a bid", () => {
    // "Kyler Murray is 57% rostered, but ... I would spend up to $10." He is
    // telling you what he would do if the player were free, not pricing a claim.
    expect(parsed.rows.some((r) => r.name.includes("Kyler"))).toBe(false);
  });
});
