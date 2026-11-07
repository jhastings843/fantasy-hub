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
    expect(s.next).toMatchObject({ streak: 0, pushed: false });
  });

  it("keeps when it last ran, last ran clean, and when the failing streak began", () => {
    const t = (h: number) => new Date(Date.UTC(2026, 10, 6, h));
    let s = step(undefined, [], t(1));
    expect(s.next).toMatchObject({ at: t(1).toISOString(), okAt: t(1).toISOString() });
    s = step(s.next, ["ESPN 503"], t(2));
    s = step(s.next, ["ESPN 503"], t(3));
    expect(s.next).toMatchObject({ at: t(3).toISOString(), okAt: t(1).toISOString(), failAt: t(3).toISOString(), since: t(2).toISOString(), streak: 2 });
    s = step(s.next, [], t(4));
    expect(s.next).toMatchObject({ okAt: t(4).toISOString(), failAt: t(3).toISOString(), streak: 0 });
    expect(s.next.since).toBeUndefined();
  });
});
