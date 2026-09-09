import { describe, expect, it } from "vitest";
import { isWeeklyRankingsTitle, parseWeekly, weeklyScoring } from "./weekly";
import { htmlToLines } from "./parse";

// A short excerpt of the real 2026-09-08 weekly post, kept verbatim in shape.
//
// Verbatim in SHAPE and not in full: this repository is public and the weekly
// post is paid, so what is here is three rows a section rather than 407. The
// markup is what matters and it is exactly his: sections are <h4>, every row in
// a section shares one <p> and is separated by <br>, and the team is bolded,
// which splits a row across three nodes. A hand-tidied fixture would smooth
// over precisely the thing the parser has to survive.
//
// Two details in here are load-bearing and are why the excerpt reaches as far
// as it does. The intro names all three scorings, because he tells you how to
// adjust his half-PPR list for the other two, and a parser that takes the first
// scoring word it sees calls this a full-PPR list. And "C.J. Stroud" carries
// periods inside a name that the row regex has to keep whole.
const REAL_EXCERPT = `
<p style="margin: 0 0 20px 0;"><strong><span>Last Updated: September 8, 2026 at 6:30pm ET</span></strong></p>
<p style="margin: 0 0 20px 0;"><span>Week 1 is finally here.</span></p>
<p style="margin: 0 0 20px 0;"><span>Below are my </span><strong><span>Half-PPR rankings for QB, RB, WR, TE, K and D/ST</span></strong><span>, with my </span><strong><span>Top 150 FLEX rankings at the very bottom.</span></strong></p>
<p style="margin: 0 0 20px 0;"><strong><span>Quick note on scoring</span></strong></p>
<p style="margin: 0 0 20px 0;"><span>Everything below is ranked for Half-PPR. If you play Full PPR or Standard, you can still use these rankings.</span></p>
<p style="margin: 0 0 20px 0;"><strong><span>Full PPR:</span></strong><span> Bump up players who get a lot of their value through receptions.</span></p>
<p style="margin: 0 0 20px 0;"><strong><span>Standard:</span></strong><span> Bump up players who rely more on rushing volume.</span></p>
<h4><strong><span>QB Rankings</span></strong></h4>
<p style="margin: 0 0 20px 0;"><span>1: Joe Burrow | </span><strong><span>CIN</span></strong><span><span> vs TB</span><br><span>2: Lamar Jackson | </span></span><strong><span>BAL</span></strong><span><span> @ IND</span><br><span>3: C.J. Stroud | </span></span><strong><span>HOU</span></strong><span><span> vs BUF</span></span></p>
<h4><strong><span>RB Rankings</span></strong></h4>
<p style="margin: 0 0 20px 0;"><span>1: Jahmyr Gibbs | </span><strong><span>DET</span></strong><span><span> vs NO</span><br><span>2: Bijan Robinson | </span></span><strong><span>ATL</span></strong><span><span> @ PIT</span></span></p>
<h4><strong><span>D/ST Rankings</span></strong></h4>
<p style="margin: 0 0 20px 0;"><span>1: Denver Broncos | </span><strong><span>DEN</span></strong><span><span> @ KC</span></span></p>
<h4><strong><span>Kicker Rankings</span></strong></h4>
<p style="margin: 0 0 20px 0;"><span>1: Brandon Aubrey | </span><strong><span>DAL</span></strong><span><span> @ NYG</span></span></p>
<h4><strong><span>Top 150 FLEX Rankings</span></strong></h4>
<p style="margin: 0 0 20px 0;"><span>1: Jahmyr Gibbs | </span><strong><span>RB</span></strong><span><span> | DET vs NO</span><br><span>2: Ja&#8217;Marr Chase | </span></span><strong><span>WR</span></strong><span><span> | CIN vs TB</span><br><span>3: Trey McBride | </span></span><strong><span>TE</span></strong><span><span> | ARI @ LAC</span></span></p>
`;

const TITLE = "2026 Week 1 Fantasy Football Rankings";

