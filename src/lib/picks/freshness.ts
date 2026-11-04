// Quiet staleness on the picks board (Jack, 2026-11-04: "watch the board and
// forget it"). The data job can succeed while its quotes are old or missing;
// near kickoff that means no bets go out and nothing says why. Pure.
//
// A problem only when a priced game kicks off within SOON_H hours, so a
// Tuesday with stale quotes and no games is quiet. Unpriced games alone are
// not a problem: ESPN never prices some college games.

export const SOON_H = 6;

export interface FreshnessInput {
  reference: { stale: boolean; problem?: string; priced: number };
  board: { basis?: string; ref?: { kickoff?: string } }[];
}

export function freshnessProblems(league: string, r: FreshnessInput, now: Date): string[] {
  const soon = r.board
    .filter((g) => g.basis !== "started" && g.ref?.kickoff)
    .map((g) => Date.parse(g.ref!.kickoff!) - now.getTime())
    .filter((ms) => ms > 0 && ms <= SOON_H * 3_600_000);
  if (!soon.length) return [];
  const hrs = (Math.min(...soon) / 3_600_000).toFixed(1);
  const out: string[] = [];
  if (r.reference.problem) out.push(`${league}: quotes failed (${r.reference.problem}), next kickoff in ${hrs}h`);
  else if (r.reference.stale) out.push(`${league}: quotes are stale, so nothing is offered; next kickoff in ${hrs}h`);
  return out;
}
