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
import { Chip, Empty, Num, Section, type Tone } from "@/components/hh/ui";

export const dynamic = "force-dynamic";

function ConfigError({ message }: { message: string }) {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-10 text-hh-ink sm:px-6 lg:px-8">
      <div className="flex max-w-2xl flex-col gap-3">
        <Link href="/fantasy" className="inline-flex min-h-11 items-center text-sm text-hh-muted hover:text-hh-accent-ink sm:min-h-0">
          ‹ Leagues
        </Link>
        <h1 className="hh-title">Draft board</h1>
        <p className="border-l-2 border-hh-neg py-2 pl-3 text-sm text-hh-neg">{message}</p>
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
  if (picksMade === 0) return "n/a";
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

function gradeTone(grade: string): Tone {
  if (grade.startsWith("A")) return "pos";
  if (grade.startsWith("B")) return "gold";
  if (grade.startsWith("C")) return "muted";
  if (grade.startsWith("D")) return "accent";
  if (grade === "n/a") return "muted";
  return "neg";
}

const GRADE_TEXT: Record<Tone, string> = {
  accent: "text-hh-accent-ink",
  pos: "text-hh-pos",
  neg: "text-hh-neg",
  gold: "text-hh-gold",
  muted: "text-hh-muted",
  live: "text-hh-neg",
};

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

  const leader = sorted.filter((t) => t.picksMade.length > 0).reduce<TeamSnapshot | null>(
    (best, t) => (best === null || t.totalSurplus > best.totalSurplus ? t : best),
    null,
  );

  return (
    <main className="mx-auto w-full max-w-6xl min-w-0 break-words px-4 py-8 text-hh-ink sm:px-6 lg:px-8">
      <div className="flex flex-col gap-8">
        <div className="flex flex-col gap-2">
          <Link
            href={`/l/${leagueId}/draft`}
            className="inline-flex min-h-11 items-center text-sm text-hh-muted hover:text-hh-accent-ink sm:min-h-0"
          >
            ‹ Draft helper
          </Link>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h1 className="hh-title">Draft board</h1>
            <div className="flex items-center gap-2">
              <RefreshButton leagueId={leagueId} />
              <Chip tone={draft.status === "drafting" ? "live" : "muted"}>
                {draft.status === "pre_draft"
                  ? "Pre-draft"
                  : draft.status === "drafting"
                    ? "Drafting"
                    : draft.status === "complete"
                      ? "Complete"
                      : draft.status}
              </Chip>
            </div>
          </div>
          <p className="text-sm text-hh-muted">
            {league.name} · {league.season} · <Num>{picks.length}</Num> of <Num>{totalPicks}</Num> picks made (
            <Num>{Math.round(completePct * 100)}%</Num>)
          </p>
          <AutoRefresh
            intervalMs={draft.status === "drafting" ? 60_000 : 5 * 60_000}
            label={draft.status === "drafting" ? "Live updates" : "Refreshes"}
          />
          {leader && (
            <p className="mt-1 max-w-2xl text-[15px] leading-snug text-hh-ink-2">
              <b className="font-semibold text-hh-ink">{leader.isMe ? "You lead the room" : `${leader.ownerName} leads the room`}</b>{" "}
              at{" "}
              <Num tone={leader.totalSurplus >= 0 ? "pos" : "neg"}>
                {leader.totalSurplus > 0 ? "+" : ""}
                {leader.totalSurplus.toLocaleString()}
              </Num>{" "}
              value over where they picked.
            </p>
          )}
        </div>

        <ol className="grid gap-x-10 gap-y-8 lg:grid-cols-2">
          {sorted.map((t, idx) => {
            const grade = gradeFromPct(t.pctSurplus, t.picksMade.length);
            const surplusTone: Tone = t.totalSurplus > 0 ? "pos" : t.totalSurplus < 0 ? "neg" : "muted";
            return (
              <li key={t.rosterId} className="min-w-0">
                <Section
                  label={
                    <span className="inline-flex items-center gap-1.5">
                      <span className={t.isMe ? "text-hh-accent-ink" : ""}>{t.ownerName}</span>
                      {t.isMe && <Trophy size={13} className="shrink-0 text-hh-accent-ink" aria-label="Your team" />}
                    </span>
                  }
                  aside={<Num>#{idx + 1}</Num>}
                >
                  <div className="flex flex-wrap items-center gap-4">
                    <span className={`hh-num w-12 shrink-0 text-3xl font-bold leading-none ${GRADE_TEXT[gradeTone(grade)]}`}>{grade}</span>
                    <span className="min-w-0 text-xs text-hh-muted">
                      <Num>{t.picksMade.length}</Num> of <Num>{totalRounds}</Num> picks ·{" "}
                      <Num>{t.totalDrafted.toLocaleString()}</Num> drafted
                    </span>
                    <div className="ml-auto flex flex-col items-end">
                      <span className="text-[11px] text-hh-muted">Surplus</span>
                      <Num tone={surplusTone} className="text-2xl font-bold leading-none">
                        {t.totalSurplus > 0 ? "+" : ""}
                        {t.totalSurplus.toLocaleString()}
                      </Num>
                    </div>
                  </div>

                  {t.picksMade.length > 0 && (
                    <ul className="mt-2 flex flex-col border-t border-hh-line">
                      {t.picksMade.map((pk) => (
                        <li key={pk.pickNo} className="flex min-h-11 items-center gap-3 border-b border-hh-line py-2 last:border-b-0">
                          <Num className="w-12 shrink-0 text-xs font-semibold text-hh-muted">
                            {pk.round}.{pk.slot.toString().padStart(2, "0")}
                          </Num>
                          <PlayerAvatar name={pk.playerName} position={pk.position} photoUrl={pk.photoUrl} size="sm" />
                          <span className="min-w-0 flex-1 truncate text-sm font-medium">
                            <PlayerLink id={pk.playerId} name={pk.playerName} />
                            <span className="ml-1.5 text-xs text-hh-muted">{pk.position ?? ""}</span>
                          </span>
                          <Num className="shrink-0 text-sm font-semibold">{pk.playerValue.toLocaleString()}</Num>
                          {Math.abs(pk.surplus) >= 50 && (
                            <Num tone={pk.surplus > 0 ? "pos" : "neg"} className="w-16 shrink-0 text-right text-[10px] font-bold">
                              {pk.surplus > 0 ? "+" : ""}
                              {pk.surplus.toLocaleString()}
                            </Num>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}

                  {t.picksMade.length === 0 && <Empty>No picks made yet.</Empty>}
                </Section>
              </li>
            );
          })}
        </ol>

        <p className="text-xs text-hh-muted">
          Grades update each refresh. Surplus = sum of (player value - pick value) for picks made.
        </p>
      </div>
    </main>
  );
}
