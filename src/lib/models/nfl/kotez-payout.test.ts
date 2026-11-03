import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { backers, parsePayout, payoutLine, sameWinner, trackingLinks, trackingUrl } from "./kotez-payout";

// Cut from the real DK Network pages, fetched 2026-11-02 (hub cards and post paragraphs as served).
const fx = (f: string) => readFileSync(`test/fixtures/models/kotez/${f}`, "utf8");

describe("DK Network King Of hub", () => {
  it("lists the King of the End Zone tracking posts with their game dates, not King of the Court", () => {
    const links = trackingLinks(fx("hub.html"));
    expect(links.map((l) => l.date).sort()).toEqual(["2026-09-28", "2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26"]);
    expect(links.find((l) => l.date === "2026-10-26")?.url).toBe("https://dknetwork.draftkings.com/2026/10/26/tracking-the-leader-for-draftkings-king-of-the-end-zone-monday-10-26-26/");
  });

  it("builds the same address from a game date when the hub has moved on", () => {
    expect(trackingUrl("2026-10-26")).toBe("https://dknetwork.draftkings.com/2026/10/26/tracking-the-leader-for-draftkings-king-of-the-end-zone-monday-10-26-26/");
    expect(trackingUrl("2026-10-05")).toBe("https://dknetwork.draftkings.com/2026/10/05/tracking-the-leader-for-draftkings-king-of-the-end-zone-monday-10-5-26/");
  });
});

describe("tracking post payout", () => {
  it("Pickens (10/26): winner heading, $65 each, $2M pool, no count", () => {
    const p = parsePayout(fx("article-2026-10-26.html"));
    expect(p).toEqual({ winner: "George Pickens", perBettor: 65, pool: 2_000_000 });
    expect(backers({ perBettor: p.perBettor!, pool: p.pool })).toBe(30769);
    expect(payoutLine({ perBettor: 65, pool: 2_000_000 })).toBe("$65 each, about 30,800 backers");
  });

  it("Bijan Robinson (10/5): stated count and payout", () => {
    const p = parsePayout(fx("article-2026-10-05.html"));
    expect(p).toMatchObject({ perBettor: 77, bettors: 26158, pool: 2_000_000 });
    expect(sameWinner(p.winner!, "Bijan Robinson")).toBe(true);
    expect(payoutLine({ perBettor: 77, bettors: 26158, pool: 2_000_000 })).toBe("$77 each, 26,158 backers");
  });

  it("Raymond (9/28): 'bonus bet credit' wording, last name only, DK spells him Khalif", () => {
    const p = parsePayout(fx("article-2026-09-28.html"));
    expect(p).toMatchObject({ perBettor: 477, bettors: 4201, pool: 2_000_000 });
    expect(sameWinner(p.winner!, "Kalif Raymond")).toBe(true);
  });

  it("Kittle (10/19): winner only, no payout yet", () => {
    const p = parsePayout(fx("article-2026-10-19.html"));
    expect(p.winner).toBe("George Kittle");
    expect(p.perBettor).toBeUndefined();
    expect(p.pool).toBe(2_000_000);
  });

  it("a different player is not the same winner", () => {
    expect(sameWinner("George Pickens", "CeeDee Lamb")).toBe(false);
    expect(sameWinner("", "CeeDee Lamb")).toBe(false);
  });
});
