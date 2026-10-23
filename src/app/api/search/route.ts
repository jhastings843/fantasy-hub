import { getPicksReport } from "@/lib/picks/report";
import { getPropsView } from "@/lib/props/store";
import { getOurNflView } from "@/lib/models/nfl/store";
import { getOurFtdView } from "@/lib/models/nfl/ftd-store";
import { picksSearchIndex } from "@/app/picks/search";
import { propsSearchIndex } from "@/app/props/search";
import type { SearchEntry } from "@/app/picks/WeekSearch";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET /api/search - every searchable entry this week for the header search box
// (Jack, 2026-10-22: "put the search bar at the top so it's always there"):
// NFL and college picks and our NFL props and first TD, the same entries the
// pages built before. Read only; each entry links to the page it comes from.

const seasonOf = (d: Date) => (d.getUTCMonth() < 7 ? d.getUTCFullYear() - 1 : d.getUTCFullYear());

export async function GET() {
  const season = seasonOf(new Date());
  const [nfl, cfb, ov, pv, fv] = await Promise.all([
    getPicksReport("nfl").catch(() => null),
    getPicksReport("cfb").catch(() => null),
    getOurNflView(season).catch(() => null),
    getPropsView(season).catch(() => null),
    getOurFtdView(season).catch(() => null),
  ]);
  const tag = (list: SearchEntry[], href: string, prefix: string) => list.map((e) => ({ ...e, key: `${prefix}:${e.key}`, href, meta: `${prefix} · ${e.meta}` }));
  const entries: SearchEntry[] = [
    ...(nfl?.value ? tag(picksSearchIndex(nfl.value), "/picks", "NFL picks") : []),
    ...(cfb?.value ? tag(picksSearchIndex(cfb.value), "/picks/cfb", "College picks") : []),
    ...tag(propsSearchIndex(ov, pv, fv), "/props", "NFL props"),
  ];
  return Response.json({ entries }, { headers: { "Cache-Control": "s-maxage=120, stale-while-revalidate=600" } });
}
