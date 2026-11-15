import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { satelliteDesk, weatherTotalDesk } from "@/app/money/desks";
import { SatelliteTab, WeatherTotalHero } from "@/app/money/SatelliteTab";
import { satelliteFixture } from "./satellite.fixture";
import { isSnapshot, type MoneySnapshot, type Satellite } from "./types";

const base: MoneySnapshot = { version: 1, generatedAt: "2026-11-14T23:05:02Z", books: [], phil: null };

describe("satellite desk", () => {
  it("accepts snapshots with, without, or with a null satellite", () => {
    expect(isSnapshot(base)).toBe(true);
    expect(isSnapshot({ ...base, satellite: null })).toBe(true);
    expect(isSnapshot({ ...base, satellite: satelliteFixture })).toBe(true);
  });

  it("reads Too early on the overview until 20 bets settle", () => {
    const d = satelliteDesk(satelliteFixture);
    expect(d.read).toBe("Too early");
    const f = satelliteFixture;
    expect(d.result).toBe(`-$${(f.bankroll - f.equity).toFixed(2)}`);
    expect(d.rec).toBe(`${f.bets.filter((b) => b.status === "open").length} open, $${f.openCost.toFixed(2)} staked`);
    const later: Satellite = { ...satelliteFixture, settled: 24, wins: 15, equity: 1040 };
    expect(satelliteDesk(later)).toMatchObject({ read: "Up", readTone: "good", rec: "15-9" });
  });

  it("adds both weather books into one overview row", () => {
    const f = satelliteFixture;
    const row = weatherTotalDesk(null, f)!;
    expect(row).toMatchObject({ id: "weather", name: "Weather", result: `-$${(f.bankroll - f.equity).toFixed(2)}` });
    expect(weatherTotalDesk(null, null)).toBeNull();
  });

  it("renders the tab from the real status.json", () => {
    const html = renderToStaticMarkup(createElement("div", null, createElement(WeatherTotalHero, { d: satelliteFixture, w: null }), createElement(SatelliteTab, { d: satelliteFixture })));
    for (const text of ["Weather: ", "Satellite markets", "Arctic sea ice", "warmest November", "Above 14.2 million sq km", "Site watch", "How it is graded", "NOT FOUND yet", "nsidc.org"]) expect(html).toContain(text);
    expect(html).toContain('loading="lazy"');
    expect(html).not.toContain("—"); // no em dashes in copy
  });

  it("renders a sparse satellite without crashing", () => {
    const bare = { ...satelliteFixture, signals: [], bets: [], sites: [], ideas: undefined, calibration: null, curve: [] } as Satellite;
    expect(renderToStaticMarkup(createElement(SatelliteTab, { d: { ...bare, events: [] } }))).toContain("No markets priced");
  });
});
