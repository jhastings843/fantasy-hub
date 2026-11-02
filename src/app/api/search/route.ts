import { getPicksReport } from "@/lib/picks/report";
import { getPropsView } from "@/lib/props/store";
import { getOurNflView } from "@/lib/models/nfl/store";
import { getOurFtdView } from "@/lib/models/nfl/ftd-store";
import { picksSearchIndex } from "@/app/picks/search";
import { propsSearchIndex } from "@/app/props/search";
import type { SearchEntry } from "@/app/picks/WeekSearch";
import { getNbaBoard } from "@/lib/picks/nba-store";
import { getCbbBoard } from "@/lib/models/cbb/store";
import { getOurNbaView } from "@/lib/models/nba/store";
import { nbaSeasonOfDate } from "@/lib/props/parse";
import { cbbGamesIndex, currentOnly, nbaGamesIndex, nbaPropsIndex } from "@/lib/search/sports";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET /api/search - every searchable entry this week for the header search box
// (Jack, 2026-10-22: "put the search bar at the top so it's always there"):
// NFL, CFB, NBA and CBB games, our NFL props and first TD and our NBA props
// (with David's number). Each team and player shows its current game: a
// finished one stays until the next game is posted (lib/search/sports.ts).
// Read only; a game opens its preview, a prop links to its page.

const seasonOf = (d: Date) => (d.getUTCMonth() < 7 ? d.getUTCFullYear() - 1 : d.getUTCFullYear());

export async function GET() {
  const season = seasonOf(new Date());
  // A slow board drops out of this copy rather than holding up the rest.
  const within = <T,>(p: Promise<T>, ms = 12_000) => Promise.race([p.catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), ms))]);
  const now = new Date();
  const [nfl, cfb, ov, pv, fv, nbaB, cbbB, nbaV] = await Promise.all([
    getPicksReport("nfl").catch(() => null),
    getPicksReport("cfb").catch(() => null),
    getOurNflView(season).catch(() => null),
    getPropsView(season).catch(() => null),
    getOurFtdView(season).catch(() => null),
    within(getNbaBoard(now)),
    within(getCbbBoard(now, 3)),
    within(getOurNbaView(nbaSeasonOfDate(now), now)),
  ]);
  const nbaNames = new Map([...(nbaB?.yesterday?.games ?? []), ...(nbaB?.days.flatMap((d) => d.games) ?? [])].flatMap((g) => [[g.home.abbr, g.home.name], [g.away.abbr, g.away.name]] as [string, string][]));
  const strip = ({ key, title, meta, terms, rank, rows, href }: ReturnType<typeof nbaGamesIndex>[number]): SearchEntry => ({ key, title, meta, terms, rank, rows, href });
  const tag = (list: SearchEntry[], href: string | ((e: SearchEntry) => string), prefix: string) =>
    list.map((e) => ({ ...e, key: `${prefix}:${e.key}`, href: typeof href === "string" ? href : href(e), meta: `${prefix} · ${e.meta}` }));
  // A game opens its pop-up preview (app/@modal/(.)picks/game); entry keys are "AWAY@HOME".
  const game = (l: "nfl" | "cfb") => (e: SearchEntry) => `/picks/game?l=${l}&g=${encodeURIComponent(e.key)}`;
  const entries: SearchEntry[] = [
    ...(nfl?.value ? tag(picksSearchIndex(nfl.value), game("nfl"), "NFL picks") : []),
    ...(cfb?.value ? tag(picksSearchIndex(cfb.value), game("cfb"), "CFB picks") : []),
    ...tag(propsSearchIndex(ov, pv, fv), (e) => `/props/player?l=nfl&t=${e.key.split("|")[0]}&n=${encodeURIComponent(e.title)}`, "NFL props"),
    ...currentOnly([...nbaGamesIndex(nbaB), ...cbbGamesIndex(cbbB), ...nbaPropsIndex(nbaV, nbaNames)]).map(strip),
  ];
  return Response.json({ entries }, { headers: { "Cache-Control": "s-maxage=120, stale-while-revalidate=600" } });
}
