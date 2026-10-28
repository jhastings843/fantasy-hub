import { playsProbability } from "./recommend";

// How long an injury lasts, and what that does to a player's worth.
//
// availability.ts answers "does he play Sunday". Everything that looks past
// Sunday (rest-of-season rates, tiers, which players are season starters and
// so never the drop) used to treat a player out until Thanksgiving as if he
// were healthy, because the only status anywhere was this week's. ESPN files a
// return date on every injury it lists, so the timeline is a read, not a guess.
//
// Two other things lived beside it and disagreed with it: the chop simulation
// zeroed anyone whose raw Sleeper tag said Out (the week 8 card priced Breece
// Hall at 75% of a player as ESPN's Questionable, while every lineup in the
// simulation scored him 0 on Sleeper's stale Out), and players in the IR slot
// were counted in Sunday's lineup though Sleeper will not start them there.

/** The regular season the rates are spread over (projections.ts uses the same). */
export const LAST_WEEK = 17;

/** Weeks assumed when a status has no return date: IR has a four-game minimum. */
const DEFAULT_WEEKS: [RegExp, number][] = [
  [/^(ir|injured ?reserve|pup|nfi)/i, 4],
  [/^(out|sus|suspen)/i, 1],
];

const DAY = 86_400_000;

/** The Sunday this NFL week is played on: the next Sunday on or after now. */
function thisSunday(nowIso: string): number {
  const d = new Date(nowIso);
  const day = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return day + ((7 - new Date(day).getUTCDay()) % 7) * DAY;
}

/**
 * NFL weeks he misses, starting with this one. ESPN's return date wins where
 * it has one in the future; otherwise the status sets a floor (IR four weeks,
 * Out one). ESPN's Active clears a stale Sleeper tag.
 */
export function weeksOut(
  espn: { status: string; returnDate?: string | null } | null,
  sleeperStatus: string | null,
  nowIso: string,
): number {
  if (espn && /^active/i.test(espn.status)) return 0;
  const status = espn?.status || sleeperStatus || "";
  const fallback = DEFAULT_WEEKS.find(([re]) => re.test(status.trim()))?.[1] ?? 0;
  const sunday = thisSunday(nowIso);
  const back = espn?.returnDate ? Date.parse(`${espn.returnDate.slice(0, 10)}T00:00:00Z`) : NaN;
  if (!Number.isFinite(back) || back < sunday) return fallback;
  return Math.ceil((back - sunday) / (7 * DAY));
}

/** Share of the season's remaining weeks (this one included) he is available for. */
export function restOfSeasonShare(out: number, week: number, lastWeek = LAST_WEEK): number {
  const left = Math.max(1, lastWeek - week + 1);
  return Math.max(0, left - out) / left;
}

/** What he scores in Sunday's lineup: the projection times the chance he plays. */
export function sundayPoints(p: { weekPoints: number; plays?: number; injuryStatus: string | null }): number {
  return p.weekPoints * playsProbability(p);
}

/**
 * IR slot housekeeping the card should say out loud. A player in the slot who
 * is cleared still needs a roster spot to come back; an eligible player on the
 * active roster while a slot sits open is a free roster spot left on the table.
 * Eligibility follows Sleeper's own tag, which is what Sleeper enforces.
 */
export function irMoves(
  players: { playerId: string; name: string; injuryStatus: string | null; plays?: number; weeksOut?: number }[],
  reserveIds: string[],
  rules: { slots: number; allowOut: boolean },
): string[] {
  const out: string[] = [];
  const reserve = new Set(reserveIds);
  const eligible = (s: string | null) => !!s && (/^ir$/i.test(s) || /^injured ?reserve/i.test(s) || (rules.allowOut && /^out$/i.test(s)));
  for (const p of players.filter((x) => reserve.has(x.playerId))) {
    if (!eligible(p.injuryStatus)) {
      out.push(`${p.name} is no longer injured enough for the IR slot. Sleeper blocks your other moves until he comes off it, which takes an open roster spot (a drop).`);
    }
  }
  const open = rules.slots - players.filter((x) => reserve.has(x.playerId)).length;
  if (open > 0) {
    const candidates = players
      .filter((x) => !reserve.has(x.playerId) && eligible(x.injuryStatus))
      .sort((a, b) => (b.weeksOut ?? 0) - (a.weeksOut ?? 0))
      .slice(0, open);
    for (const p of candidates) {
      const weeks = p.weeksOut ? ` (out about ${p.weeksOut} week${p.weeksOut === 1 ? "" : "s"})` : "";
      out.push(`Move ${p.name} to IR${weeks}: your IR slot is open, and it frees a roster spot for a claim without dropping anyone.`);
    }
  }
  return out;
}

/** Season starters off in one week before it reads as a crunch, not a note. */
const CRUNCH_STARTERS = 3;

/**
 * Byes by week, this one included, with the crunch weeks called out. The old
 * list was one line per player from next week on, so the week 8 report said
 * nothing about Kittle and Likely being off that Sunday and listed week 11's
 * five absences (the only QB among them) as five separate, equal notes.
 */
export function byeAlerts(
  players: { playerId: string; name: string; position: string; byeWeek: number | null }[],
  week: number,
  seasonStarterIds: Set<string>,
): string[] {
  const byWeek = new Map<number, typeof players>();
  for (const p of players) {
    if (p.byeWeek == null || p.byeWeek < week) continue;
    byWeek.set(p.byeWeek, [...(byWeek.get(p.byeWeek) ?? []), p]);
  }
  return [...byWeek.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([w, off]) => {
      const head = w === week ? "This week" : `Week ${w}`;
      const names = off.map((p) => p.name).join(", ");
      const gone = ["QB", "RB", "WR", "TE"].filter((pos) => {
        const all = players.filter((p) => p.position === pos);
        return all.length > 0 && all.every((p) => p.byeWeek === w);
      });
      const starters = off.filter((p) => seasonStarterIds.has(p.playerId)).length;
      const warn: string[] = [];
      if (gone.length) warn.push(`no ${gone.join(" or ")} left that week`);
      if (starters >= CRUNCH_STARTERS) warn.push(`${starters} of your season starters out at once`);
      const count = off.length === 1 ? "1 player off" : `${off.length} players off`;
      const note = warn.join(", ");
      return `${head}: ${count} (${names})${note ? `. ${note[0].toUpperCase()}${note.slice(1)}: plan that week's claims early.` : ""}`;
    });
}
