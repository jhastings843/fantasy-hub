// Silent failures (audit 2026-11-02): cron routes answer 200 with a problems
// list nobody reads. A job that reports problems three runs in a row pushes
// once; it pushes again only after it has had a clean run.
//
//   step(undefined, ["ESPN 503"]) -> streak 1, no push
//   step({streak: 2, pushed: false}, ["ESPN 503"]) -> streak 3, push
//   step({streak: 5, pushed: true}, []) -> streak 0, no push
export const PROBLEM_STREAK = 3;

export interface ProblemState {
  streak: number;
  pushed: boolean;
  last?: string;
  /** When the job last reported, clean or not (ISO). Read by /status. */
  at?: string;
  /** Last clean run (ISO). */
  okAt?: string;
  /** Last run with problems (ISO). */
  failAt?: string;
  /** First run of the current failing streak (ISO). */
  since?: string;
}

export function step(prev: ProblemState | null | undefined, problems: string[], now: Date = new Date()): { next: ProblemState; push: boolean } {
  const at = now.toISOString();
  const keep = { at, okAt: prev?.okAt, failAt: prev?.failAt };
  if (!problems.length) return { next: { streak: 0, pushed: false, ...keep, okAt: at }, push: false };
  const streak = (prev?.streak ?? 0) + 1;
  const push = streak >= PROBLEM_STREAK && !prev?.pushed;
  return {
    next: { streak, pushed: !!prev?.pushed || push, last: problems[0].slice(0, 200), ...keep, failAt: at, since: streak === 1 ? at : prev?.since },
    push,
  };
}
