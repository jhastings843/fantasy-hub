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
  getLeague,
  getLeagueRosters,
  getLeagueUsers,
} from "@/lib/sleeper/client";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import { JinglesCallCard } from "@/components/JinglesBadge";
import { ValueChart } from "./ValueChart";
import { Chip, Disclosure, Empty, Num, Section, Stat } from "@/components/hh/ui";
import { PopLink } from "@/components/hh/PopLink";
import { TeamEdge } from "@/components/hh/team";
import { PlayerLink } from "@/components/PlayerLink";
import { teamHref } from "@/app/picks/hrefs";

export const dynamic = "force-dynamic";

function NotFound({ id }: { id: string }) {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="flex max-w-2xl flex-col gap-3">
        <Link href="/fantasy" className="inline-flex min-h-11 items-center self-start text-sm text-hh-muted hover:text-hh-ink">
          ‹ Leagues
        </Link>
        <h1 className="hh-title">Player profile</h1>
        <p className="border-l-2 border-hh-neg py-1 pl-3 text-sm text-hh-neg">
          No data found for player id <Num>{id}</Num>.
        </p>
      </div>
    </main>
  );
}

/** An NFL team code that opens the team pop-up; free agents stay text. */
function TeamCode({ team }: { team: string | null | undefined }) {
  if (!team) return <>FA</>;
  return <PopLink href={teamHref("nfl", team)}>{team}</PopLink>;
}

function signed(n: number): string {
  return `${n > 0 ? "+" : ""}${n.toLocaleString()}`;
}

