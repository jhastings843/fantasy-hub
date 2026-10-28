import "server-only";
import { redis } from "@/lib/redis/client";
import { push } from "@/lib/notify/pushover";
import { loadActivePolicy } from "./policy-store";
import { loadIssued } from "./issued-store";
import { fetchSplits } from "./splits-feed";
import { matchSplits, readMarket, toSplits } from "./splits";
import { filterFires, MARKET_FILTERS } from "./learning/model";
import type { IssuedPlay, IssuedRecord } from "./issued";
import type { League } from "./parse";

// The live side of a proven splits signal (Jack, 2026-10-27). Bets still go
// out in the 9am email; once the review has made a signal live (policy
// marketSkips), a sent bet it flags gets one phone alert in the last stretch
// before kickoff, when most public money is in. Nothing is changed on the
// record: the bet stays graded as sent, and the alert says why to skip.

/** Kickoffs this many minutes out are checked: one or two pulses land in the window. */
export const ALERT_WINDOW = { from: 20, to: 75 };

const SENT_KEY = (league: League, week: number, game: string) => `picks:v2:skip-alert:${league}:${week}:${game}`;

/** Sent stakes whose kickoff falls in the alert window. Pure. */
export function playsDue(records: IssuedRecord[], now: Date): { week: number; p: IssuedPlay }[] {
  const t = now.getTime();
  return records
    .filter((r) => r.status === undefined || r.status === "sent")
    .flatMap((r) => r.plays.map((p) => ({ ...p, kickoff: p.kickoff ?? p.ref?.kickoff })).filter((p) => (p.units ?? 0) > 0 && p.kickoff).map((p) => ({ week: r.week, p })))
    .filter(({ p }) => {
      const mins = (Date.parse(p.kickoff!) - t) / 60_000;
      return mins >= ALERT_WINDOW.from && mins <= ALERT_WINDOW.to;
    });
}

export async function runSplitsAlerts(now = new Date()): Promise<string> {
  const policy = await loadActivePolicy();
  const leagues = (["nfl", "cfb"] as const).filter((l) => policy.marketSkips?.[l]?.length);
  if (!leagues.length) return "no splits signal live";
  const season = now.getUTCMonth() < 2 ? now.getUTCFullYear() - 1 : now.getUTCFullYear();
  const out: string[] = [];
  for (const league of leagues) {
    const due = playsDue(await loadIssued(league, season), now);
    if (!due.length) continue;
    const feed = await fetchSplits(league);
    for (const { week, p } of due) {
      const m = matchSplits({ home: p.home, away: p.away, kickoff: p.kickoff, line: p.homeLine }, feed);
      if (!m) continue;
      const read = readMarket(league, toSplits(m), m.dk ?? p.homeLine);
      const fired = policy.marketSkips![league]!.filter((f) => filterFires(f, read, p.side));
      if (!fired.length) continue;
      const game = `${p.away}@${p.home}`;
      // One alert per game, whatever the pulse cadence.
      const fresh = await redis.set(SENT_KEY(league, week, game), now.toISOString(), { nx: true, ex: 14 * 86_400 }).catch(() => null);
      if (fresh !== "OK") continue;
      const why = fired.map((f) => MARKET_FILTERS.find((x) => x.id === f)?.label.split(":")[0] ?? f).join("; ");
      await push({ title: `Skip ${p.play}?`, message: `${why}. Tickets ${read.publicSide ? `${read.publicSide === p.side ? "on" : "against"} you` : "split"}; kickoff in ${Math.round((Date.parse(p.kickoff!) - now.getTime()) / 60_000)} minutes. The proven splits signal says skip; the bet stays on the record as sent.` });
      out.push(`${league} ${p.play}: ${fired.join(", ")}`);
    }
  }
  return out.length ? `skip alerts: ${out.join("; ")}` : "no flagged bets in the window";
}
