import Link from "next/link";
import {
  formatKeyFromLeague,
  getPlayerProfile,
  getPlayerStats,
} from "@/lib/rosteraudit/client";
import { getPlayerNews } from "@/lib/news/espn";
import {
  getKTCValues,
  ktcFormatFromLeague,
  normalizeName,
} from "@/lib/ktc/client";
import type { KTCByName } from "@/lib/ktc/types";
import { getValuesForProfile } from "@/lib/values";
import { profileFromSleeper } from "@/lib/league/detect";
import type { RAValuesBySleeperId } from "@/lib/rosteraudit/types";
import {
  getAllPlayers,
  getLeague,
  getLeagueRosters,
  getLeagueUsers,
} from "@/lib/sleeper/client";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import { JinglesCallCard } from "@/components/JinglesBadge";
import { ValueChart } from "./ValueChart";

export const dynamic = "force-dynamic";

function NotFound({ id }: { id: string }) {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="flex max-w-2xl flex-col gap-3">
        <Link
          href="/fantasy"
          className="text-sm text-zinc-500 dark:text-zinc-400"
        >
          ‹ Leagues
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight">Player profile</h1>
        <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800 dark:bg-red-950/50 dark:text-red-300">
          No data found for player id {id}.
        </p>
      </div>
    </main>
  );
}

interface RouteParams {
  leagueId: string;
  id: string;
}

