import "server-only";
import { redis } from "@/lib/redis/client";

// The Prediction Tracker's two current-week files, saved once a day.
//
// Nothing reads these yet. A 2025 college backtest (walk-forward, 795 graded
// games) found the planned "top five models by ATS" vote went 51.4%, below
// the 52.4% break-even, and lost to a plain average of every model (53.1%).
// So the tracker is not a vote on the page. What it lacks is a 2026 history
// to test against Sam, David and PEM, and the site only serves the current
// week, so this keeps a copy of each day's file. Two small downloads a day,
// about 40KB stored.
//
// Their sign is the opposite of ours: positive means the home team is favored.
// Their column names (linesag, linedok...) map to system names on
// prednfl.php / predncaa.php.

const FILES = {
  nfl: "https://www.thepredictiontracker.com/nflpredictions.csv",
  cfb: "https://www.thepredictiontracker.com/ncaapredictions.csv",
} as const;

const dayKey = (league: keyof typeof FILES, day: string) => `picks:v1:${league}:tracker:${day}`;

function etDay(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(now);
}

/** Saves today's files if they aren't on file yet. Safe to call every hour. */
export async function archiveTracker(now = new Date()): Promise<string> {
  const day = etDay(now);
  const out = await Promise.all(
    (Object.keys(FILES) as (keyof typeof FILES)[]).map(async (league) => {
      if (await redis.exists(dayKey(league, day))) return `${league} on file`;
      const res = await fetch(FILES[league], {
        cache: "no-store",
        headers: { "user-agent": "fantasy-hub/1.0 (personal fantasy football tool)" },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new Error(`${league} tracker answered ${res.status}`);
      const csv = await res.text();
      if (!csv.startsWith("lineopen") && !csv.includes(",home")) throw new Error(`${league} tracker file looks wrong`);
      await redis.set(dayKey(league, day), csv);
      return `${league} saved (${csv.split("\n").length - 1} games)`;
    }),
  );
  return `tracker ${day}: ${out.join(", ")}`;
}
