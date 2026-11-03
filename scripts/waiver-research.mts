// The weekly waiver research, run on the GitHub runner instead of a Vercel
// function (2026-11-03). One redraft web-search turn ran past 3.5 minutes and
// the function ceiling is 5, so the route could not finish redraft; here the
// budget is 15 minutes. Same code path and the same Redis cache the pages read.
//
//   pnpm dlx tsx@4 --tsconfig scripts/tsconfig.json scripts/waiver-research.mts [--format all|dynasty|redraft] [--force]
//
// Needs ANTHROPIC_API_KEY, UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.
import { appendFileSync } from "node:fs";
import { formatsFor, runWaiverResearch } from "@/lib/waivers/run-research";
import { RUNNER_BUDGET } from "@/lib/waivers/research";

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const force = process.argv.includes("--force");
const out = await runWaiverResearch(formatsFor(arg("--format") ?? "all"), { force, budget: RUNNER_BUDGET });

const lines = [`week: ${out.week}`];
for (const [f, r] of Object.entries(out.results)) {
  lines.push(r.ok ? `${f}: ${r.targets} targets${r.cached ? " (cached)" : ""} | ${(r.top ?? []).join(", ")}` : `${f}: FAILED: ${r.error}`);
}
console.log(lines.join("\n"));
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join("\n\n") + "\n");
for (const [f, r] of Object.entries(out.results)) if (!r.ok) console.log(`::error::${f} research failed: ${r.error}`);
process.exit(out.ok ? 0 : 1);