export default async function PlayerPage({
  params,
}: {
  params: Promise<RouteParams>;
}) {
  const { leagueId, id } = await params;

  const [profile, stats, league] = await Promise.all([
    getPlayerProfile(id),
    getPlayerStats(id),
    getLeague(leagueId).catch(() => null),
  ]);

  if (!profile) return <NotFound id={id} />;

  const news = await getPlayerNews(profile.player.name, 3).catch(() => []);

  const leagueProfile = league ? profileFromSleeper(league) : null;
  // RosterAudit tiers and buy/sell flags, and KeepTradeCut entirely, are
  // dynasty products. Showing them in a redraft league contradicts the
  // "Redraft values" label in the league bar with dynasty numbers.
  const isDynasty = leagueProfile?.type === "dynasty";

  const raFormat = league ? formatKeyFromLeague(league) : null;
  const ktcFormat = league && isDynasty ? ktcFormatFromLeague(league) : null;

  const [rosters, users, allPlayers, raValues, ktc] = await Promise.all([
    leagueId ? getLeagueRosters(leagueId) : Promise.resolve([]),
    leagueId ? getLeagueUsers(leagueId) : Promise.resolve([]),
    getAllPlayers().catch(() => ({})),
    league
      ? getValuesForProfile(leagueProfile!, league).then((r) => r.values).catch(
          (): RAValuesBySleeperId => ({}),
        )
      : Promise.resolve({} as RAValuesBySleeperId),
    ktcFormat
      ? getKTCValues(ktcFormat).catch((): KTCByName => ({}))
      : Promise.resolve({} as KTCByName),
  ]);

  const isSuperflex = raFormat?.startsWith("sf") ?? true;
  const ownerRoster = rosters.find((r) => (r.players ?? []).includes(id));
  const ownerUser = ownerRoster
    ? users.find((u) => u.user_id === ownerRoster.owner_id)
    : null;
  const ownerName =
    ownerUser?.metadata?.team_name ||
    ownerUser?.display_name ||
    ownerUser?.username ||
    null;

  const ktcMatch = ktc[normalizeName(profile.player.name)] ?? null;

  // Headline value comes from whichever source matches the format. RosterAudit
  // (dynasty) publishes superflex and 1QB splits; the redraft set does not, so
  // fall back to the adapted FantasyCalc row for this player.
  const fcRow = raValues[id] ?? null;
  const formatValue = isDynasty
    ? {
        value: isSuperflex ? profile.value.sf : profile.value.oneQb,
        overallRank: isSuperflex ? profile.value.rankSf : profile.value.rank1qb,
        positionRank: isSuperflex
          ? profile.value.rankPosSf
          : profile.value.rankPos1qb,
      }
    : {
        value: fcRow?.value ?? 0,
        overallRank: fcRow?.overallRank ?? 0,
        positionRank: fcRow?.positionRank ?? 0,
      };

  // RosterAudit publishes 7-day and 30-day trends. The redraft set only has a
  // 30-day figure, so showing a 7-day number there would be dynasty data
  // wearing a redraft label.
  const trend7d: number | null = isDynasty ? profile.value.trend7d : null;
  const trend30d: number = isDynasty
    ? profile.value.trend30d
    : (fcRow?.trend30Day ?? 0);

  // Similar players: same position, ±15% value, top 6
  const targetVal = isSuperflex ? profile.value.sf : profile.value.oneQb;
  const similar = Object.values(raValues)
    .filter(
      (v) =>
        v.position === profile.player.position &&
        v.sleeperId !== id &&
        v.value > 0 &&
        Math.abs(v.value - targetVal) / Math.max(targetVal, 1) <= 0.15,
    )
    .sort(
      (a, b) =>
        Math.abs(a.value - targetVal) - Math.abs(b.value - targetVal),
    )
    .slice(0, 6);

  const recentWeekly = stats?.weekly?.slice(-6) ?? [];
  const seasonStat = stats
    ? {
        games: stats.weekly.length,
        totalFp: stats.weekly.reduce((s, w) => s + w.fp, 0),
        avgFp:
          stats.weekly.length > 0
            ? stats.weekly.reduce((s, w) => s + w.fp, 0) / stats.weekly.length
            : 0,
      }
    : null;

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex flex-col gap-6">
        {/* Breadcrumb */}
        <Link
          href={`/l/${leagueId}`}
          className="text-sm text-zinc-500 dark:text-zinc-400"
        >
          ‹ League
        </Link>

        {/* Header */}
        <header className="flex flex-col gap-4 rounded-3xl border border-zinc-200/80 bg-white/80 p-5 backdrop-blur dark:border-zinc-800/80 dark:bg-zinc-900/80 sm:flex-row sm:items-center">
          <PlayerAvatar
            name={profile.player.name}
            position={profile.player.position}
            photoUrl={profile.player.photoUrl}
            size="lg"
          />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex flex-wrap items-baseline gap-2">
              <h1 className="text-3xl font-bold tracking-tight">
                {profile.player.name}
              </h1>
              <span className="text-sm text-zinc-500 dark:text-zinc-400">
                {profile.player.team ?? "FA"} · {profile.player.position}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {isDynasty && profile.value.tierLabel && (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
                  Tier {profile.value.tier}: {profile.value.tierLabel}
                </span>
              )}
              {profile.player.injuryStatus && (
                <span className="rounded-full bg-rose-100 px-2 py-0.5 font-semibold text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
                  {profile.player.injuryStatus}
                </span>
              )}
              {isDynasty && profile.value.buyLow && (
                <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-semibold text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
                  Buy low
                </span>
              )}
              {isDynasty && profile.value.sellHigh && (
                <span className="rounded-full bg-rose-100 px-2 py-0.5 font-semibold text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
                  Sell high
                </span>
              )}
              {isDynasty && profile.value.breakout && (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">
                  Breakout
                </span>
              )}
            </div>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              {[
                profile.player.age != null
                  ? `Age ${profile.player.age.toFixed(1)}`
                  : null,
                profile.player.yearsExp != null
                  ? `${profile.player.yearsExp} yr${
                      profile.player.yearsExp === 1 ? "" : "s"
                    } exp`
                  : null,
                profile.player.college,
                profile.player.height
                  ? `${Math.floor(Number(profile.player.height) / 12)}'${
                      Number(profile.player.height) % 12
                    }"`
                  : null,
                profile.player.weight ? `${profile.player.weight}lb` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
        </header>

        {/* Value snapshot */}
        <section className="grid gap-3 md:grid-cols-3">
          <div className="flex flex-col gap-1 rounded-2xl border border-zinc-200/80 bg-white/80 p-4 backdrop-blur dark:border-zinc-800/80 dark:bg-zinc-900/80">
            <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              Value (your league)
            </span>
            <span className="text-3xl font-bold tabular-nums">
              {formatValue.value.toLocaleString()}
            </span>
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              #{formatValue.overallRank} overall · {profile.player.position}
              {formatValue.positionRank}
            </span>
          </div>
          <div className="flex flex-col gap-1 rounded-2xl border border-zinc-200/80 bg-white/80 p-4 backdrop-blur dark:border-zinc-800/80 dark:bg-zinc-900/80">
            <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              Trend
            </span>
            <div className="flex items-baseline gap-3">
              <span
                className={`text-2xl font-bold tabular-nums ${
                  (trend7d ?? trend30d) > 0
                    ? "text-emerald-600 dark:text-emerald-400"
                    : (trend7d ?? trend30d) < 0
                      ? "text-rose-600 dark:text-rose-400"
                      : "text-zinc-500 dark:text-zinc-400"
                }`}
              >
                {(trend7d ?? trend30d) > 0 ? "+" : ""}
                {(trend7d ?? trend30d).toLocaleString()}
              </span>
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                {trend7d === null ? "30d" : "7d"}
              </span>
            </div>
            {isDynasty && (
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              30d:{" "}
              <span
                className={
                  trend30d > 0
                    ? "text-emerald-600 dark:text-emerald-400"
                    : trend30d < 0
                      ? "text-rose-600 dark:text-rose-400"
                      : ""
                }
              >
                {trend30d > 0 ? "+" : ""}
                {trend30d.toLocaleString()}
              </span>
              {" · "}
              90d:{" "}
              <span
                className={
                  profile.value.trend90d > 0
                    ? "text-emerald-600 dark:text-emerald-400"
                    : profile.value.trend90d < 0
                      ? "text-rose-600 dark:text-rose-400"
                      : ""
                }
              >
                {profile.value.trend90d > 0 ? "+" : ""}
                {profile.value.trend90d.toLocaleString()}
              </span>
            </span>
            )}
          </div>
          <div className="flex flex-col gap-1 rounded-2xl border border-zinc-200/80 bg-white/80 p-4 backdrop-blur dark:border-zinc-800/80 dark:bg-zinc-900/80">
            <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              In your league
            </span>
            {ownerRoster ? (
              <>
                <span className="text-base font-semibold">{ownerName}</span>
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  Roster #{ownerRoster.roster_id}
                </span>
              </>
            ) : (
              <>
                <span className="text-base font-semibold text-emerald-600 dark:text-emerald-400">
                  Free agent
                </span>
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  Available on waivers
                </span>
              </>
            )}
          </div>
        </section>

        {/* Jingles Labs call, when he has one on this player */}
        <JinglesCallCard sleeperId={id} leagueType={leagueProfile?.type} />

        {/* KTC consensus. Dynasty only: KeepTradeCut publishes dynasty
            rankings, so this is not a cross-check in a redraft league. */}
        {isDynasty && ktcMatch && (
          <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-zinc-200/80 bg-white/80 p-4 backdrop-blur dark:border-zinc-800/80 dark:bg-zinc-900/80">
            <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              Cross-source check
            </span>
            <span className="text-sm">
              KTC value{" "}
              <span className="font-bold tabular-nums">
                {ktcMatch.value.toLocaleString()}
              </span>{" "}
              · rank #{ktcMatch.globalRank}
            </span>
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              RA value{" "}
              <span className="font-semibold tabular-nums">
                {(isSuperflex
                  ? profile.value.sf
                  : profile.value.oneQb
                ).toLocaleString()}
              </span>{" "}
              · rank #
              {isSuperflex ? profile.value.rankSf : profile.value.rank1qb}
            </span>
            {(() => {
              const raVal = isSuperflex
                ? profile.value.sf
                : profile.value.oneQb;
              const delta = ktcMatch.value - raVal;
              const pct = Math.round((delta / Math.max(raVal, 1)) * 100);
              if (Math.abs(pct) <= 5) {
                return (
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
                    Consensus
                  </span>
                );
              }
              return (
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                    delta > 0
                      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
                      : "bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300"
                  }`}
                >
                  KTC {pct > 0 ? "+" : ""}
                  {pct}%
                </span>
              );
            })()}
          </div>
        )}

        {/* Recent news */}
        {news.length > 0 && (
          <section className="flex flex-col gap-3">
            <div className="flex items-baseline justify-between">
              <h2 className="text-xl font-semibold tracking-tight">
                Recent news
              </h2>
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                via ESPN
              </span>
            </div>
            <ul className="flex flex-col divide-y divide-zinc-200 overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
              {news.map((n) => {
                const relTime = n.relativeTime ?? null;
                const Content = (
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="text-sm font-semibold leading-snug">
                      {n.headline}
                    </span>
                    {n.description && (
                      <span className="line-clamp-2 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
                        {n.description}
                      </span>
                    )}
                    {relTime && (
                      <span className="text-[11px] text-zinc-500 dark:text-zinc-500">
                        {relTime}
                      </span>
                    )}
                  </div>
                );
                return (
                  <li
                    key={n.id}
                    className="px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-800/40"
                  >
                    {n.url ? (
                      <a
                        href={n.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block"
                      >
                        {Content}
                      </a>
                    ) : (
                      Content
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {/* Value history. RosterAudit's series is dynasty value over time, so
            it does not describe a redraft league. */}
        {isDynasty && (
          <ValueChart
            history={profile.valueHistory}
            format={isSuperflex ? "sf" : "oneQb"}
          />
        )}

        {/* Recent stats */}
        {stats && stats.weekly.length > 0 && (
          <section className="flex flex-col gap-3">
            <div className="flex items-baseline justify-between">
              <h2 className="text-xl font-semibold tracking-tight">
                {stats.season} season
              </h2>
              {seasonStat && (
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  {seasonStat.games} games · avg{" "}
                  <span className="font-semibold text-zinc-900 dark:text-zinc-50">
                    {seasonStat.avgFp.toFixed(1)}
                  </span>{" "}
                  fp/g · total{" "}
                  <span className="font-semibold tabular-nums">
                    {seasonStat.totalFp.toFixed(1)}
                  </span>
                </span>
              )}
            </div>
            <div className="overflow-hidden rounded-2xl border border-zinc-200/80 bg-white/80 backdrop-blur dark:border-zinc-800/80 dark:bg-zinc-900/80">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 bg-zinc-50/50 text-[10px] uppercase tracking-wider text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950/40 dark:text-zinc-400">
                    <th className="px-3 py-2 text-left">Wk</th>
                    <th className="px-3 py-2 text-left">Opp</th>
                    <th className="px-3 py-2 text-right">FP</th>
                    <th className="hidden px-3 py-2 text-right sm:table-cell">
                      {profile.player.position === "QB"
                        ? "Pass yds"
                        : profile.player.position === "RB"
                          ? "Rush yds"
                          : "Rec yds"}
                    </th>
                    <th className="hidden px-3 py-2 text-right sm:table-cell">
                      TDs
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                  {recentWeekly.map((w) => {
                    const yards =
                      profile.player.position === "QB"
                        ? w.pass ?? 0
                        : profile.player.position === "RB"
                          ? w.rush ?? 0
                          : w.recy ?? 0;
                    const tds =
                      (w.ptd ?? 0) + (w.rtd ?? 0) + (w.retd ?? 0);
                    return (
                      <tr key={w.week} className="text-sm">
                        <td className="px-3 py-2 font-semibold tabular-nums">
                          {w.week}
                        </td>
                        <td className="px-3 py-2 text-zinc-500 dark:text-zinc-400">
                          {w.opp ?? "—"}
                        </td>
                        <td className="px-3 py-2 text-right font-semibold tabular-nums">
                          {w.fp.toFixed(1)}
                        </td>
                        <td className="hidden px-3 py-2 text-right tabular-nums sm:table-cell">
                          {yards}
                        </td>
                        <td className="hidden px-3 py-2 text-right tabular-nums sm:table-cell">
                          {tds}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {!stats && profile.player.yearsExp === 0 && (
          <p className="rounded-2xl border border-dashed border-zinc-300 bg-white/40 px-4 py-6 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900/40 dark:text-zinc-400">
            Rookie — no NFL stats yet.
          </p>
        )}

        {/* Similar players */}
        {similar.length > 0 && (
          <section className="flex flex-col gap-3">
            <h2 className="text-xl font-semibold tracking-tight">
              Similar value
            </h2>
            <ul className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
              {similar.map((s) => {
                const sleeperPlayer = (allPlayers as Record<string, unknown>)[
                  s.sleeperId
                ];
                return (
                  <li key={s.sleeperId}>
                    <Link
                      href={`/l/${leagueId}/player/${s.sleeperId}`}
                      className="group flex items-center gap-3 rounded-2xl border border-zinc-200/80 bg-white/80 p-3 backdrop-blur transition-colors hover:border-amber-300 dark:border-zinc-800/80 dark:bg-zinc-900/80 dark:hover:border-amber-800"
                    >
                      <PlayerAvatar
                        name={s.name}
                        position={s.position}
                        photoUrl={s.photoUrl}
                        size="sm"
                      />
                      <div className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-sm font-semibold">
                          {s.name}
                        </span>
                        <span className="text-xs text-zinc-500 dark:text-zinc-400">
                          {s.team ?? "FA"} · {s.position} · {sleeperPlayer
                            ? ""
                            : ""}#{s.overallRank}
                        </span>
                      </div>
                      <span className="shrink-0 text-sm font-semibold tabular-nums">
                        {s.value.toLocaleString()}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Player data + values via{" "}
          <a
            href="https://rosteraudit.com"
            target="_blank"
            rel="noopener noreferrer"
            className="text-amber-700 hover:underline dark:text-amber-400"
          >
            RosterAudit
          </a>{" "}
          · weekly stats from NFLverse · cross-reference values from KeepTradeCut.
        </p>
      </div>
    </main>
  );
}
