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
}

export function step(prev: ProblemState | null | undefined, problems: string[]): { next: ProblemState; push: boolean } {
  if (!problems.length) return { next: { streak: 0, pushed: false }, push: false };
  const streak = (prev?.streak ?? 0) + 1;
  const push = streak >= PROBLEM_STREAK && !prev?.pushed;
  return { next: { streak, pushed: !!prev?.pushed || push, last: problems[0].slice(0, 200) }, push };
}
