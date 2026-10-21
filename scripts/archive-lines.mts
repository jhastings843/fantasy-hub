// One pass of the prop line archive from this Mac (same code as /api/lines).
//
//   npx tsx --tsconfig scripts/tsconfig.json --env-file=.env.local scripts/archive-lines.mts
import { runLineArchive } from "../src/lib/models/archive";

console.log(JSON.stringify(await runLineArchive(), null, 1));
