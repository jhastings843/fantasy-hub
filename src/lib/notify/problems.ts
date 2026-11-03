import "server-only";
import { redis } from "@/lib/redis/client";
import { push } from "./pushover";
import { PROBLEM_STREAK, step, type ProblemState } from "./problems-core";

const KEY = (job: string) => `notify:v1:problems:${job}`;

/** Record this run's problems for a cron job; push when it has failed PROBLEM_STREAK runs in a row. Never throws. */
export async function watchProblems(job: string, problems: string[]): Promise<void> {
  try {
    const { next, push: send } = step(await redis.get<ProblemState>(KEY(job)), problems);
    await redis.set(KEY(job), next, { ex: 14 * 86400 });
    if (send) await push({ title: `${job}: problems ${PROBLEM_STREAK} runs in a row`, message: `${problems.length} problem${problems.length === 1 ? "" : "s"}, first: ${problems[0].slice(0, 300)}` });
  } catch {
    // Watching must never break the job it watches.
  }
}
