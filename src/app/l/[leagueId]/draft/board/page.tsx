import Link from "next/link";
import { Trophy } from "lucide-react";
import {
  formatKeyFromLeague,
  getAllPicks,
} from "@/lib/rosteraudit/client";
import type { PickSlot, RAPick } from "@/lib/rosteraudit/types";
import {
  getAllPlayers,
  getDraftPicks,
  getLeague,
  getLeagueDrafts,
  getLeagueRosters,
  getLeagueUsers,
  getUser,
} from "@/lib/sleeper/client";
import type { SleeperPlayer } from "@/lib/sleeper/types";
import { AutoRefresh } from "@/components/AutoRefresh";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import { PlayerLink } from "@/components/PlayerLink";
import { RefreshButton } from "@/components/RefreshButton";
import { getValuesForProfile } from "@/lib/values";
import { profileFromSleeper } from "@/lib/league/detect";

export const dynamic = "force-dynamic";

function ConfigError({ message }: { message: string }) {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="flex max-w-2xl flex-col gap-3">
        <Link href="/fantasy" className="text-sm text-zinc-500 dark:text-zinc-400">
          ‹ Leagues
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight">Draft board</h1>
        <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800 dark:bg-red-950/50 dark:text-red-300">
          {message}
        </p>
      </div>
    </main>
  );
}

