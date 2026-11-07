"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import type { PlayerRow, TeamSummary } from "@/lib/dynasty/power-rankings";
import { suggestTradeFits } from "@/lib/dynasty/trade-fits";
import {
  evaluateTrade,
  findBestTrades,
  findLeagueWideMatches,
  suggestLevelers,
  tierForMatch,
  verdictLabel,
  packageKey,
  type PositionalImpact,
  type BestTradeIdea,
  type LeagueWideMatch,
  type LeagueWideMatchTier,
  type LevelerOption,
  type TradeVerdict,
} from "@/lib/dynasty/trade-recommender";
import type { RAPick } from "@/lib/rosteraudit/types";
import type { LeagueType } from "@/lib/league/types";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import { PlayerLink } from "@/components/PlayerLink";
import { tradeOffers } from "@/lib/dynasty/trade-offers";
import { Chip, Disclosure, Empty, Num, PosBadge, Section, type Tone } from "@/components/hh/ui";
import { PopLink } from "@/components/hh/PopLink";
import Link from "next/link";
import { teamHref } from "@/app/picks/hrefs";
import Offers from "./Offers";
import { STANCE_LABEL, type TradePlan } from "@/lib/dynasty/trade-plan";
import { trajectoryLabel } from "@/lib/dynasty/season-plan";

/** One line saying which plan the ideas below follow, with a way to edit it. */
function PlanStrip({ plan, loaded, leagueId }: { plan: TradePlan | null; loaded: boolean; leagueId: string }) {
  if (!plan) return null;
  const from =
    plan.stanceFrom === "goal" && plan.stanceGoal
      ? <>from your goal &ldquo;{plan.stanceGoal}&rdquo;</>
      : plan.stanceFrom === "trajectory" && plan.trajectory
        ? <>from your trajectory ({trajectoryLabel(plan.trajectory)})</>
        : plan.stanceFrom === "format"
          ? <>one-season league</>
          : <>no trajectory grade yet</>;
  const parts: string[] = [];
  if (plan.focus.length) parts.push(`Wants ${plan.focus.map((f) => f.position).join(", ")}`);
  if (plan.shed.length) parts.push(`Selling ${plan.shed.map((f) => f.position).join(", ")}`);
  if (plan.keep.length) parts.push(`Keeping ${plan.keep.map((k) => k.name).join(", ")}`);
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-hh-line py-3 text-sm text-hh-muted">
      <Chip tone={plan.stance === "win_now" ? "gold" : plan.stance === "build" ? "pos" : "muted"}>
        {STANCE_LABEL[plan.stance]}
      </Chip>
      <span>
        Ideas follow your plan, {from}.
        {parts.length > 0 ? ` ${parts.join(" · ")}.` : loaded ? " No open goals for this league yet." : " Couldn't read your goals just now, so only trajectory and weakest rooms count."}
      </span>
      <Link href={`/l/${leagueId}/plan`} className="font-semibold text-hh-accent-ink underline-offset-2 hover:underline">
        Edit plan
      </Link>
    </p>
  );
}

// Shared control looks (C3): hairline outline, panel fill, accent on focus,
// 44px tall on phones and compact from sm up.
const BTN_PRIMARY =
  "inline-flex h-11 shrink-0 items-center justify-center rounded-[6px] bg-hh-accent px-3 text-xs font-semibold text-[var(--hh-on-accent)] transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-hh-accent sm:h-8";
const BTN_SECONDARY =
  "inline-flex h-11 shrink-0 items-center justify-center rounded-[6px] border border-hh-line bg-hh-panel px-3 text-xs font-semibold text-hh-ink transition-colors hover:border-hh-accent hover:text-hh-accent-ink focus:border-hh-accent focus:outline-none sm:h-8";

/** A team code next to a player: the team's pop-up, or plain text for free agents. */
function TeamCode({ team }: { team: string | null | undefined }) {
  if (!team) return <>FA</>;
  return <PopLink href={teamHref("nfl", team)}>{team}</PopLink>;
}

interface RecapItem {
  key: string;
  position: string;
  label: string;
  value: number;
  playerId?: string;
}

const POSITIONS_DISPLAY = ["QB", "RB", "WR", "TE"] as const;

function rankClass(rank: number, totalTeams: number): string {
  if (rank <= 3) return "text-hh-pos font-medium";
  if (rank > totalTeams - 3) return "text-hh-neg font-medium";
  return "text-hh-ink-2";
}

function PlayerRowItem({
  p,
  checked,
  onChange,
}: {
  p: PlayerRow;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <label
      className={`flex min-h-11 cursor-pointer items-center gap-3 px-2 py-3 transition-colors ${
        checked
          ? "bg-hh-accent-soft"
          : "hover:bg-hh-sunk"
      }`}
    >
      <input
        type="checkbox"
        className="size-4 shrink-0 rounded-[3px] border-hh-line accent-[var(--hh-accent)]"
        checked={checked}
        onChange={onChange}
      />
      <PlayerAvatar
        name={p.name}
        position={p.position}
        photoUrl={p.photoUrl}
        size="sm"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <PlayerLink
            id={p.id}
            name={p.name}
            className="truncate text-sm font-medium"
            stopPropagation
          />
          {p.untouchable && <Chip>Keep</Chip>}
          {p.buyLow && <Chip tone="pos">Buy</Chip>}
          {p.sellHigh && <Chip tone="neg">Sell</Chip>}
          {p.breakout && <Chip tone="accent">Break</Chip>}
          <JinglesRankChip p={p} />
        </div>
        <span className="text-xs text-hh-muted">
          {[p.team ?? "FA", p.position].filter(Boolean).join(" · ")}
          {p.overallRank > 0
            ? ` · #${p.overallRank} ${p.position}${p.positionRank}`
            : ""}
        </span>
      </div>
      <span className="flex shrink-0 flex-col items-end">
        <Num className="text-sm font-semibold text-hh-ink">
          {p.value > 0 ? p.value.toLocaleString() : "-"}
        </Num>
        <MarketDelta p={p} />
      </span>
    </label>
  );
}

/**
 * Where he has the player, when a league reads his list. "Off list" only
 * shows for a player the market rates inside his range, because that absence
 * is a call; a deep bench player he never got to is not.
 */
function JinglesRankChip({ p }: { p: PlayerRow }) {
  if (p.jinglesDrop) {
    return (
      <span title="On Jingles' latest 'Players I'm Fine Dropping' list, so priced as a sell" className="shrink-0">
        <Chip tone="neg">J drop</Chip>
      </span>
    );
  }
  if (p.marketValue === undefined) return null;
  if (p.jinglesRank === null || p.jinglesRank === undefined) {
    return (
      <span title="Not on Jingles' season list, though the market rates him inside it" className="shrink-0">
        <Chip>Off list</Chip>
      </span>
    );
  }
  return (
    <span title={`Jingles has him ${p.position}${p.jinglesPositionRank ?? "?"}, #${p.jinglesRank} overall`} className="shrink-0">
      <Chip tone="gold">J {p.position}{p.jinglesPositionRank ?? p.jinglesRank}</Chip>
    </span>
  );
}

