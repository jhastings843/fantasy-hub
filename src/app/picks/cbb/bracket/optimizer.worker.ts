// The bracket optimizer off the main thread: the simulations and the scoring
// tables take a few hundred milliseconds, so they run here. The page asks for
// a setup once, then one q table per scoring system (cached on its side).

import { buildCandidates, poolTable, prepare, simulate, type Candidate, type Prepared, type ScoringId, type Sims } from "@/lib/models/cbb/bracket";
import type { BracketField } from "@/lib/models/cbb/bracket-types";

export type ToWorker = { type: "setup"; field: BracketField; T: number; K: number; seed: number } | { type: "table"; scoring: ScoringId };
export type FromWorker =
  | { type: "ready"; cands: Candidate[]; ms: number; K: number }
  | { type: "table"; scoring: ScoringId; q: Float32Array; T: number; ms: number }
  | { type: "error"; message: string };

let state: { p: Prepared; sims: Sims; cands: Candidate[] } | null = null;

const post = (m: FromWorker, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(m, transfer);

self.onmessage = (e: MessageEvent<ToWorker>) => {
  try {
    const m = e.data;
    if (m.type === "setup") {
      const t0 = performance.now();
      const p = prepare(m.field);
      const sims = simulate(p, { T: m.T, K: m.K, seed: m.seed });
      const cands = buildCandidates(p);
      state = { p, sims, cands };
      post({ type: "ready", cands, ms: performance.now() - t0, K: sims.K });
      return;
    }
    if (!state) throw new Error("Optimizer not set up");
    const t0 = performance.now();
    const tab = poolTable(state.p, state.sims, state.cands, m.scoring);
    post({ type: "table", scoring: m.scoring, q: tab.q, T: tab.T, ms: performance.now() - t0 }, [tab.q.buffer]);
  } catch (err) {
    post({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
