import { beforeEach, describe, expect, it, vi } from "vitest";

// Whether the daily run tells the truth about itself.
//
// This route does four jobs on one cron: grade snapshots, the Jingles ingest,
// the Thursday email, and the scorecard. Each rider catches its own failure so
// the others still run, which is right. But the top-level answer was ok:true
// no matter what, so a monitor reading it saw green on a morning the Thursday
// email had failed. ok has to mean "everything worked", and the answer has to
// name what did not.

vi.mock("@/lib/league/discover", () => ({
  getMyLeagues: vi.fn(async () => [
    { id: "L1", name: "The Lab", source: "sleeper", type: "dynasty" },
  ]),
}));
vi.mock("@/lib/sleeper/client", () => ({ getUser: vi.fn(async () => ({ user_id: "u1" })) }));
vi.mock("@/lib/rosteraudit/client", () => ({ getRosterGrades: vi.fn(async () => ({})) }));
vi.mock("@/lib/history/grades", () => ({
  recordGradeSnapshot: vi.fn(async () => true),
  snapshotDate: () => "2026-09-12",
}));
vi.mock("@/lib/jingles/ingest", () => ({ ingestJingles: vi.fn(async () => ({ added: 0 })) }));
vi.mock("@/lib/thursday/run", () => ({
  runThursdayEmail: vi.fn(async () => Response.json({ sent: false, reason: "not Thursday" })),
}));
vi.mock("@/lib/scorecard/run", () => ({
  snapshotWeek: vi.fn(async () => ({ frozen: false })),
  settleFinishedWeeks: vi.fn(async () => ({ graded: 0 })),
}));

import { recordGradeSnapshot } from "@/lib/history/grades";
import { runThursdayEmail } from "@/lib/thursday/run";
import { settleFinishedWeeks } from "@/lib/scorecard/run";
import { GET } from "./route";

async function run() {
  const res = await GET(new Request("http://localhost/api/snapshot"));
  return { status: res.status, body: await res.json() };
}

describe("GET /api/snapshot", () => {
  beforeEach(() => {
    process.env.SLEEPER_USERNAME = "jack";
    delete process.env.CRON_SECRET;
    vi.mocked(recordGradeSnapshot).mockResolvedValue(true);
    vi.mocked(runThursdayEmail).mockResolvedValue(Response.json({ sent: false, reason: "not Thursday" }));
    vi.mocked(settleFinishedWeeks).mockResolvedValue({ graded: 0 } as never);
  });

  it("says ok only when every job succeeded", async () => {
    const { body } = await run();
    expect(body.ok).toBe(true);
    expect(body.failures).toEqual([]);
  });

  it("says not ok when the Thursday email failed", async () => {
    vi.mocked(runThursdayEmail).mockRejectedValue(new Error("Resend refused: 403"));
    const { body } = await run();
    expect(body.ok).toBe(false);
    expect(body.failures).toEqual([expect.stringContaining("thursday")]);
  });

  it("says not ok when the Thursday email answered ok:false without throwing", async () => {
    // runThursdayEmail reports a refused send as a 500 Response, not a throw.
    // Catching exceptions alone lets that one through as a success.
    vi.mocked(runThursdayEmail).mockResolvedValue(
      Response.json({ ok: false, error: "Not sent." }, { status: 500 }),
    );
    const { body } = await run();
    expect(body.ok).toBe(false);
    expect(body.failures).toEqual([expect.stringContaining("thursday")]);
  });

  it("says not ok when a league snapshot failed", async () => {
    vi.mocked(recordGradeSnapshot).mockRejectedValue(new Error("RosterAudit 502"));
    const { body } = await run();
    expect(body.ok).toBe(false);
    expect(body.failures).toEqual([expect.stringContaining("The Lab")]);
  });

  it("names every job that failed, not just the first", async () => {
    vi.mocked(runThursdayEmail).mockRejectedValue(new Error("Resend refused: 403"));
    vi.mocked(settleFinishedWeeks).mockRejectedValue(new Error("Sleeper timeout"));
    const { body } = await run();
    expect(body.ok).toBe(false);
    expect(body.failures).toHaveLength(2);
  });

  it("still answers 200 for a partial failure, since the route itself ran", async () => {
    // Vercel's cron view only sees the status. 200 means "the run happened";
    // ok in the body means "and everything in it worked". Those are different
    // facts and this route reports both.
    vi.mocked(runThursdayEmail).mockRejectedValue(new Error("Resend refused: 403"));
    const { status } = await run();
    expect(status).toBe(200);
  });
});
