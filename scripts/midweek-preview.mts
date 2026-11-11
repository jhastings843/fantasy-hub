// Render this week's midweek waiver email WITHOUT sending it, and save the HTML
// so Jack can read it. Same code path as the send (runMidweekEmail), dry mode:
// no Jingles or Flock inbox read, no send, no send log.
//
//   pnpm dlx tsx@4 --env-file=.env.local --tsconfig scripts/tsconfig.json scripts/midweek-preview.mts [out.html]
import { writeFileSync } from "node:fs";
import { runMidweekEmail } from "@/lib/midweek/run";

const out = process.argv[2] ?? "midweek-preview.html";
const res = await runMidweekEmail({ dry: true });
const body = await res.text();
if (!(res.headers.get("content-type") ?? "").includes("text/html")) {
  console.error(body);
  process.exit(1);
}
writeFileSync(out, body);
console.log(`wrote ${out} (${body.length} bytes)`);