/** Signed distance from the market's number, so the blend is never hidden. */
function MarketDelta({ p }: { p: PlayerRow }) {
  if (p.marketValue === undefined) return null;
  const d = p.value - p.marketValue;
  if (d === 0) return null;
  return (
    <span title={`Market ${p.marketValue.toLocaleString()}`} className="text-[10px] font-medium">
      <Num tone={d > 0 ? "pos" : "neg"}>
        {d > 0 ? "+" : ""}
        {d.toLocaleString()}
      </Num>{" "}
      <span className={d > 0 ? "text-hh-pos" : "text-hh-neg"}>vs mkt</span>
    </span>
  );
}

function pickValue(p: RAPick, isSuperflex: boolean): number {
  return isSuperflex ? p.valueSf : p.value1qb;
}

const FILTER_POSITIONS = ["QB", "RB", "WR", "TE"] as const;
// Sentinel partner id meaning "any team in the league" (auto-match mode).
const ANYONE = -1;
// sessionStorage key for trade-builder state. sessionStorage so the
// state survives navigation within the tab (e.g. clicking a player to
// view their profile and coming back) but resets in a new tab.
const STORAGE_KEY = "fantasy-hub:trade-builder:v1";

interface PersistedState {
  partnerId: number;
  mySel: string[];
  theirSel: string[];
  myPickIds: number[];
  theirPickIds: number[];
  myPosFilter: string;
  theirPosFilter: string;
}

