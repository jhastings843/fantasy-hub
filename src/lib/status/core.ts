import type { ProblemState } from "@/lib/notify/problems-core";

// /status and the per-page freshness line (UX pass, 2026-11-06). Before this,
// a failing job only showed up as a Pushover after three bad runs in a row.
// Sources, all already written by the jobs themselves:
//   notify:v1:problems:<job>  every pulse job and every capture route (watchProblems)
//   pulse:last                the last pulse receipt (jobs + email sends)
//   money snapshot            the Mac's desk export (generatedAt)
//
//   rowFor("Pulse harris-cbb", {streak: 5, last: "no rows matched", at: ...}) ->
//     { group: "Outside sources", name: "Harris CBB", health: "failing", note: "5 runs in a row" }

export type Health = "ok" | "failing" | "quiet" | "unknown";

export interface StatusRow {
  key: string;
  group: string;
  name: string;
  health: Health;
  /** Last report, clean or not (ISO), when known. */
  at?: string;
  okAt?: string;
  failAt?: string;
  streak: number;
  /** First line of the last problem. Only shown to an unlocked device. */
  error?: string;
}

export const GROUP_ORDER = ["Every hour", "Captures and models", "Outside sources", "Emails", "From the Mac"] as const;

/** Plain names for the job ids the pulse uses. Anything not here keeps its id. */
const NAMES: Record<string, string> = {
  "picks-data": "Lines and scores",
  "picks-review": "Picks learner review",
  "harris-feed": "Harris CFB",
  "harris-cbb": "Harris CBB",
  "sam-cbb-watch": "Sam CBB watch",
  "david-cbb": "David CBB",
  "nba-sam": "Sam NBA",
  "nba-news": "NBA injury news",
  "pool-entry": "Pick'em pool entry",
  "pool-watch": "Pick'em pool watch",
  "staked-push": "Staked bet alerts",
  "splits-skip": "Betting splits",
  "refresh-all-early": "League sync (early)",
  "refresh-all-late": "League sync (late)",
  cbb: "College hoops board",
  jingles: "Jingles rankings",
  lineups: "Lineup checks",
  survivor: "Survivor data",
  tracker: "Bet tracker",
  values: "Player values",
  waivers: "Waiver data",
  "Harris feed": "Harris CFB, week check",
  "Harris CBB feed": "Harris CBB, day check",
};

/** Plain names for the pulse's email send ids (SendId in lib/pulse/tempo.ts). */
export const SEND_NAMES: Record<string, string> = {
  faab: "Tuesday FAAB email",
  midweek: "Midweek waiver email",
  thursday: "Thursday survivor email",
  watch: "Lineup watch",
  sunday: "Sunday lineup email",
  alarm: "Sunday 11:45 alarm",
  picks: "Tuesday picks card",
  "picks-day": "Daily picks update",
};

/** A job quiet this long is shown as not running rather than fine. Weekly jobs stay quiet longer, so this is generous. */
export const QUIET_H = 8 * 24;

export function rowFor(job: string, s: ProblemState | null | undefined, now: Date): StatusRow {
  const pulse = job.startsWith("Pulse ");
  const id = pulse ? job.slice(6) : job;
  const name = NAMES[id] ?? id;
  const outside = /harris|pem|sam-cbb|jingles/i.test(id);
  const group = outside ? "Outside sources" : pulse ? "Every hour" : "Captures and models";
  const streak = s?.streak ?? 0;
  const ageH = s?.at ? (now.getTime() - Date.parse(s.at)) / 3_600_000 : null;
  const health: Health = !s ? "unknown" : streak > 0 ? "failing" : ageH !== null && ageH > QUIET_H ? "quiet" : s.at || s.okAt ? "ok" : "unknown";
  return { key: job, group, name, health, at: s?.at, okAt: s?.okAt, failAt: s?.failAt, streak, error: streak > 0 ? s?.last : undefined };
}

const RANK: Record<Health, number> = { failing: 0, quiet: 1, unknown: 2, ok: 3 };

/** Failing first, then by name, within each group in GROUP_ORDER. */
export function sortRows(rows: StatusRow[]): StatusRow[] {
  const g = (x: string) => {
    const i = (GROUP_ORDER as readonly string[]).indexOf(x);
    return i < 0 ? 99 : i;
  };
  return [...rows].sort((a, b) => g(a.group) - g(b.group) || RANK[a.health] - RANK[b.health] || a.name.localeCompare(b.name));
}

/** "just now", "12 min ago", "3 h ago", "2 days ago". */
export function ago(iso: string | undefined | null, now: Date): string | null {
  if (!iso) return null;
  const m = Math.round((now.getTime() - Date.parse(iso)) / 60_000);
  if (!Number.isFinite(m)) return null;
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 36) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}
