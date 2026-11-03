import { describe, expect, it } from "vitest";
import { step } from "./problems-core";
describe("problem streaks", () => {
  it("pushes once on the third failing run, again only after a clean run", () => {
    let s = step(undefined, ["ESPN 503"]);
    expect(s.push).toBe(false);
    s = step(s.next, ["ESPN 503"]);
    expect(s.push).toBe(false);
    s = step(s.next, ["ESPN 503"]);
    expect(s.push).toBe(true);
    s = step(s.next, ["ESPN 503"]);
    expect(s.push).toBe(false);
    s = step(s.next, []);
    expect(s.next).toEqual({ streak: 0, pushed: false });
  });
});
