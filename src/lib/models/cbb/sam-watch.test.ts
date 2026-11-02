import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/redis/client", () => ({ redis: {} }));
vi.mock("@/lib/notify/pushover", () => ({ push: vi.fn() }));
import { samCbbPosted } from "./sam-watch";

describe("samCbbPosted", () => {
  it("reads the placeholder as not posted, even with CSS around it", () => {
    expect(samCbbPosted("<html><head><style>:root{--x:1}</style></head><body><h1>CBB — coming soon</h1></body></html>")).toBe(false);
  });
  it("reads a real board as posted", () => {
    expect(samCbbPosted("<html><body><table><tr><td>Duke</td><td>-7.5</td></tr></table></body></html>")).toBe(true);
  });
  it("ignores 'coming soon' inside a script", () => {
    expect(samCbbPosted("<script>var s='coming soon'</script><table><tr><td>UNC</td></tr></table>")).toBe(true);
  });
});
