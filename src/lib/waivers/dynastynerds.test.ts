import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/redis/client", () => ({ redis: { get: vi.fn(), set: vi.fn() } }));
import { parseDynastyNerds } from "./dynastynerds";

// The week 4 2026 table, markup kept in shape.
const TABLE = `
<table><thead><tr><th><strong>Player</strong></th><th><strong>Pos</strong></th><th><strong>Team</strong></th><th><strong>Roster %</strong></th><th><strong>FAAB</strong></th></tr></thead>
<tbody>
<tr><td>Tyson Bagent / Case Keenum</td><td>QB</td><td>CHI</td><td>37%</td><td>10-12%</td></tr>
<tr><td><strong>Jalon Daniels</strong></td><td>QB</td><td>TB</td><td>25%</td><td><strong>10-20%</strong> *</td></tr>
<tr><td>Brycen Tremayne</td><td>WR</td><td>CAR</td><td>0%</td><td>1-2%</td></tr>
<tr><td>Greg Dulcich</td><td>TE</td><td>MIA</td><td>47%</td><td>5%</td></tr>
</tbody></table>`;

describe("parseDynastyNerds", () => {
  const rows = parseDynastyNerds(TABLE);

  it("reads every player row and skips the header", () => {
    expect(rows.map((r) => r.name)).toEqual(["Tyson Bagent", "Case Keenum", "Jalon Daniels", "Brycen Tremayne", "Greg Dulcich"]);
  });

  it("keeps their FAAB range, including a bolded one with a footnote", () => {
    expect(rows.find((r) => r.name === "Jalon Daniels")).toMatchObject({ faabLow: 10, faabHigh: 20, rostered: 25, team: "TB" });
  });

  it("reads a single-number bid as a range of one", () => {
    expect(rows.find((r) => r.name === "Greg Dulcich")).toMatchObject({ faabLow: 5, faabHigh: 5 });
  });
});
