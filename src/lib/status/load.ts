import "server-only";
import { redis } from "@/lib/redis/client";
import type { ProblemState } from "@/lib/notify/problems-core";
import { lastPulse, type PulseReceipt } from "@/lib/pulse/run";
import { getSnapshot } from "@/lib/money/store";
import { loadOps } from "@/lib/picks/ops";
import { rowFor, SEND_NAMES, sortRows, type StatusRow } from "./core";

const PREFIX = "notify:v1:problems:";

async function problemKeys(): Promise<string[]> {
  const keys: string[] = [];
  let cur: string | number = "0";
  do {
    const [next, batch]: [string | number, string[]] = await redis.scan(cur, { match: `${PREFIX}*`, count: 500 });
    cur = String(next);
    keys.push(...batch);
  } while (cur !== "0");
  return keys;
}

export interface StatusView {
  rows: StatusRow[];
  pulse: PulseReceipt | null;
  /** When the Mac last posted the desk export. */
  macAt: string | null;
  problems: string[];
}

/** Everything /status shows. Never throws: a part that can't be read becomes a line in `problems`. */
export async function loadStatus(now = new Date()): Promise<StatusView> {
  const problems: string[] = [];
  const [keys, pulse, snap] = await Promise.all([
    problemKeys().catch((e) => (problems.push(`job list: ${e instanceof Error ? e.message : e}`), [] as string[])),
    lastPulse().catch(() => null),
    getSnapshot().catch(() => null),
  ]);
  const states = keys.length ? ((await redis.mget<(ProblemState | null)[]>(...keys).catch(() => keys.map(() => null))) ?? []) : [];
  // The pulse receipt names every job it just ran, so a pulse job whose problem
  // record predates timestamps (before 2026-11-06) still gets a real time.
  const inPulse = new Map((pulse?.jobs ?? []).map((j) => [`Pulse ${j.job}`, j.ok]));
  const rows: StatusRow[] = keys.map((k, i) => {
    const job = k.slice(PREFIX.length);
    const st = states[i];
    const ran = inPulse.get(job);
    const filled = st && !st.at && ran !== undefined && pulse ? { ...st, at: pulse.at, okAt: ran ? pulse.at : st.okAt } : st;
    return rowFor(job, filled, now);
  });
  // Email sends from the last pulse: only the ones that pulse decided on.
  for (const s of pulse?.sends ?? []) {
    rows.push({
      key: `send:${s.id}`,
      group: "Emails",
      name: SEND_NAMES[s.id] ?? s.id,
      health: s.status === "failed" ? "failing" : "ok",
      at: pulse!.at,
      streak: s.status === "failed" ? 1 : 0,
      error: s.status === "failed" ? s.detail : undefined,
    });
  }
  const macAt = snap?.generatedAt ?? null;
  if (macAt) {
    const ageH = (now.getTime() - Date.parse(macAt)) / 3_600_000;
    rows.push({ key: "mac:desks", group: "From the Mac", name: "Money desks export", health: ageH > 30 ? "quiet" : "ok", at: macAt, okAt: macAt, streak: 0 });
  }
  return { rows: sortRows(rows), pulse, macAt, problems };
}

export interface Fresh {
  label: string;
  at: string;
}

/**
 * The few timestamps a page's freshness line needs, in one round trip each.
 * `what` picks which: lines (spreads and scores), props, leagues, pulse.
 */
export async function loadFreshness(what: ("lines" | "props" | "leagues" | "pulse")[]): Promise<Fresh[]> {
  const want = new Set(what);
  const jobs = [
    ...(want.has("props") ? ["Props capture", "NBA props capture"] : []),
    ...(want.has("leagues") ? ["Pulse refresh-all-early", "Pulse refresh-all-late"] : []),
  ];
  const [ops, states, pulse] = await Promise.all([
    want.has("lines") ? loadOps().catch(() => ({}) as Awaited<ReturnType<typeof loadOps>>) : Promise.resolve(null),
    jobs.length ? redis.mget<(ProblemState | null)[]>(...jobs.map((j) => PREFIX + j)).catch(() => jobs.map(() => null)) : Promise.resolve([]),
    want.has("pulse") ? lastPulse().catch(() => null) : Promise.resolve(null),
  ]);
  const ok = (name: string) => states[jobs.indexOf(name)]?.okAt;
  const latest = (...xs: (string | undefined)[]) => xs.filter((x): x is string => !!x).sort().at(-1);
  const out: Fresh[] = [];
  const lines = ops?.data?.lastSuccess;
  if (lines) out.push({ label: "Lines and scores", at: lines });
  const props = latest(ok("Props capture"), ok("NBA props capture"));
  if (props) out.push({ label: "Props", at: props });
  const leagues = latest(ok("Pulse refresh-all-early"), ok("Pulse refresh-all-late"));
  if (leagues) out.push({ label: "Leagues synced", at: leagues });
  if (pulse?.at) out.push({ label: "Checked", at: pulse.at });
  return out;
}
