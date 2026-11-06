// Usable weeks for an outside source (PEM, Harris): a week counts only when
// its sheet was read and passed its own check (verified), because the picks
// review uses verified weeks only (learning/run.ts). Pure.

export interface UsableWeeks {
  usable: number;
  /** Weeks on file: every week the source posted and the relay sent. */
  total: number;
  /** Weeks on file that the review cannot use, oldest first. */
  missing: number[];
}

export function usableWeeks(weeks: { week: number; verified: boolean }[]): UsableWeeks {
  const missing = weeks.filter((w) => !w.verified).map((w) => w.week).sort((a, b) => a - b);
  return { usable: weeks.length - missing.length, total: weeks.length, missing };
}