function PositionFilter({
  filter,
  setFilter,
  players,
}: {
  filter: string;
  setFilter: (f: string) => void;
  players: PlayerRow[];
}) {
  const counts: Record<string, number> = {
    all: players.length,
    QB: 0,
    RB: 0,
    WR: 0,
    TE: 0,
  };
  for (const p of players) {
    if (p.position in counts && p.position !== "all") {
      counts[p.position] += 1;
    }
  }
  const items = [
    { key: "all", label: "All" },
    ...FILTER_POSITIONS.map((p) => ({ key: p, label: p })),
  ];
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((it) => {
        const active = filter === it.key;
        const count = counts[it.key] ?? 0;
        return (
          <button
            key={it.key}
            type="button"
            onClick={() => setFilter(it.key)}
            disabled={count === 0 && it.key !== "all"}
            className={`h-11 rounded-[6px] px-3 text-xs font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-hh-accent disabled:cursor-not-allowed disabled:opacity-40 sm:h-8 ${
              active
                ? "bg-hh-accent text-[var(--hh-on-accent)]"
                : "border border-hh-line bg-hh-panel text-hh-ink-2 hover:border-hh-accent hover:text-hh-accent-ink"
            }`}
          >
            {it.label}{" "}
            <span className={`hh-num ${active ? "opacity-80" : "opacity-60"}`}>
              {count}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function RecapColumn({
  name,
  items,
  total,
  outcome,
}: {
  name: string;
  items: RecapItem[];
  total: number;
  outcome: "win" | "lose" | "even";
}) {
  const edgeCls =
    outcome === "win"
      ? "border-hh-pos"
      : outcome === "lose"
        ? "border-hh-neg"
        : "border-hh-line";
  const headColor =
    outcome === "win"
      ? "text-hh-pos"
      : outcome === "lose"
        ? "text-hh-neg"
        : "text-hh-ink-2";
  const totalTone: Tone | undefined =
    outcome === "win" ? "pos" : outcome === "lose" ? "neg" : undefined;
  return (
    <div
      className={`flex min-w-0 flex-col gap-2 border-l-2 pl-3 ${edgeCls}`}
    >
      <div className={`flex items-center gap-1.5 text-sm font-bold ${headColor}`}>
        <span className="truncate">{name} receives</span>
        {outcome === "win" && (
          <Check size={14} aria-hidden className="shrink-0" strokeWidth={3} />
        )}
      </div>
      {items.length === 0 ? (
        <p className="py-1 text-xs text-hh-muted">
          Nothing selected.
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {items.map((it) => (
            <li key={it.key} className="flex items-center gap-2">
              <PosBadge pos={it.position} />
              {it.playerId ? (
                <PlayerLink
                  id={it.playerId}
                  name={it.label}
                  className="min-w-0 flex-1 truncate text-sm"
                />
              ) : (
                <span className="min-w-0 flex-1 truncate text-sm">
                  {it.label}
                </span>
              )}
              <Num className="shrink-0 text-xs text-hh-muted">
                {it.value.toLocaleString()}
              </Num>
            </li>
          ))}
        </ul>
      )}
      <div className="border-t border-hh-line pt-2">
        <Num tone={totalTone} className={`text-3xl font-semibold leading-none ${totalTone ? "" : "text-hh-ink-2"}`}>
          {total.toLocaleString()}
        </Num>
      </div>
    </div>
  );
}

function verdictTone(v: TradeVerdict): Tone {
  switch (v) {
    case "accept":
    case "lean_accept":
      return "pos";
    case "even":
      return "muted";
    case "lean_decline":
    case "decline":
      return "neg";
  }
}

function partnerSummary(partner: { verdict: TradeVerdict; positionalImpact: PositionalImpact[] }) {
  const holes = partner.positionalImpact
    .filter((impact) => impact.holeChange === "closes" || (impact.holeChange === "stays_hole" && impact.delta > 0))
    .map((impact) => `${impact.holeChange === "closes" ? "Fills" : "Improves"} their ${impact.position} hole`);
  return `For them: ${verdictLabel(partner.verdict)}${holes.length ? ` · ${holes.join(" · ")}` : ""}`;
}

/** What the trade values were blended with, for the line that says so. */
export interface JinglesBlendInfo {
  title: string;
  url: string;
  postedAt: string;
  matchesLeagueScoring: boolean;
  /** Players on his list. */
  ranked: number;
  /** Players whose value the blend changed. */
  moved: number;
}

export default function TradeBuilder({
  teams,
  myRosterId,
  picks,
  isSuperflex,
  leagueType,
  faabBudget,
  faabByRosterId,
  jingles = null,
  plan = null,
  planLoaded = true,
  leagueId,
}: {
  teams: TeamSummary[];
  myRosterId: number;
  picks: RAPick[];
  isSuperflex: boolean;
  /** Decides which assets exist at all. Redraft has no rookie picks to trade. */
  leagueType: LeagueType;
  /** The league's FAAB budget, or null when it does not use one. */
  faabBudget: number | null;
  /** What each roster has left to spend. */
  faabByRosterId: Record<number, number>;
  /** Null in dynasty, where his redraft list has no say. */
  jingles?: JinglesBlendInfo | null;
  /** This league's season plan: stance, goal positions, keepers. */
  plan?: TradePlan | null;
  /** False when the goals could not be read, so the strip can say so. */
  planLoaded?: boolean;
  leagueId: string;
}) {
  // Only a dynasty league has future rookie picks. Offering them anywhere else
  // was the bug: a redraft trade screen let you build an offer around assets
  // that do not exist, and would have had Jack proposing one to a leaguemate.
  const tradesPicks = leagueType === "dynasty";
  const tradesFaab = faabBudget !== null && faabBudget > 0;
  const myTeam = teams.find((t) => t.rosterId === myRosterId);
  const otherTeams = useMemo(
    () =>
      teams
        .filter((t) => t.rosterId !== myRosterId)
        .sort((a, b) => a.ownerName.localeCompare(b.ownerName)),
    [teams, myRosterId],
  );

  // Default to "Anyone (auto-match)" mode.
  const [partnerId, setPartnerId] = useState<number>(ANYONE);
  const [mySel, setMySel] = useState<Set<string>>(new Set());
  const [theirSel, setTheirSel] = useState<Set<string>>(new Set());
  const [myPickIds, setMyPickIds] = useState<Set<number>>(new Set());
  const [theirPickIds, setTheirPickIds] = useState<Set<number>>(new Set());
  const [myFaab, setMyFaab] = useState<number>(0);
  const [theirFaab, setTheirFaab] = useState<number>(0);
  const [myPosFilter, setMyPosFilter] = useState<string>("all");
  const [theirPosFilter, setTheirPosFilter] = useState<string>("all");
  const [hydrated, setHydrated] = useState(false);

  // Hydrate state from sessionStorage on mount so navigating away and
  // back (e.g. clicking a player name to view their profile) preserves
  // the trade in progress.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) {
        const persisted = JSON.parse(raw) as Partial<PersistedState>;
        // Hydrating from sessionStorage on mount is the documented
        // pattern; the rule overfires for it.
        /* eslint-disable react-hooks/set-state-in-effect */
        setPartnerId(
          typeof persisted.partnerId === "number"
            ? persisted.partnerId
            : ANYONE,
        );
        setMySel(new Set(persisted.mySel ?? []));
        setTheirSel(new Set(persisted.theirSel ?? []));
        setMyPickIds(new Set(persisted.myPickIds ?? []));
        setTheirPickIds(new Set(persisted.theirPickIds ?? []));
        setMyPosFilter(persisted.myPosFilter ?? "all");
        setTheirPosFilter(persisted.theirPosFilter ?? "all");
        /* eslint-enable react-hooks/set-state-in-effect */
      }
    } catch {
      // ignore corrupted storage
    }
    setHydrated(true);
  }, []);

  // Persist on every relevant state change after hydration.
  useEffect(() => {
    if (!hydrated) return;
    try {
      const state: PersistedState = {
        partnerId,
        mySel: [...mySel],
        theirSel: [...theirSel],
        myPickIds: [...myPickIds],
        theirPickIds: [...theirPickIds],
        myPosFilter,
        theirPosFilter,
      };
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // ignore quota errors
    }
  }, [
    hydrated,
    partnerId,
    mySel,
    theirSel,
    myPickIds,
    theirPickIds,
    myPosFilter,
    theirPosFilter,
  ]);

  const picksById = useMemo(
    () => new Map(picks.map((p) => [p.id, p])),
    [picks],
  );

  const partnerTeam = teams.find((t) => t.rosterId === partnerId);

  const fits = useMemo(() => {
    if (!myTeam || !partnerTeam) return [];
    return suggestTradeFits(myTeam, partnerTeam, teams.length);
  }, [myTeam, partnerTeam, teams.length]);

  const myWeakPositions = useMemo(() => {
    if (!myTeam) return [];
    const weakest = ["QB", "RB", "WR", "TE"]
      .map((p) => ({ p, rank: myTeam.positionRanks[p] ?? 99 }))
      .sort((a, b) => b.rank - a.rank)
      .slice(0, 2)
      .map((x) => x.p);
    // Positions a plan goal asks for count as needs too.
    return [...new Set([...(plan?.focus ?? []).map((f) => f.position), ...weakest])];
  }, [myTeam, plan]);

  const bestTrades = useMemo(() => {
    if (!myTeam) return [];
    return findBestTrades(myTeam, teams, teams.length, 6, { youth: tradesPicks, plan });
  }, [myTeam, teams, tradesPicks, plan]);

  const offers = useMemo(() => {
    if (!myTeam) return [];
    return tradeOffers(myTeam, teams, teams.length, { youth: tradesPicks, plan });
  }, [myTeam, teams, tradesPicks, plan]);

  const assessment = useMemo(() => {
    if (!myTeam) return null;
    const proposal = {
      myPlayers: myTeam.players.filter((p) => mySel.has(p.id)),
      myPicks: [...myPickIds]
        .map((id) => picksById.get(id))
        .filter((p): p is RAPick => p !== undefined),
      theirPlayers:
        partnerTeam?.players.filter((p) => theirSel.has(p.id)) ?? [],
      theirPicks: [...theirPickIds]
        .map((id) => picksById.get(id))
        .filter((p): p is RAPick => p !== undefined),
    };
    return evaluateTrade(
      proposal,
      myTeam,
      partnerTeam ?? null,
      teams,
      teams.length,
      isSuperflex,
      picksById,
    );
  }, [
    myTeam,
    partnerTeam,
    teams,
    mySel,
    theirSel,
    myPickIds,
    theirPickIds,
    picksById,
    isSuperflex,
  ]);

  const myGiveValue = useMemo(() => {
    if (!myTeam) return 0;
    const playerSum = myTeam.players
      .filter((p) => mySel.has(p.id))
      .reduce((s, p) => s + p.value, 0);
    const pickSum = [...myPickIds].reduce((s, id) => {
      const pk = picksById.get(id);
      return s + (pk ? pickValue(pk, isSuperflex) : 0);
    }, 0);
    return playerSum + pickSum;
  }, [myTeam, mySel, myPickIds, picksById, isSuperflex]);

  const theirGiveValue = useMemo(() => {
    if (!partnerTeam) return 0;
    const playerSum = partnerTeam.players
      .filter((p) => theirSel.has(p.id))
      .reduce((s, p) => s + p.value, 0);
    const pickSum = [...theirPickIds].reduce((s, id) => {
      const pk = picksById.get(id);
      return s + (pk ? pickValue(pk, isSuperflex) : 0);
    }, 0);
    return playerSum + pickSum;
  }, [partnerTeam, theirSel, theirPickIds, picksById, isSuperflex]);

  const levelers = useMemo<LevelerOption[]>(() => {
    if (!myTeam || !partnerTeam || partnerId === ANYONE) return [];
    if (mySel.size + theirSel.size + myPickIds.size + theirPickIds.size === 0) {
      return [];
    }
    const delta = theirGiveValue - myGiveValue;
    return suggestLevelers({
      myTeam,
      partnerTeam,
      mySelectedIds: mySel,
      theirSelectedIds: theirSel,
      delta,
      picks,
      selectedPickIds: new Set([...myPickIds, ...theirPickIds]),
      isSuperflex,
      myWeakPositions,
    });
  }, [
    myTeam,
    partnerTeam,
    partnerId,
    mySel,
    theirSel,
    myPickIds,
    theirPickIds,
    myGiveValue,
    theirGiveValue,
    picks,
    isSuperflex,
    myWeakPositions,
  ]);

  const leagueWideMatches = useMemo(() => {
    if (
      partnerId !== ANYONE ||
      !myTeam ||
      (mySel.size === 0 && myPickIds.size === 0)
    ) {
      return [];
    }
    return findLeagueWideMatches({
      myTeam,
      mySendPlayerIds: mySel,
      mySendValue: myGiveValue,
      allTeams: teams,
      weakestPositions: myWeakPositions,
      isSuperflex,
      maxLoss: 100,
      limit: 18,
    });
  }, [
    partnerId,
    myTeam,
    mySel,
    myPickIds,
    myGiveValue,
    teams,
    myWeakPositions,
    isSuperflex,
  ]);

  if (!myTeam) {
    return (
      <p className="border-l-2 border-hh-neg py-1 pl-3 text-sm text-hh-neg">
        Could not find your roster in this league.
      </p>
    );
  }

  const delta = theirGiveValue - myGiveValue;
  const baseline = Math.max(myGiveValue, theirGiveValue);
  const pct = baseline > 0 ? Math.round((delta / baseline) * 100) : 0;
  const verdict =
    baseline === 0
      ? "-"
      : Math.abs(pct) <= 10
        ? "Even"
        : delta > 0
          ? "You win"
          : "They win";

  function toggle(set: Set<string>, setSet: (s: Set<string>) => void, id: string) {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSet(next);
  }

  function reset() {
    setMySel(new Set());
    setTheirSel(new Set());
    setMyPickIds(new Set());
    setTheirPickIds(new Set());
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }

  function changePartner(id: number) {
    setPartnerId(id);
    setTheirSel(new Set());
    setTheirPickIds(new Set());
  }

  function applyBestTrade(idea: BestTradeIdea) {
    setPartnerId(idea.partnerRosterId);
    setMySel(new Set(idea.send.map((p) => p.id)));
    setTheirSel(new Set(idea.receive.map((p) => p.id)));
    setMyPickIds(new Set());
    setTheirPickIds(new Set());
  }

  function applyMatch(match: LeagueWideMatch) {
    setPartnerId(match.partnerRosterId);
    setTheirSel(new Set(match.receivePlayers.map((p) => p.id)));
    setTheirPickIds(new Set());
  }

  // Apply a league-wide match AND tack on a leveler from my side so
  // the resulting trade is closer to even, in one click. Used by the
  // "level it out" buttons on Steal/Edge tier cards in Anyone mode.
  function applyMatchWithLeveler(
    match: LeagueWideMatch,
    leveler: LevelerOption,
  ) {
    setPartnerId(match.partnerRosterId);
    setTheirSel(new Set(match.receivePlayers.map((p) => p.id)));
    setTheirPickIds(new Set());
    if (leveler.type === "add_my_player" && leveler.player) {
      const next = new Set(mySel);
      next.add(leveler.player.id);
      setMySel(next);
    } else if (leveler.type === "add_my_pick" && leveler.pickId !== undefined) {
      const next = new Set(myPickIds);
      next.add(leveler.pickId);
      setMyPickIds(next);
    }
  }

  // Compute leveler options for a specific Anyone-mode match. The
  // trade is already in your favor by match.delta, so the levelers
  // come from your roster and your unselected picks; sized to bring
  // the delta closest to zero. Limited to player/pick adds from the
  // user side, since asking the partner to drop something in this
  // mode would defeat the purpose of the match.
  function getMatchLevelers(match: LeagueWideMatch): LevelerOption[] {
    if (!myTeam || match.delta < 100) return [];
    const partner = teams.find((t) => t.rosterId === match.partnerRosterId);
    if (!partner) return [];
    const theirSelectedForMatch = new Set(
      match.receivePlayers.map((p) => p.id),
    );
    return suggestLevelers({
      myTeam,
      partnerTeam: partner,
      mySelectedIds: mySel,
      theirSelectedIds: theirSelectedForMatch,
      delta: match.delta,
      picks,
      selectedPickIds: new Set([...myPickIds]),
      isSuperflex,
      myWeakPositions,
    })
      .filter((opt) => opt.type === "add_my_player" || opt.type === "add_my_pick")
      .slice(0, 3);
  }

  function applyLeveler(opt: LevelerOption) {
    switch (opt.type) {
      case "add_my_player":
        if (opt.player) {
          const next = new Set(mySel);
          next.add(opt.player.id);
          setMySel(next);
        }
        break;
      case "add_their_player":
        if (opt.player) {
          const next = new Set(theirSel);
          next.add(opt.player.id);
          setTheirSel(next);
        }
        break;
      case "remove_my_player":
        if (opt.player) {
          const next = new Set(mySel);
          next.delete(opt.player.id);
          setMySel(next);
        }
        break;
      case "remove_their_player":
        if (opt.player) {
          const next = new Set(theirSel);
          next.delete(opt.player.id);
          setTheirSel(next);
        }
        break;
      case "add_my_pick":
        if (opt.pickId !== undefined) {
          const next = new Set(myPickIds);
          next.add(opt.pickId);
          setMyPickIds(next);
        }
        break;
      case "add_their_pick":
        if (opt.pickId !== undefined) {
          const next = new Set(theirPickIds);
          next.add(opt.pickId);
          setTheirPickIds(next);
        }
        break;
    }
  }

  function togglePick(
    set: Set<number>,
    setSet: (s: Set<number>) => void,
    id: number,
  ) {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSet(next);
  }

  return (
    <div className="flex flex-col gap-6">
      {jingles && (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-hh-muted">
          <Chip tone="gold">Jingles in the price</Chip>
          <span>
            Every value here is half the market, half where he ranks the player on{" "}
            <a
              href={jingles.url}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-hh-accent-ink hover:underline"
            >
              {jingles.title}
            </a>{" "}
            (posted {jingles.postedAt.slice(0, 10)}). {jingles.moved.toLocaleString()} of{" "}
            {jingles.ranked.toLocaleString()} ranked players moved.
            {!jingles.matchesLeagueScoring &&
              " His list is half PPR, this league is not, so the lean is directional."}
          </span>
        </p>
      )}
      <PlanStrip plan={plan} loaded={planLoaded} leagueId={leagueId} />
      <Offers offers={offers} onApply={applyBestTrade} />
      {bestTrades.length === 0 && myTeam && (
        <p className="border-b border-hh-line py-3 text-xs text-hh-muted">
          No trade ideas across the league right now. Your rooms rank{" "}
          {POSITIONS_DISPLAY.map((pos) => `${pos} #${myTeam.positionRanks[pos] ?? "?"}`).join(", ")} of{" "}
          {teams.length}, and nothing on another roster both lifts one of them and works for the other side.
          Pick a partner or a player below to price a deal by hand.
        </p>
      )}
      {bestTrades.length > 0 && (
        <Disclosure summary={`More trade ideas (${bestTrades.length})`}>
          <p className="text-xs text-hh-muted">
            Player-for-player swaps that fill your weakest positions and the
            ones your goals name, from each opponent&apos;s surplus, scored by
            positional gain, value parity and your plan. Tap Apply to load
            into the builder.
          </p>
          <ul className="mt-2 grid gap-x-8 md:grid-cols-2">
            {bestTrades.map((idea) => (
              <li
                key={`${idea.partnerRosterId}-${packageKey(idea.send)}-${packageKey(idea.receive)}`}
                className="flex flex-col gap-3 border-b border-hh-line py-4"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-sm font-semibold text-hh-ink">
                    vs. {idea.partnerName}
                  </span>
                  <div className="flex items-center gap-1.5">
                    {idea.kind === "youth_arbitrage" && (
                      <Chip tone="pos">Get younger</Chip>
                    )}
                    <Chip tone="gold">
                      {idea.positionalGain.position} <Num>#{idea.positionalGain.from}</Num> → <Num>#{idea.positionalGain.to}</Num>
                    </Chip>
                  </div>
                </div>
                <div className="flex items-stretch gap-3 text-sm">
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="hh-label">
                      Send
                    </span>
                    {idea.send.map((p) => (
                      <div
                        key={p.id}
                        className="flex items-center justify-between gap-1"
                      >
                        <PlayerLink
                          id={p.id}
                          name={p.name}
                          className="truncate text-xs"
                        />
                        <Num className="text-xs text-hh-muted">
                          {p.value.toLocaleString()}
                        </Num>
                      </div>
                    ))}
                  </div>
                  <span aria-hidden className="self-center text-hh-muted">↔</span>
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="hh-label !text-hh-pos">
                      Receive
                    </span>
                    {idea.receive.map((p) => (
                      <div
                        key={p.id}
                        className="flex items-center justify-between gap-1"
                      >
                        <PlayerLink
                          id={p.id}
                          name={p.name}
                          className="truncate text-xs font-medium"
                        />
                        <Num className="text-xs font-semibold text-hh-ink">
                          {p.value.toLocaleString()}
                        </Num>
                      </div>
                    ))}
                  </div>
                </div>
                <p className="text-xs text-hh-muted">
                  {partnerSummary(idea.partner)}
                </p>
                <ul className="flex flex-col gap-0.5">
                  {idea.reasoning.map((r) => (
                    <li
                      key={r}
                      className="text-xs text-hh-ink-2"
                    >
                      • {r}
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  onClick={() => applyBestTrade(idea)}
                  className={`self-start ${BTN_PRIMARY}`}
                >
                  Apply
                </button>
              </li>
            ))}
          </ul>
        </Disclosure>
      )}

      <div className="flex flex-col gap-2">
        <label
          htmlFor="partner"
          className="hh-label"
        >
          Trade with
        </label>
        <select
          id="partner"
          className="h-11 w-full rounded-[6px] border border-hh-line bg-hh-panel px-3 text-[16px] font-medium text-hh-ink focus:border-hh-accent focus:outline-none sm:text-sm"
          value={partnerId}
          onChange={(e) => changePartner(Number(e.target.value))}
        >
          <option value={ANYONE}>Anyone (auto-match across the league)</option>
          {otherTeams.map((t) => (
            <option key={t.rosterId} value={t.rosterId}>
              {t.ownerName}
            </option>
          ))}
        </select>
      </div>

      {partnerTeam && (
        <Section label="Position rankings">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-hh-line">
                  <th className="hh-label px-2 py-2 text-left">
                    Team
                  </th>
                  {POSITIONS_DISPLAY.map((p) => (
                    <th
                      key={p}
                      className="hh-label px-2 py-2 text-center"
                    >
                      {p}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-hh-line">
                  <td className="px-2 py-2 text-left font-medium">You</td>
                  {POSITIONS_DISPLAY.map((p) => (
                    <td key={p} className="px-2 py-2 text-center">
                      <Num className={rankClass(myTeam.positionRanks[p], teams.length)}>
                        {myTeam.positionRanks[p]}
                      </Num>
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="px-2 py-2 text-left font-medium">
                    {partnerTeam.ownerName}
                  </td>
                  {POSITIONS_DISPLAY.map((p) => (
                    <td key={p} className="px-2 py-2 text-center">
                      <Num className={rankClass(partnerTeam.positionRanks[p], teams.length)}>
                        {partnerTeam.positionRanks[p]}
                      </Num>
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-hh-muted">
            1 = strongest of {teams.length}. Green = top 3, red = bottom 3.
          </p>
        </Section>
      )}

      {fits.length > 0 && (
        <Section label="Trade fits">
          <div className="grid gap-x-8 md:grid-cols-2">
            {fits.map((fit) => (
              <div
                key={`${fit.position}-${fit.side}`}
                className="flex flex-col gap-2 border-b border-hh-line py-3"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-sm font-semibold text-hh-ink">
                    {fit.side === "send"
                      ? `Send a ${fit.position}`
                      : `Target their ${fit.position}`}
                  </span>
                  <span className="text-xs text-hh-muted">
                    you <Num>#{fit.yourRank}</Num> · them <Num>#{fit.theirRank}</Num>
                  </span>
                </div>
                <p className="text-xs text-hh-ink-2">
                  {fit.side === "send"
                    ? `You have surplus ${fit.position}; they're weak there. Consider offering one of these:`
                    : `They have surplus ${fit.position}; you're weak there. Consider asking for one of these:`}
                </p>
                <ul className="flex flex-col gap-1.5">
                  {fit.suggested.map((p) => (
                    <li
                      key={p.id}
                      className="flex items-center gap-2 text-sm"
                    >
                      <PlayerLink
                        id={p.id}
                        name={p.name}
                        className="truncate flex-1"
                      />
                      <Num className="text-xs text-hh-muted">
                        {p.value > 0 ? p.value.toLocaleString() : "-"}
                      </Num>
                      <button
                        type="button"
                        onClick={() => {
                          if (fit.side === "send") {
                            const next = new Set(mySel);
                            next.add(p.id);
                            setMySel(next);
                          } else {
                            const next = new Set(theirSel);
                            next.add(p.id);
                            setTheirSel(next);
                          }
                        }}
                        className={BTN_PRIMARY}
                      >
                        Add
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Section>
      )}

      {(() => {
        // What I receive = what they give. What they receive = what I give.
        const myReceiveItems: RecapItem[] = [];
        const theirReceiveItems: RecapItem[] = [];

        if (partnerTeam) {
          for (const p of partnerTeam.players.filter((p) => theirSel.has(p.id))) {
            myReceiveItems.push({
              key: `p-${p.id}`,
              position: p.position,
              label: p.name,
              value: p.value,
              playerId: p.id,
            });
          }
        }
        for (const id of theirPickIds) {
          const pk = picksById.get(id);
          if (!pk) continue;
          myReceiveItems.push({
            key: `pk-${pk.id}`,
            position: "PK",
            label: pk.label,
            value: isSuperflex ? pk.valueSf : pk.value1qb,
          });
        }
        if (myTeam) {
          for (const p of myTeam.players.filter((p) => mySel.has(p.id))) {
            theirReceiveItems.push({
              key: `p-${p.id}`,
              position: p.position,
              label: p.name,
              value: p.value,
              playerId: p.id,
            });
          }
        }
        for (const id of myPickIds) {
          const pk = picksById.get(id);
          if (!pk) continue;
          theirReceiveItems.push({
            key: `pk-${pk.id}`,
            position: "PK",
            label: pk.label,
            value: isSuperflex ? pk.valueSf : pk.value1qb,
          });
        }

        const myReceiveTotal = theirGiveValue;
        const theirReceiveTotal = myGiveValue;
        const meWins = myReceiveTotal > theirReceiveTotal;
        const theyWin = theirReceiveTotal > myReceiveTotal;
        const myOutcome: "win" | "lose" | "even" = meWins
          ? "win"
          : theyWin
            ? "lose"
            : "even";
        const theirOutcome: "win" | "lose" | "even" = theyWin
          ? "win"
          : meWins
            ? "lose"
            : "even";

        return (
          <div className="sticky top-14 z-10 -mx-4 border-y-[1.5px] border-hh-ink bg-hh-bg/95 px-4 py-4 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-3">
                <h3 className="hh-label">
                  Trade summary
                </h3>
                <div className="flex items-center gap-2">
                  {assessment && (
                    <Chip tone={verdictTone(assessment.verdict)}>
                      {verdictLabel(assessment.verdict)}
                    </Chip>
                  )}
                  {(mySel.size > 0 ||
                    theirSel.size > 0 ||
                    myPickIds.size > 0 ||
                    theirPickIds.size > 0) && (
                    <button
                      type="button"
                      onClick={reset}
                      className={BTN_SECONDARY}
                    >
                      Clear
                    </button>
                  )}
                </div>
              </div>
              {/* Stacked on phones: side by side, each column is ~150px and long names cut off. */}
              <div className="grid gap-4 min-[400px]:grid-cols-2 sm:gap-6">
                <RecapColumn
                  name={myTeam?.ownerName ?? "You"}
                  items={myReceiveItems}
                  total={myReceiveTotal}
                  outcome={myOutcome}
                />
                <RecapColumn
                  name={partnerTeam?.ownerName ?? "Partner"}
                  items={theirReceiveItems}
                  total={theirReceiveTotal}
                  outcome={theirOutcome}
                />
              </div>
              {baseline > 0 && (
                <div className="text-xs text-hh-muted">
                  {verdict}
                  {delta !== 0 ? (
                    <>
                      {" · "}
                      <Num>{`${delta > 0 ? "+" : ""}${delta.toLocaleString()} (${pct > 0 ? "+" : ""}${pct}%)`}</Num>
                    </>
                  ) : null}
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {assessment && (
        <Section label="Verdict" className="gap-3">
          <div className="flex flex-col gap-1">
            <h3 className="text-[15px] font-semibold text-hh-ink">
              Verdict: {verdictLabel(assessment.verdict)}
            </h3>
            <ul className="flex flex-col gap-0.5">
              {assessment.reasoning.map((r, i) => (
                <li
                  key={i}
                  className="text-xs text-hh-ink-2"
                >
                  • {r}
                </li>
              ))}
            </ul>
          </div>

          {partnerTeam &&
            partnerId !== ANYONE &&
            Math.abs(delta) >= 100 &&
            levelers.length > 0 && (
              <details className="group mt-3 flex flex-col gap-2 border-y border-hh-line py-2">
                <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <ChevronDown
                      size={14}
                      aria-hidden
                      className="shrink-0 -rotate-90 text-hh-accent-ink transition-transform group-open:rotate-0"
                    />
                    <span className="text-sm font-semibold text-hh-ink">
                      Level out this trade
                    </span>
                  </div>
                  <span className="text-[11px] font-medium text-hh-accent-ink">
                    {delta > 0
                      ? `You're up ${delta.toLocaleString()}; add to your side`
                      : `You're down ${Math.abs(delta).toLocaleString()}; ask for more`}
                  </span>
                </summary>
                <p className="text-xs text-hh-ink-2">
                  Each option below shows the resulting value gap if applied.
                  Smaller gaps mean a more balanced trade.
                </p>
                <ul className="flex flex-col gap-1.5">
                  {levelers.map((opt, i) => {
                    const isAdd = opt.type.startsWith("add_");
                    const isMine =
                      opt.type === "add_my_player" ||
                      opt.type === "add_my_pick" ||
                      opt.type === "remove_my_player";
                    const sideLabel = isMine ? "your side" : "their side";
                    const action = isAdd ? "Add" : "Remove";
                    return (
                      <li
                        key={`${opt.type}-${opt.player?.id ?? opt.pickId ?? i}`}
                        className="flex items-center gap-2 border-b border-hh-line py-2 last:border-b-0"
                      >
                        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <span className="flex items-center gap-1.5 text-sm font-medium text-hh-ink">
                            <PosBadge pos={opt.player ? opt.player.position : "PK"} />
                            <span className="truncate">{opt.description}</span>
                          </span>
                          <span className="text-[11px] text-hh-muted">
                            <Num>{opt.closesGapBy.toLocaleString()}</Num> value on{" "}
                            {sideLabel} · resulting gap{" "}
                            <Num
                              tone={Math.abs(opt.resultingDelta) <= 100 ? "pos" : undefined}
                              className={Math.abs(opt.resultingDelta) <= 100 ? "font-semibold" : ""}
                            >
                              {opt.resultingDelta > 0 ? "+" : ""}
                              {opt.resultingDelta.toLocaleString()}
                            </Num>
                          </span>
                        </span>
                        <button
                          type="button"
                          onClick={() => applyLeveler(opt)}
                          className={BTN_PRIMARY}
                        >
                          {action}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </details>
            )}

          {assessment.counters.length > 0 && (
            <div className="flex flex-col gap-2">
              <span className="hh-label mt-3">
                Suggested counters
              </span>
              <ul className="flex flex-col">
                {assessment.counters.map((c, i) => (
                  <li
                    key={i}
                    className="flex items-center gap-2 border-b border-hh-line py-2 last:border-b-0"
                  >
                    <span className="flex-1 text-xs text-hh-ink-2">
                      {c.description}
                    </span>
                    {c.pickIdToAdd && (
                      <button
                        type="button"
                        onClick={() => {
                          const next = new Set(theirPickIds);
                          next.add(c.pickIdToAdd!);
                          setTheirPickIds(next);
                        }}
                        className={BTN_PRIMARY}
                      >
                        Add
                      </button>
                    )}
                    {c.playerToAdd && (
                      <button
                        type="button"
                        onClick={() => {
                          const next = new Set(theirSel);
                          next.add(c.playerToAdd!.id);
                          setTheirSel(next);
                        }}
                        className={BTN_PRIMARY}
                      >
                        Add
                      </button>
                    )}
                    {c.playerToRemove && (
                      <button
                        type="button"
                        onClick={() => {
                          const next = new Set(mySel);
                          next.delete(c.playerToRemove!.id);
                          setMySel(next);
                        }}
                        className={BTN_SECONDARY}
                      >
                        Remove
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Section>
      )}

      <div className="grid gap-x-8 gap-y-6 lg:grid-cols-2">
        <Section label={<>You give (<Num>{mySel.size + myPickIds.size}</Num>)</>}>
          <div className="flex flex-col gap-3">
          {tradesPicks && (
            <PicksPanel
              picks={picks}
              picksById={picksById}
              selected={myPickIds}
              onToggle={(id) => togglePick(myPickIds, setMyPickIds, id)}
              isSuperflex={isSuperflex}
            />
          )}
          {tradesFaab && (
            <FaabPanel
              label="FAAB you send"
              amount={myFaab}
              setAmount={setMyFaab}
              available={faabByRosterId[myRosterId] ?? 0}
              budget={faabBudget!}
            />
          )}
          <PositionFilter
            filter={myPosFilter}
            setFilter={setMyPosFilter}
            players={myTeam.players}
          />
          <ul className="flex flex-col divide-y divide-hh-line border-y border-hh-line">
            {myTeam.players
              .filter(
                (p) => myPosFilter === "all" || p.position === myPosFilter,
              )
              .map((p) => (
                <li key={p.id}>
                  <PlayerRowItem
                    p={p}
                    checked={mySel.has(p.id)}
                    onChange={() => toggle(mySel, setMySel, p.id)}
                  />
                </li>
              ))}
          </ul>
          </div>
        </Section>

        {partnerTeam && (
          <Section label={<>You get (<Num>{theirSel.size + theirPickIds.size}</Num>)</>}>
            <div className="flex flex-col gap-3">
            {tradesPicks && (
              <PicksPanel
                picks={picks}
                picksById={picksById}
                selected={theirPickIds}
                onToggle={(id) => togglePick(theirPickIds, setTheirPickIds, id)}
                isSuperflex={isSuperflex}
              />
            )}
            {tradesFaab && (
              <FaabPanel
                label="FAAB you get"
                amount={theirFaab}
                setAmount={setTheirFaab}
                available={faabByRosterId[partnerTeam.rosterId] ?? 0}
                budget={faabBudget!}
              />
            )}
            <PositionFilter
              filter={theirPosFilter}
              setFilter={setTheirPosFilter}
              players={partnerTeam.players}
            />
            <ul className="flex flex-col divide-y divide-hh-line border-y border-hh-line">
              {partnerTeam.players
                .filter(
                  (p) =>
                    theirPosFilter === "all" || p.position === theirPosFilter,
                )
                .map((p) => (
                  <li key={p.id}>
                    <PlayerRowItem
                      p={p}
                      checked={theirSel.has(p.id)}
                      onChange={() => toggle(theirSel, setTheirSel, p.id)}
                    />
                  </li>
                ))}
            </ul>
            </div>
          </Section>
        )}

        {partnerId === ANYONE && (
          <Section label="You get: auto-matches across the league">
            <div className="flex flex-col gap-3">
            {mySel.size === 0 && myPickIds.size === 0 ? (
              <Empty>
                Pick players or picks on the left to see league-wide trade
                options.
              </Empty>
            ) : leagueWideMatches.length === 0 ? (
              <Empty>
                No competitive matches found at this value (
                <Num>{myGiveValue.toLocaleString()}</Num>). Try a different combo.
              </Empty>
            ) : (
              (() => {
                const tiers: Record<LeagueWideMatchTier, LeagueWideMatch[]> = {
                  steal: [],
                  edge: [],
                  fair: [],
                };
                for (const m of leagueWideMatches) {
                  tiers[tierForMatch(m)].push(m);
                }
                const tierMeta: Array<{
                  key: LeagueWideMatchTier;
                  label: string;
                  caption: string;
                  tone: Tone;
                }> = [
                  {
                    key: "steal",
                    label: "Steals",
                    caption: "+1,000 to +2,000 value",
                    tone: "pos",
                  },
                  {
                    key: "edge",
                    label: "Edge",
                    caption: "+500 to +999 value",
                    tone: "gold",
                  },
                  {
                    key: "fair",
                    label: "Fair value",
                    caption: "Roughly even",
                    tone: "muted",
                  },
                ];

                return tierMeta.map((meta) => {
                  const list = tiers[meta.key];
                  if (list.length === 0) return null;
                  return (
                    <details
                      key={meta.key}
                      className="group flex flex-col gap-2"
                      open
                    >
                      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 border-b border-hh-line py-1 hover:text-hh-accent-ink">
                        <ChevronDown
                          size={14}
                          aria-hidden
                          className="shrink-0 -rotate-90 text-hh-muted transition-transform group-open:rotate-0"
                        />
                        <Chip tone={meta.tone}>{meta.label}</Chip>
                        <span className="text-[11px] text-hh-muted">
                          {meta.caption} · <Num>{list.length}</Num> match
                          {list.length === 1 ? "" : "es"}
                        </span>
                      </summary>
                      <ul className="flex flex-col">
                        {list.map((m) => (
                          <li
                            key={`${m.partnerRosterId}-${packageKey(m.receivePlayers)}`}
                            className="flex flex-col gap-2 border-b border-hh-line py-3"
                          >
                            <div className="flex items-baseline justify-between gap-2">
                              <span className="text-sm font-semibold text-hh-ink">
                                vs. {m.partnerName}
                              </span>
                              {m.isFit && <Chip tone="accent">Fit</Chip>}
                            </div>
                            <p className="text-xs text-hh-muted">
                              {partnerSummary(m.partner)}
                            </p>
                            {m.receivePlayers.map((p) => (
                              <div
                                key={p.id}
                                className="flex items-center gap-2"
                              >
                                <PlayerAvatar
                                  name={p.name}
                                  position={p.position}
                                  photoUrl={p.photoUrl}
                                  size="sm"
                                />
                                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                                  <PlayerLink
                                    id={p.id}
                                    name={p.name}
                                    className="truncate text-sm font-semibold"
                                  />
                                  <span className="text-xs text-hh-muted">
                                    <TeamCode team={p.team} />
                                    {p.position ? ` · ${p.position}` : ""}
                                  </span>
                                </div>
                                <Num className="shrink-0 text-sm font-semibold text-hh-ink">
                                  {p.value.toLocaleString()}
                                </Num>
                              </div>
                            ))}
                            <div className="flex items-center justify-between gap-2 pt-1">
                              <span
                                className={`text-xs font-semibold ${
                                  m.delta >= 100
                                    ? "text-hh-pos"
                                    : m.delta >= -100
                                      ? "text-hh-muted"
                                      : "text-hh-neg"
                                }`}
                              >
                                <Num>
                                  {m.delta > 0 ? "+" : ""}
                                  {m.delta.toLocaleString()}
                                </Num>{" "}
                                value
                                {Math.abs(m.delta) <= 100 ? " (even)" : ""}
                              </span>
                              <button
                                type="button"
                                onClick={() => applyMatch(m)}
                                className={BTN_PRIMARY}
                              >
                                Apply
                              </button>
                            </div>
                            {m.reasoning.length > 0 && (
                              <ul className="flex flex-col gap-0.5 pt-1 text-[11px] text-hh-muted">
                                {m.reasoning.map((r) => (
                                  <li key={r}>• {r}</li>
                                ))}
                              </ul>
                            )}
                            {(meta.key === "steal" || meta.key === "edge") &&
                              (() => {
                                const levelers = getMatchLevelers(m);
                                if (levelers.length === 0) return null;
                                return (
                                  <details className="group flex flex-col gap-1.5 border-l-2 border-hh-accent pl-3">
                                    <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center justify-between gap-2">
                                      <span className="flex items-center gap-1.5 text-xs font-semibold text-hh-accent-ink">
                                        <ChevronDown
                                          size={13}
                                          aria-hidden
                                          className="shrink-0 -rotate-90 transition-transform group-open:rotate-0"
                                        />
                                        Level it out
                                      </span>
                                      <span className="text-[11px] text-hh-muted">
                                        add to your side to keep partner honest
                                      </span>
                                    </summary>
                                    <ul className="flex flex-col gap-1 pt-0.5">
                                      {levelers.map((opt, oi) => {
                                        const label =
                                          opt.type === "add_my_player"
                                            ? opt.player?.name
                                            : opt.pickLabel;
                                        const v =
                                          opt.type === "add_my_player"
                                            ? opt.player?.value
                                            : opt.pickValue;
                                        return (
                                          <li
                                            key={`${opt.type}-${opt.player?.id ?? opt.pickId ?? oi}`}
                                            className="flex items-center gap-2 border-b border-hh-line py-1.5 last:border-b-0"
                                          >
                                            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                                              <span className="truncate text-xs font-medium text-hh-ink">
                                                + {label}{" "}
                                                <span className="font-normal text-hh-muted">
                                                  (<Num>{(v ?? 0).toLocaleString()}</Num>)
                                                </span>
                                              </span>
                                              <span className="text-[11px] text-hh-muted">
                                                gap{" "}
                                                <Num
                                                  tone={Math.abs(opt.resultingDelta) <= 100 ? "pos" : undefined}
                                                  className={Math.abs(opt.resultingDelta) <= 100 ? "font-semibold" : ""}
                                                >
                                                  {opt.resultingDelta > 0 ? "+" : ""}
                                                  {opt.resultingDelta.toLocaleString()}
                                                </Num>
                                              </span>
                                            </span>
                                            <button
                                              type="button"
                                              onClick={() =>
                                                applyMatchWithLeveler(m, opt)
                                              }
                                              className={BTN_PRIMARY}
                                            >
                                              Add & apply
                                            </button>
                                          </li>
                                        );
                                      })}
                                    </ul>
                                  </details>
                                );
                              })()}
                          </li>
                        ))}
                      </ul>
                    </details>
                  );
                });
              })()
            )}
            <p className="text-[11px] text-hh-muted">
              Tiered by value advantage. Losing trades are omitted. Matches
              filter out trades that would create same-team duplicates on
              your roster (per your rule).
            </p>
            </div>
          </Section>
        )}
      </div>
    </div>
  );
}

function PicksPanel({
  picks,
  picksById,
  selected,
  onToggle,
  isSuperflex,
}: {
  picks: RAPick[];
  picksById: Map<number, RAPick>;
  selected: Set<number>;
  onToggle: (id: number) => void;
  isSuperflex: boolean;
}) {
  const selectedPicks = [...selected]
    .map((id) => picksById.get(id))
    .filter((p): p is RAPick => p !== undefined)
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const total = selectedPicks.reduce(
    (s, p) => s + (isSuperflex ? p.valueSf : p.value1qb),
    0,
  );

  return (
    <div className="flex flex-col gap-2 border-b border-hh-line pb-3">
      <div className="flex items-center justify-between gap-2">
        <span className="hh-label">
          Picks
        </span>
        <select
          aria-label="Add pick"
          className="h-11 rounded-[6px] border border-hh-line bg-hh-panel px-2 text-[16px] font-medium text-hh-ink focus:border-hh-accent focus:outline-none sm:h-8 sm:text-xs"
          value=""
          onChange={(e) => {
            const id = Number(e.target.value);
            if (id) onToggle(id);
            e.target.value = "";
          }}
        >
          <option value="">+ Add pick</option>
          {picks
            .filter((p) => !selected.has(p.id))
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.label} (
                {(isSuperflex ? p.valueSf : p.value1qb).toLocaleString()})
              </option>
            ))}
        </select>
      </div>
      {selectedPicks.length === 0 ? (
        <p className="text-xs text-hh-muted">
          No picks selected.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-hh-line">
          {selectedPicks.map((p) => (
            <li
              key={p.id}
              className="flex items-center gap-2 py-1.5"
            >
              <PosBadge pos="PK" />
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-hh-ink">
                {p.label}
              </span>
              <Num className="shrink-0 text-sm font-semibold text-hh-ink">
                {(isSuperflex ? p.valueSf : p.value1qb).toLocaleString()}
              </Num>
              <button
                type="button"
                onClick={() => onToggle(p.id)}
                className="inline-flex size-11 shrink-0 items-center justify-center rounded-[6px] text-hh-muted hover:bg-hh-sunk hover:text-hh-neg focus:outline-none focus-visible:ring-2 focus-visible:ring-hh-accent sm:size-8"
                aria-label="Remove pick"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      {selectedPicks.length > 0 && (
        <div className="flex items-center justify-between border-t border-hh-line pt-2 text-xs">
          <span className="hh-label">
            Total picks value
          </span>
          <Num tone="accent" className="font-semibold">
            {total.toLocaleString()}
          </Num>
        </div>
      )}
    </div>
  );
}

/**
 * FAAB, as a tradeable asset.
 *
 * Every one of Jack's leagues has a waiver budget and none of them could put it
 * in a trade, which is the other half of the redraft problem: the screen offered
 * the one asset that does not exist and hid the one that does.
 *
 * It deliberately does NOT fold the dollars into the value totals. There is no
 * defensible rate for converting FAAB into player value: what a budget is worth
 * depends on who hits waivers this season, which nobody knows in August. A made
 * up conversion would look precise and be fiction, which is exactly the failure
 * this app is built to avoid. So the money is tracked, shown next to the player
 * value, and left for Jack to weigh.
 */
function FaabPanel({
  label,
  amount,
  setAmount,
  available,
  budget,
}: {
  label: string;
  amount: number;
  setAmount: (n: number) => void;
  available: number;
  budget: number;
}) {
  const tooMuch = amount > available;
  return (
    <div className="flex flex-col gap-2 border-b border-hh-line pb-3">
      <div className="flex items-center justify-between gap-2">
        <span className="hh-label">
          {label}
        </span>
        <span className="text-xs text-hh-muted">
          <Num>${available}</Num> of <Num>${budget}</Num> left
        </span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-sm text-hh-muted">$</span>
        <input
          type="number"
          min={0}
          max={available}
          step={1}
          value={amount === 0 ? "" : amount}
          placeholder="0"
          onChange={(e) => setAmount(Math.max(0, Number(e.target.value) || 0))}
          aria-label={label}
          className="hh-num h-11 w-24 rounded-[6px] border border-hh-line bg-hh-panel px-2 text-[16px] text-hh-ink focus:border-hh-accent focus:outline-none sm:h-8 sm:text-sm"
        />
        {amount > 0 && (
          <span className="text-xs text-hh-muted">
            <Num>{Math.round((amount / budget) * 100)}%</Num> of the budget
          </span>
        )}
      </div>
      {tooMuch && (
        <p className="text-xs font-medium text-hh-neg">
          That is more than the ${available} they have left.
        </p>
      )}
      {amount > 0 && !tooMuch && (
        <p className="text-[11px] leading-snug text-hh-muted">
          Not counted in the value totals. What a budget is worth depends on who
          hits waivers this season, and a made up rate would look precise and be
          fiction.
        </p>
      )}
    </div>
  );
}
