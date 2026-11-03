import "server-only";
import { getNflState } from "@/lib/sleeper/client";
import { friendlyAiError } from "@/lib/ai-errors";
import {
  readWaiverResearch,
  researchWaiverTargets,
  VERCEL_BUDGET,
  type ResearchBudget,
  type ResearchFormat,
} from "@/lib/waivers/research";

export interface FormatResult {
  ok: boolean;
  cached?: boolean;
  week?: number;
  targets?: number;
  generatedAt?: string;
  top?: string[];
  error?: string;
}

export function formatsFor(wanted: string | null | undefined): ResearchFormat[] {
  return wanted === "dynasty" ? ["dynasty"] : wanted === "redraft" ? ["redraft"] : ["dynasty", "redraft"];
}

/**
 * Research this week's waiver consensus for each format and cache it. Shared
 * by the route (Vercel, five-minute ceiling) and the GitHub job (no ceiling).
 * A cached week is reused unless forced.
 */
export async function runWaiverResearch(
  formats: ResearchFormat[],
  { force = false, budget = VERCEL_BUDGET }: { force?: boolean; budget?: ResearchBudget } = {},
): Promise<{ ok: boolean; week: number; results: Record<string, FormatResult> }> {
  const state = await getNflState();
  const results: Record<string, FormatResult> = {};
  for (const format of formats) {
    try {
      const existing = force ? null : await readWaiverResearch(state.season, state.week, format);
      const research = existing ?? (await researchWaiverTargets(format, state.season, state.week, budget));
      results[format] = {
        ok: true,
        cached: Boolean(existing),
        week: research.week,
        targets: research.targets.length,
        generatedAt: research.generatedAt,
        top: research.targets.slice(0, 5).map((t) => `${t.name} ${t.faabPercent ?? "?"}%`),
      };
    } catch (e) {
      // Out of credit reads as a plain sentence rather than a raw 400, so the
      // failure names its own fix.
      const friendly = friendlyAiError(e);
      results[format] = { ok: false, error: friendly ?? (e instanceof Error ? e.message : String(e)) };
    }
  }
  return { ok: Object.values(results).every((r) => r.ok), week: state.week, results };
}
