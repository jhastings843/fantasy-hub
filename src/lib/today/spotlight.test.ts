import { describe, expect, it } from "vitest";
import { bigNews } from "./spotlight";

const now = new Date("2026-11-13T23:00:00Z");
const ago = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString();
const prod = (kind: "activated" | "rolled back" | "review", at: string) => ({
  name: "NBA props",
  href: "/props",
  journal: [{ at, week: 3, kind, id: "pts:over", text: "Points overs cleared the gate." }],
});
const move = (status: "todo" | "held") => ({ key: "m1", kind: "buy" as const, status, symbol: "VOO", amount: 1290, detail: "Market order", reason: "Backstop due" });

describe("bigNews", () => {
  it("nothing big: null, so the bet keeps the box", () => {
    expect(bigNews([prod("review", ago(1))], { at: ago(1), moves: [move("held")] }, now)).toBeNull();
  });
  it("a slice that went live an hour ago takes the box", () => {
    expect(bigNews([prod("activated", ago(1))], null, now)?.label).toBe("Now staking · NBA props");
  });
  it("a slice that went live 4 hours ago doesn't", () => {
    expect(bigNews([prod("activated", ago(4))], null, now)).toBeNull();
  });
  it("a do-now portfolio trade posted in the window takes the box", () => {
    expect(bigNews([], { at: ago(0.5), moves: [move("todo")] }, now)?.verb).toBe("Buy VOO, $1,290.");
  });
  it("newest event wins", () => {
    expect(bigNews([prod("rolled back", ago(2))], { at: ago(0.5), moves: [move("todo")] }, now)?.key).toBe("portfolio-m1");
  });
});
