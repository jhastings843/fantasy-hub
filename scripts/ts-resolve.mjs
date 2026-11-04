// Lets plain Node (22.18+, which strips TypeScript types itself) run the
// repo's .ts modules without tsx: resolves "@/..." to src/, extensionless
// relative imports to their .ts file, and "server-only" to the test stub.
//
//   node --import ./scripts/ts-resolve.mjs scripts/pickem-log.mts ...

import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(import.meta.dirname, "..");

registerHooks({
  resolve(spec, ctx, next) {
    if (spec === "server-only") return next(pathToFileURL(path.join(ROOT, "test/server-only-stub.ts")).href, ctx);
    let file = null;
    if (spec.startsWith("@/")) file = path.join(ROOT, "src", spec.slice(2));
    else if ((spec.startsWith("./") || spec.startsWith("../")) && ctx.parentURL?.startsWith("file:"))
      file = path.resolve(path.dirname(fileURLToPath(ctx.parentURL)), spec);
    if (file && !path.extname(file)) {
      for (const f of [`${file}.ts`, `${file}.tsx`, path.join(file, "index.ts")])
        if (existsSync(f)) return next(pathToFileURL(f).href, ctx);
    }
    return next(file && existsSync(file) ? pathToFileURL(file).href : spec, ctx);
  },
});