function trendTone(n: number) {
  return n > 0 ? ("pos" as const) : n < 0 ? ("neg" as const) : ("muted" as const);
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

  const [rosters, users, raValues, ktc] = await Promise.all([
    leagueId ? getLeagueRosters(leagueId) : Promise.resolve([]),
    leagueId ? getLeagueUsers(leagueId) : Promise.resolve([]),
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

  const bio = [
    profile.player.age != null ? `Age ${profile.player.age.toFixed(1)}` : null,
    profile.player.yearsExp != null
      ? `${profile.player.yearsExp} yr${profile.player.yearsExp === 1 ? "" : "s"} exp`
      : null,
    profile.player.college,
    profile.player.height
      ? `${Math.floor(Number(profile.player.height) / 12)}'${Number(profile.player.height) % 12}"`
      : null,
    profile.player.weight ? `${profile.player.weight}lb` : null,
  ].filter(Boolean);
  const headTrend = trend7d ?? trend30d;

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex flex-col gap-8">
        {/* Breadcrumb */}
        <Link
          href={`/l/${leagueId}`}
          className="inline-flex min-h-11 items-center self-start text-sm text-hh-muted hover:text-hh-ink"
        >
          ‹ League
        </Link>

        {/* Header */}
        <TeamEdge league="nfl" team={profile.player.team} className="-mt-4 flex flex-col gap-4 sm:flex-row sm:items-center">
          <PlayerAvatar
            name={profile.player.name}
            position={profile.player.position}
            photoUrl={profile.player.photoUrl}
            size="lg"
          />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <h1 className="hh-title">{profile.player.name}</h1>
            <span className="text-sm text-hh-muted">
              <TeamCode team={profile.player.team} /> · {profile.player.position}
            </span>
            <div className="flex flex-wrap items-center gap-1.5">
              {isDynasty && profile.value.tierLabel && (
                <Chip tone="accent">
                  Tier <Num>{profile.value.tier}</Num>: {profile.value.tierLabel}
                </Chip>
              )}
              {profile.player.injuryStatus && <Chip tone="neg">{profile.player.injuryStatus}</Chip>}
              {isDynasty && profile.value.buyLow && <Chip tone="pos">Buy low</Chip>}
              {isDynasty && profile.value.sellHigh && <Chip tone="neg">Sell high</Chip>}
              {isDynasty && profile.value.breakout && <Chip tone="gold">Breakout</Chip>}
            </div>
          </div>
        </TeamEdge>

        {/* Value snapshot */}
        <Section label="Value">
          <div className="grid grid-cols-2 gap-x-6 gap-y-5 md:grid-cols-3">
            <Stat
              label="Value (your league)"
              value={formatValue.value.toLocaleString()}
              sub={
                <>
                  <Num>#{formatValue.overallRank}</Num> overall · <Num>{profile.player.position}{formatValue.positionRank}</Num>
                </>
              }
            />
            <Stat
              label={`Trend (${trend7d === null ? "30d" : "7d"})`}
              value={signed(headTrend)}
              tone={trendTone(headTrend)}
              sub={
                isDynasty ? (
                  <>
                    30d: <Num tone={trend30d !== 0 ? trendTone(trend30d) : undefined}>{signed(trend30d)}</Num>
                    {" · "}90d:{" "}
                    <Num tone={profile.value.trend90d !== 0 ? trendTone(profile.value.trend90d) : undefined}>
                      {signed(profile.value.trend90d)}
                    </Num>
                  </>
                ) : undefined
              }
            />
            <div className="col-span-2 flex min-w-0 flex-col gap-1 md:col-span-1">
              <span className="text-xs text-hh-muted">In your league</span>
              {ownerRoster ? (
                <>
                  <span className="text-lg font-semibold leading-tight text-hh-ink">{ownerName}</span>
                  <span className="text-xs text-hh-muted">
                    Roster <Num>#{ownerRoster.roster_id}</Num>
                  </span>
                </>
              ) : (
                <>
                  <span className="text-lg font-semibold leading-tight text-hh-pos">Free agent</span>
                  <span className="text-xs text-hh-muted">Available on waivers</span>
                </>
              )}
            </div>
          </div>

          {/* KTC consensus. Dynasty only: KeepTradeCut publishes dynasty
              rankings, so this is not a cross-check in a redraft league. */}
          {isDynasty && ktcMatch && (
            <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-hh-line pt-3">
              <span className="hh-label">Cross-source check</span>
              <span className="text-sm text-hh-ink">
                KTC value <Num className="font-semibold">{ktcMatch.value.toLocaleString()}</Num> · rank{" "}
                <Num>#{ktcMatch.globalRank}</Num>
              </span>
              <span className="text-xs text-hh-muted">
                RA value{" "}
                <Num className="font-semibold">
                  {(isSuperflex ? profile.value.sf : profile.value.oneQb).toLocaleString()}
                </Num>{" "}
                · rank <Num>#{isSuperflex ? profile.value.rankSf : profile.value.rank1qb}</Num>
              </span>
              {(() => {
                const raVal = isSuperflex ? profile.value.sf : profile.value.oneQb;
                const delta = ktcMatch.value - raVal;
                const pct = Math.round((delta / Math.max(raVal, 1)) * 100);
                if (Math.abs(pct) <= 5) {
                  return <Chip tone="pos">CONSENSUS</Chip>;
                }
                return (
                  <Chip tone={delta > 0 ? "pos" : "neg"}>
                    KTC <Num>{pct > 0 ? "+" : ""}{pct}%</Num>
                  </Chip>
                );
              })()}
            </div>
          )}
        </Section>

        {/* Jingles Labs call, when he has one on this player */}
        <JinglesCallCard sleeperId={id} leagueType={leagueProfile?.type} />

        {/* Recent news */}
        {news.length > 0 && (
          <Section label="Recent news" aside="via ESPN">
            <ul className="flex flex-col">
              {news.map((n) => {
                const relTime = n.relativeTime ?? null;
                const Content = (
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="text-sm font-semibold leading-snug text-hh-ink">{n.headline}</span>
                    {n.description && (
                      <span className="line-clamp-2 text-xs leading-relaxed text-hh-ink-2">{n.description}</span>
                    )}
                    {relTime && <span className="text-[11px] text-hh-muted">{relTime}</span>}
                  </div>
                );
                return (
                  <li key={n.id} className="border-b border-hh-line py-3 last:border-b-0">
                    {n.url ? (
                      <a href={n.url} target="_blank" rel="noopener noreferrer" className="block hover:[&_span:first-child]:text-hh-accent-ink">
                        {Content}
                      </a>
                    ) : (
                      Content
                    )}
                  </li>
                );
              })}
            </ul>
          </Section>
        )}

        {/* Similar players */}
        {similar.length > 0 && (
          <Section label="Similar value">
            <ul className="grid gap-x-8 md:grid-cols-2 lg:grid-cols-3">
              {similar.map((s) => (
                <li key={s.sleeperId}>
                  <TeamEdge league="nfl" team={s.team} className="flex min-h-11 items-center gap-3 border-b border-hh-line py-2">
                    <PlayerAvatar name={s.name} position={s.position} photoUrl={s.photoUrl} size="sm" />
                    <div className="flex min-w-0 flex-1 flex-col">
                      <PlayerLink id={s.sleeperId} name={s.name} className="truncate text-sm font-semibold text-hh-ink" />
                      <span className="text-xs text-hh-muted">
                        <TeamCode team={s.team} /> · {s.position} · <Num>#{s.overallRank}</Num>
                      </span>
                    </div>
                    <Num className="shrink-0 text-sm font-semibold text-hh-ink">{s.value.toLocaleString()}</Num>
                  </TeamEdge>
                </li>
              ))}
            </ul>
          </Section>
        )}

        <div className="flex flex-col">
          {bio.length > 0 && (
            <Disclosure summary="Bio">
              <p className="text-sm text-hh-ink-2">{bio.join(" · ")}</p>
            </Disclosure>
          )}

          {/* Value history. RosterAudit's series is dynasty value over time, so
              it does not describe a redraft league. */}
          {isDynasty && (
            <Disclosure summary="Value history">
              <ValueChart history={profile.valueHistory} format={isSuperflex ? "sf" : "oneQb"} />
            </Disclosure>
          )}

          {/* Recent stats */}
          {stats && stats.weekly.length > 0 && (
            <Disclosure
              summary={
                <>
                  <Num>{stats.season}</Num> season
                  {seasonStat && (
                    <span className="ml-2 font-normal text-hh-muted">
                      avg <Num>{seasonStat.avgFp.toFixed(1)}</Num> fp/g
                    </span>
                  )}
                </>
              }
            >
              {seasonStat && (
                <p className="text-xs text-hh-muted">
                  <Num>{seasonStat.games}</Num> games · avg{" "}
                  <Num className="font-semibold text-hh-ink">{seasonStat.avgFp.toFixed(1)}</Num> fp/g · total{" "}
                  <Num className="font-semibold text-hh-ink">{seasonStat.totalFp.toFixed(1)}</Num>
                </p>
              )}
              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-hh-rule text-[10px] uppercase tracking-wider text-hh-muted">
                      <th className="px-2 py-2 text-left font-semibold">Wk</th>
                      <th className="px-2 py-2 text-left font-semibold">Opp</th>
                      <th className="px-2 py-2 text-right font-semibold">FP</th>
                      <th className="hidden px-2 py-2 text-right font-semibold sm:table-cell">
                        {profile.player.position === "QB"
                          ? "Pass yds"
                          : profile.player.position === "RB"
                            ? "Rush yds"
                            : "Rec yds"}
                      </th>
                      <th className="hidden px-2 py-2 text-right font-semibold sm:table-cell">TDs</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentWeekly.map((w) => {
                      const yards =
                        profile.player.position === "QB"
                          ? w.pass ?? 0
                          : profile.player.position === "RB"
                            ? w.rush ?? 0
                            : w.recy ?? 0;
                      const tds = (w.ptd ?? 0) + (w.rtd ?? 0) + (w.retd ?? 0);
                      return (
                        <tr key={w.week} className="border-b border-hh-line last:border-b-0">
                          <td className="px-2 py-2 font-semibold text-hh-ink"><Num>{w.week}</Num></td>
                          {/* Past weeks: opponent stays text (pop-ups read the current board only). */}
                          <td className="px-2 py-2 text-hh-muted">{w.opp ?? "None"}</td>
                          <td className="px-2 py-2 text-right font-semibold text-hh-ink"><Num>{w.fp.toFixed(1)}</Num></td>
                          <td className="hidden px-2 py-2 text-right sm:table-cell"><Num>{yards}</Num></td>
                          <td className="hidden px-2 py-2 text-right sm:table-cell"><Num>{tds}</Num></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Disclosure>
          )}
        </div>

        {!stats && profile.player.yearsExp === 0 && <Empty>Rookie. No NFL stats yet.</Empty>}

        <p className="text-xs text-hh-muted">
          Player data + values via{" "}
          <a
            href="https://rosteraudit.com"
            target="_blank"
            rel="noopener noreferrer"
            className="text-hh-accent-ink underline-offset-[3px] hover:underline"
          >
            RosterAudit
          </a>{" "}
          · weekly stats from NFLverse · cross-reference values from KeepTradeCut.
        </p>
      </div>
    </main>
  );
}