function nameOf(p: SleeperPlayer): string {
  if (p.full_name) return p.full_name;
  return `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || p.player_id;
}

function slotZone(slot: number, teams: number): PickSlot {
  const third = teams / 3;
  if (slot <= Math.ceil(third)) return "early";
  if (slot > Math.ceil(third * 2)) return "late";
  return "mid";
}

function findPickValue(
  raPicks: RAPick[],
  season: number,
  round: number,
  slot: number,
  totalTeams: number,
  isSuperflex: boolean,
): number {
  const zone = slotZone(slot, totalTeams);
  const ra = raPicks.find(
    (p) => p.season === season && p.round === round && p.slot === zone,
  );
  if (!ra) return 0;
  return isSuperflex ? ra.valueSf : ra.value1qb;
}

interface TeamSnapshot {
  rosterId: number;
  ownerName: string;
  isMe: boolean;
  picksMade: Array<{
    pickNo: number;
    round: number;
    slot: number;
    playerId: string;
    playerName: string;
    position: string | null;
    photoUrl: string | null;
    playerValue: number;
    expectedValue: number;
    surplus: number;
  }>;
  totalDrafted: number;
  totalExpected: number;
  totalSurplus: number;
  pctSurplus: number;
}

function gradeFromPct(pct: number, picksMade: number): string {
  if (picksMade === 0) return "—";
  if (pct >= 0.3) return "A+";
  if (pct >= 0.18) return "A";
  if (pct >= 0.1) return "A-";
  if (pct >= 0.04) return "B+";
  if (pct >= -0.04) return "B";
  if (pct >= -0.1) return "B-";
  if (pct >= -0.18) return "C";
  if (pct >= -0.3) return "D";
  return "F";
}

function gradeColor(grade: string): { tile: string; shadow: string } {
  if (grade.startsWith("A")) {
    return {
      tile: "from-emerald-400 to-emerald-600",
      shadow: "shadow-emerald-500/30",
    };
  }
  if (grade.startsWith("B")) {
    return { tile: "from-sky-400 to-sky-600", shadow: "shadow-sky-500/30" };
  }
  if (grade.startsWith("C")) {
    return { tile: "from-zinc-400 to-zinc-600", shadow: "shadow-zinc-500/20" };
  }
  if (grade.startsWith("D")) {
    return {
      tile: "from-amber-400 to-orange-500",
      shadow: "shadow-amber-500/30",
    };
  }
  return { tile: "from-rose-400 to-rose-600", shadow: "shadow-rose-500/30" };
}

export default async function DraftBoardPage({
  params,
}: {
  params: Promise<{ leagueId: string }>;
}) {
  const { leagueId } = await params;
  const username = process.env.SLEEPER_USERNAME;
  if (!username) {
    return <ConfigError message="Missing SLEEPER_USERNAME in .env.local" />;
  }

  const me = await getUser(username);
  const league = await getLeague(leagueId);
  const raFormat = formatKeyFromLeague(league);
  const isSuperflex = raFormat.startsWith("sf");

  const [drafts, rosters, users, players, fcValues, raPicks] =
    await Promise.all([
      getLeagueDrafts(leagueId),
      getLeagueRosters(leagueId),
      getLeagueUsers(leagueId),
      getAllPlayers(),
      getValuesForProfile(profileFromSleeper(league), league).then((r) => r.values),
      getAllPicks(),
    ]);

  if (drafts.length === 0) {
    return <ConfigError message="No drafts found for this league." />;
  }

  const draft = drafts[0];
  const picks = await getDraftPicks(draft.draft_id).catch(() => []);

  const usersById = new Map(users.map((u) => [u.user_id, u]));
  const totalTeams = draft.settings?.teams ?? rosters.length ?? 12;
  const seasonNum = Number(draft.season ?? new Date().getFullYear());

  // Build snapshot per team.
  const snapshots: TeamSnapshot[] = rosters.map((r) => {
    const owner = r.owner_id ? usersById.get(r.owner_id) : null;
    const ownerName =
      owner?.metadata?.team_name ||
      owner?.display_name ||
      owner?.username ||
      `Roster ${r.roster_id}`;

    const teamPicks = picks
      .filter((pk) => pk.roster_id === r.roster_id)
      .sort((a, b) => a.pick_no - b.pick_no);

    const picksMade = teamPicks
      .map((pk) => {
        const p = players[pk.player_id];
        const v = fcValues[pk.player_id];
        if (!p) return null;
        const expectedValue = findPickValue(
          raPicks,
          seasonNum,
          pk.round,
          pk.draft_slot,
          totalTeams,
          isSuperflex,
        );
        const playerValue = v?.value ?? 0;
        return {
          pickNo: pk.pick_no,
          round: pk.round,
          slot: pk.draft_slot,
          playerId: pk.player_id,
          playerName: nameOf(p),
          position: p.position ?? null,
          photoUrl: v?.photoUrl ?? null,
          playerValue,
          expectedValue,
          surplus: playerValue - expectedValue,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    const totalDrafted = picksMade.reduce((s, p) => s + p.playerValue, 0);
    const totalExpected = picksMade.reduce((s, p) => s + p.expectedValue, 0);
    const totalSurplus = totalDrafted - totalExpected;
    const pctSurplus =
      totalExpected > 0 ? totalSurplus / totalExpected : 0;

    return {
      rosterId: r.roster_id,
      ownerName,
      isMe: r.owner_id === me.user_id,
      picksMade,
      totalDrafted,
      totalExpected,
      totalSurplus,
      pctSurplus,
    };
  });

  // Sort: my team always shown first, then by surplus desc.
  const sorted = [...snapshots].sort((a, b) => {
    if (a.isMe !== b.isMe) return a.isMe ? -1 : 1;
    return b.totalSurplus - a.totalSurplus;
  });

  const totalRounds = draft.settings?.rounds ?? 4;
  const totalPicks = totalRounds * totalTeams;
  const completePct = totalPicks > 0 ? picks.length / totalPicks : 0;

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex flex-col gap-8">
        <div className="flex flex-col gap-2">
          <Link
            href={`/l/${leagueId}/draft`}
            className="text-sm text-zinc-500 dark:text-zinc-400"
          >
            ‹ Draft helper
          </Link>
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              Draft board
            </h1>
            <div className="flex items-center gap-2">
              <RefreshButton leagueId={leagueId} />
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide ${
                  draft.status === "drafting"
                    ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300"
                    : draft.status === "complete"
                      ? "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                      : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                }`}
              >
                {draft.status === "pre_draft"
                  ? "Pre-draft"
                  : draft.status === "drafting"
                    ? "Drafting"
                    : draft.status === "complete"
                      ? "Complete"
                      : draft.status}
              </span>
            </div>
          </div>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {league.name} · {league.season} · {picks.length} of {totalPicks}{" "}
            picks made ({Math.round(completePct * 100)}%)
          </p>
          <AutoRefresh
            intervalMs={
              draft.status === "drafting" ? 60_000 : 5 * 60_000
            }
            label={
              draft.status === "drafting" ? "Live updates" : "Refreshes"
            }
          />
        </div>

        <ol className="flex flex-col gap-4">
          {sorted.map((t, idx) => {
            const grade = gradeFromPct(t.pctSurplus, t.picksMade.length);
            const tint = gradeColor(grade);
            const surplusColor =
              t.totalSurplus > 0
                ? "text-emerald-600 dark:text-emerald-400"
                : t.totalSurplus < 0
                  ? "text-rose-600 dark:text-rose-400"
                  : "text-zinc-500 dark:text-zinc-400";
            return (
              <li
                key={t.rosterId}
                className={`flex flex-col gap-3 rounded-2xl border p-5 backdrop-blur ${
                  t.isMe
                    ? "border-amber-300 bg-amber-50/40 dark:border-amber-800 dark:bg-amber-950/20"
                    : "border-zinc-200/80 bg-white/80 dark:border-zinc-800/80 dark:bg-zinc-900/80"
                }`}
              >
                <div className="flex flex-wrap items-center gap-4">
                  <span
                    className={`grid size-12 shrink-0 place-items-center rounded-xl bg-gradient-to-br text-sm font-black tracking-tight text-white shadow-md ${tint.tile} ${tint.shadow}`}
                  >
                    {grade}
                  </span>
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-base font-bold">
                        {t.ownerName}
                      </span>
                      {t.isMe && (
                        <Trophy
                          size={14}
                          className="shrink-0 text-amber-600 dark:text-amber-400"
                          aria-hidden
                        />
                      )}
                    </div>
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">
                      {t.picksMade.length} of {totalRounds} picks ·{" "}
                      <span className="tabular-nums">
                        {t.totalDrafted.toLocaleString()}
                      </span>{" "}
                      drafted
                    </span>
                  </div>
                  <div className="ml-auto flex items-baseline gap-3">
                    <div className="flex flex-col items-end">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                        Surplus
                      </span>
                      <span
                        className={`text-2xl font-bold tabular-nums ${surplusColor}`}
                      >
                        {t.totalSurplus > 0 ? "+" : ""}
                        {t.totalSurplus.toLocaleString()}
                      </span>
                    </div>
                    <span className="text-xs text-zinc-400 dark:text-zinc-600">
                      #{idx + 1}
                    </span>
                  </div>
                </div>

                {t.picksMade.length > 0 && (
                  <ul className="flex flex-col divide-y divide-zinc-200/60 border-t border-zinc-200/60 dark:divide-zinc-800/60 dark:border-zinc-800/60">
                    {t.picksMade.map((pk) => (
                      <li
                        key={pk.pickNo}
                        className="flex items-center gap-3 py-2"
                      >
                        <span className="w-12 shrink-0 text-xs font-semibold tabular-nums text-zinc-500 dark:text-zinc-400">
                          {pk.round}.{pk.slot.toString().padStart(2, "0")}
                        </span>
                        <PlayerAvatar
                          name={pk.playerName}
                          position={pk.position}
                          photoUrl={pk.photoUrl}
                          size="sm"
                        />
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">
                          <PlayerLink
                            id={pk.playerId}
                            name={pk.playerName}
                          />
                          <span className="ml-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                            {pk.position ?? ""}
                          </span>
                        </span>
                        <span className="shrink-0 text-sm font-semibold tabular-nums">
                          {pk.playerValue.toLocaleString()}
                        </span>
                        {Math.abs(pk.surplus) >= 50 && (
                          <span
                            className={`shrink-0 w-20 text-right text-[10px] font-bold tabular-nums ${
                              pk.surplus > 0
                                ? "text-emerald-600 dark:text-emerald-400"
                                : "text-rose-600 dark:text-rose-400"
                            }`}
                          >
                            {pk.surplus > 0 ? "+" : ""}
                            {pk.surplus.toLocaleString()}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}

                {t.picksMade.length === 0 && (
                  <p className="text-xs text-zinc-400 dark:text-zinc-600">
                    No picks made yet.
                  </p>
                )}
              </li>
            );
          })}
        </ol>

        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Grades update each refresh. Surplus = sum of (player value - pick
          value) for picks made.
        </p>
      </div>
    </main>
  );
}