describe("parseWeekly", () => {
  const parsed = parseWeekly(REAL_EXCERPT, TITLE);

  it("reads the week and season from the title", () => {
    expect(parsed.week).toBe(1);
    expect(parsed.season).toBe("2026");
  });

  it("keeps his Last Updated line as he wrote it", () => {
    expect(parsed.updatedLabel).toBe("September 8, 2026 at 6:30pm ET");
  });

  it("splits rows into the section they were written under", () => {
    expect(parsed.positional.QB).toHaveLength(3);
    expect(parsed.positional.RB).toHaveLength(2);
    expect(parsed.flex).toHaveLength(3);
  });

  it("maps his section names onto Sleeper's position codes", () => {
    expect(parsed.positional.DEF).toHaveLength(1);
    expect(parsed.positional.K).toHaveLength(1);
    expect(parsed.positional["D/ST"]).toBeUndefined();
    expect(parsed.positional.Kicker).toBeUndefined();
  });

  it("reads a positional row, where the third field is the matchup", () => {
    expect(parsed.positional.QB[0]).toEqual({
      rank: 1,
      name: "Joe Burrow",
      position: "QB",
      team: "CIN",
      opponent: "TB",
      home: true,
    });
  });

  it("reads a flex row, where the position sits in the middle", () => {
    expect(parsed.flex[0]).toEqual({
      rank: 1,
      name: "Jahmyr Gibbs",
      position: "RB",
      team: "DET",
      opponent: "NO",
      home: true,
    });
  });

  it("tells home from away", () => {
    expect(parsed.positional.QB[0].home).toBe(true); // CIN vs TB
    expect(parsed.positional.QB[1].home).toBe(false); // BAL @ IND
  });

  it("keeps punctuation inside a name rather than splitting on it", () => {
    expect(parsed.positional.QB[2].name).toBe("C.J. Stroud");
    expect(parsed.flex[1].name).toBe("Ja’Marr Chase");
  });

  it("carries the flex list's own positions, which is what a FLEX slot needs", () => {
    expect(parsed.flex.map((r) => r.position)).toEqual(["RB", "WR", "TE"]);
  });

  it("reports no gaps or duplicates in a clean list", () => {
    expect(parsed.missingRanks).toEqual({});
    expect(parsed.duplicateRanks).toEqual({});
  });
});

describe("weeklyScoring", () => {
  // The regression this exists for. His post names all three scorings, because
  // it explains how to adjust, and the generic detector takes the first word it
  // finds. On the real Week 1 post that answered full PPR for a half-PPR list,
  // which would have told three of Jack's four leagues that a list matched
  // their scoring when it did not.
  it("reads what he declares, not the formats he mentions in passing", () => {
    expect(parseWeekly(REAL_EXCERPT, TITLE).scoring).toBe("half_ppr");
  });

  it("follows him if he ever declares a different one", () => {
    expect(weeklyScoring(["Below are my Full PPR rankings for QB, RB, WR, TE."])).toBe("full_ppr");
    expect(weeklyScoring(["Everything below is ranked for Standard."])).toBe("standard");
  });

  it("assumes half PPR when he does not say, rather than stopping", () => {
    expect(weeklyScoring(["Week 4 is here.", "1: Joe Burrow | CIN vs TB"])).toBe("half_ppr");
  });
});

describe("integrity reporting", () => {
  function section(header: string, rows: string[]): string {
    return `<h4><strong><span>${header}</span></strong></h4><p>${rows
      .map((r) => `<span>${r}</span>`)
      .join("<br>")}</p>`;
  }

  it("names the ranks a section is missing rather than returning a short list", () => {
    const html = section("QB Rankings", [
      "1: A One | CIN vs TB",
      "3: A Three | BAL @ IND",
      "4: A Four | DET vs NO",
    ]);
    const p = parseWeekly(html, TITLE);
    expect(p.positional.QB).toHaveLength(3);
    expect(p.missingRanks.QB).toEqual([2]);
  });

  it("names a rank claimed twice", () => {
    const html = section("RB Rankings", [
      "1: B One | CIN vs TB",
      "2: B Two | BAL @ IND",
      "2: B Two Again | DET vs NO",
    ]);
    const p = parseWeekly(html, TITLE);
    expect(p.duplicateRanks.RB).toEqual([2]);
  });

  it("reports the flex list's gaps under its own key", () => {
    const html = section("Top 150 FLEX Rankings", [
      "1: C One | RB | CIN vs TB",
      "3: C Three | WR | BAL @ IND",
    ]);
    const p = parseWeekly(html, TITLE);
    expect(p.missingRanks.FLEX).toEqual([2]);
  });
});

describe("isWeeklyRankingsTitle", () => {
  it("recognises the weekly post", () => {
    expect(isWeeklyRankingsTitle("2026 Week 1 Fantasy Football Rankings")).toBe(true);
    expect(isWeeklyRankingsTitle("2026 Week 12 Fantasy Football Rankings")).toBe(true);
  });

  it("does not claim the season-long lists", () => {
    expect(isWeeklyRankingsTitle("The Lab 300: 2026 Half PPR Rankings")).toBe(false);
    expect(isWeeklyRankingsTitle("The Jingles Labs Weekly Game Plan")).toBe(false);
  });
});

describe("the markup itself", () => {
  it("splits br-separated rows that share one paragraph", () => {
    const lines = htmlToLines(REAL_EXCERPT);
    expect(lines).toContain("1: Joe Burrow | CIN vs TB");
    expect(lines).toContain("2: Lamar Jackson | BAL @ IND");
  });
});
