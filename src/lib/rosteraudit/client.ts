import "server-only";
import { cached, invalidate } from "@/lib/redis/cached";
import type { SleeperLeague } from "@/lib/sleeper/types";
import type {
  PickSlot,
  RAFormatKey,
  RAGradesByRosterId,
  RAManagerHistory,
  RAManagerSeasonRow,
  RAManagerSummary,
  RAPick,
  RAPlayerProfile,
  RAPlayerStats,
  RATeamGrade,
  RAValue,
  RAValuesBySleeperId,
  RAWeeklyStat,
} from "./types";

const RA_BASE = "https://rosteraudit.com/wp-json/ra/v1";
const TTL = 6 * 60 * 60;

// Sentinel value the API returns when trend data is unavailable
// (looks like int16 max — should be treated as 0).
const TREND_SENTINEL = 32767;

type RawPlayer = {
  sleeper_id?: string;
  name?: string;
  position?: string;
  team?: string | null;
  age?: string | number | null;
  tier?: string | number | null;
  value?: number;
  rank_overall?: number;
  rank_pos?: number;
  trend_7d?: string | number | null;
  trend_30d?: string | number | null;
  buy_low?: string | number | null;
  sell_high?: string | number | null;
  breakout?: string | number | null;
  photo_url?: string | null;
};

type RankingsResponse = {
  players?: RawPlayer[];
  total?: number;
  page?: number;
  per_page?: number;
  total_pages?: number;
  attribution?: string;
  attribution_url?: string;
};

function key(formatKey: RAFormatKey): string {
  return `rosteraudit:v1:rankings:${formatKey}`;
}

function num(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function trendNum(v: unknown): number {
  const n = num(v);
  return Math.abs(n) >= TREND_SENTINEL ? 0 : n;
}

function flag(v: unknown): boolean {
  return num(v) > 0;
}

function slim(rows: RawPlayer[]): RAValuesBySleeperId {
  const out: RAValuesBySleeperId = {};
  for (const r of rows) {
    if (!r.sleeper_id || !r.name || !r.position) continue;
    out[r.sleeper_id] = {
      sleeperId: r.sleeper_id,
      name: r.name,
      position: r.position,
      team: typeof r.team === "string" ? r.team : null,
      age: r.age != null ? num(r.age) : null,
      tier: r.tier != null ? num(r.tier) : null,
      value: num(r.value),
      overallRank: num(r.rank_overall),
      positionRank: num(r.rank_pos),
      trend7Day: trendNum(r.trend_7d),
      trend30Day: trendNum(r.trend_30d),
      buyLow: flag(r.buy_low),
      sellHigh: flag(r.sell_high),
      breakout: flag(r.breakout),
      photoUrl: typeof r.photo_url === "string" ? r.photo_url : null,
    };
  }
  return out;
}

async function raFetch<T>(path: string): Promise<T> {
  const apiKey = process.env.ROSTERAUDIT_API_KEY;
  const headers = new Headers();
  if (apiKey) headers.set("X-RA-Key", apiKey);
  const res = await fetch(`${RA_BASE}${path}`, {
    headers,
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(
      `RosterAudit request failed: ${res.status} ${res.statusText} (${path})`,
    );
  }
  return (await res.json()) as T;
}

// Fetch all rankings (~500 players) for a given format. Cached 6h in Upstash.
export function getValues(
  formatKey: RAFormatKey,
): Promise<RAValuesBySleeperId> {
  return cached(key(formatKey), TTL, async () => {
    const all: RawPlayer[] = [];
    let page = 1;
    let totalPages = 1;
    do {
      const params = new URLSearchParams({
        format_key: formatKey,
        position: "all",
        per_page: "100",
        page: String(page),
      });
      const res = await raFetch<RankingsResponse>(
        `/rankings?${params.toString()}`,
      );
      const rows = res.players ?? [];
      all.push(...rows);
      totalPages = res.total_pages ?? 1;
      page += 1;
      if (page > 10) break; // safety stop
    } while (page <= totalPages);
    return slim(all);
  });
}

export async function revalidateValues(formatKey: RAFormatKey): Promise<void> {
  await invalidate(key(formatKey));
}

// RA's public API silently ignores the _tep variant of format_key —
// values come back identical to plain sf_ppr. Apply the TE-premium
// boost on top of whatever RA returned, scaled to the actual league
// bonus_rec_te value (0.25 → +7.5%, 0.5 → +15%, 1.0 → +30%).
//
// The boost only touches the TE pool. Picks, QB/RB/WR, ranks, ages,
// and trend flags pass through unchanged. Overall rank and positional
// rank are intentionally NOT recomputed here because callers usually
// re-derive them from the boosted values via computeTeamSummaries.
export function applyTepBoost(
  values: RAValuesBySleeperId,
  bonusRecTe: number,
): RAValuesBySleeperId {
  if (!bonusRecTe || bonusRecTe <= 0) return values;
  const factor = 1 + Math.min(0.40, bonusRecTe * 0.30);
  const out: RAValuesBySleeperId = {};
  for (const [id, v] of Object.entries(values)) {
    if (v.position === "TE" && v.value > 0) {
      out[id] = { ...v, value: Math.round(v.value * factor) };
    } else {
      out[id] = v;
    }
  }
  return out;
}

// One-call wrapper: derives the RA format key from the league, fetches
// values, and applies the TE-premium boost so all downstream consumers
// (power rankings, trade analyzer, draft helper, scout pages, plan)
// see TE-premium-correct values without each having to remember.
export async function getValuesForLeague(
  league: SleeperLeague,
): Promise<RAValuesBySleeperId> {
  const formatKey = formatKeyFromLeague(league);
  const bonus = league.scoring_settings?.bonus_rec_te ?? 0;
  const raw = await getValues(formatKey);
  return applyTepBoost(raw, bonus);
}

// Derive the RosterAudit format_key from a Sleeper league.
export function formatKeyFromLeague(league: SleeperLeague): RAFormatKey {
  const positions = league.roster_positions ?? [];
  const qbCount = positions.filter((p) => p === "QB").length;
  const isSuperflex = positions.includes("SUPER_FLEX") || qbCount >= 2;
  const tep = (league.scoring_settings?.bonus_rec_te ?? 0) > 0;
  const rec = league.scoring_settings?.rec ?? 1;
  const halfPpr = rec > 0 && rec < 1;

  if (isSuperflex) {
    if (tep) return "sf_ppr_tep";
    return halfPpr ? "sf_half" : "sf_ppr";
  }
  if (tep) return "1qb_ppr_tep";
  return halfPpr ? "1qb_half" : "1qb_ppr";
}

// --- Picks ---

const PICKS_KEY = "rosteraudit:v2:picks";
const PICKS_TTL = 24 * 60 * 60;

// Earliest pick season that should be tradeable. Rookie drafts wrap
// up by early May, so once we're past May 1 the current year's picks
// are considered spent and only future seasons can be traded.
function minPickSeason(): number {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1; // 1-12
  return month >= 5 ? year + 1 : year;
}

type RawPick = {
  id?: number;
  pick_season?: number;
  pick_round?: number;
  pick_slot?: string;
  val_sf?: number;
  val_1qb?: number;
  label?: string;
  sort_order?: number;
};

type PicksResponse = { picks?: RawPick[] };

function slimPicks(rows: RawPick[]): RAPick[] {
  const out: RAPick[] = [];
  for (const r of rows) {
    if (
      typeof r.id !== "number" ||
      typeof r.pick_season !== "number" ||
      typeof r.pick_round !== "number" ||
      !r.pick_slot ||
      !r.label
    ) {
      continue;
    }
    out.push({
      id: r.id,
      season: r.pick_season,
      round: r.pick_round,
      slot: r.pick_slot as PickSlot,
      valueSf: num(r.val_sf),
      value1qb: num(r.val_1qb),
      label: r.label,
      sortOrder: num(r.sort_order),
    });
  }
  out.sort((a, b) => a.sortOrder - b.sortOrder);
  return out;
}

const ALL_PICKS_KEY = "rosteraudit:v3:picks-all";

// Underlying fetch: every pick in RA's rolling 4-year window,
// unfiltered. Cached once and shared by both the trade builder
// (which then filters to future seasons) and the draft board (which
// needs the just-completed season's pick values to compute team
// grades).
export function getAllPicks(): Promise<RAPick[]> {
  return cached(ALL_PICKS_KEY, PICKS_TTL, async () => {
    const res = await raFetch<PicksResponse>("/picks");
    return slimPicks(res.picks ?? []);
  });
}

// Tradeable picks: only seasons whose draft hasn't completed yet.
// The trade page calls this; draft pages must call getAllPicks so
// they can still value picks from the just-finished draft.
export async function getPicks(): Promise<RAPick[]> {
  const all = await getAllPicks();
  const min = minPickSeason();
  return all.filter((p) => p.season >= min);
}

export async function revalidatePicks(): Promise<void> {
  await invalidate(ALL_PICKS_KEY, PICKS_KEY);
}

export async function revalidateGrades(
  leagueId: string,
  userIds: string[],
): Promise<void> {
  if (userIds.length === 0) return;
  await invalidate(...userIds.map((u) => GRADES_KEY(leagueId, u)));
}

// --- Roster grades ---

const GRADES_KEY = (leagueId: string, userId: string) =>
  `rosteraudit:v1:grades:${leagueId}:${userId}`;
const GRADES_TTL = 60 * 60;

type RawPositional = {
  value?: number;
  count?: number;
  avg_age?: number;
};

type RawGradeTeam = {
  roster_id?: number;
  owner_id?: string | null;
  power_rank?: number;
  dynasty_rank?: number;
  contender_grade?: string;
  dynasty_grade?: string;
  total_value?: number;
  starter_value?: number;
  projected_ppg?: number;
  trajectory_pct?: number;
  year_totals?: Record<string, number>;
  positional?: Record<string, RawPositional>;
  avg_starter_age?: number;
  weakness?: string | null;
};

type GradesResponse = { teams?: RawGradeTeam[] };

function slimGradeTeam(t: RawGradeTeam): RATeamGrade | null {
  if (typeof t.roster_id !== "number") return null;
  const positional: Record<string, { value: number; count: number; avgAge: number }> = {};
  for (const [pos, raw] of Object.entries(t.positional ?? {})) {
    positional[pos] = {
      value: num(raw?.value),
      count: num(raw?.count),
      avgAge: num(raw?.avg_age),
    };
  }
  return {
    rosterId: t.roster_id,
    ownerId: typeof t.owner_id === "string" ? t.owner_id : null,
    powerRank: num(t.power_rank),
    dynastyRank: num(t.dynasty_rank),
    contenderGrade: t.contender_grade ?? "",
    dynastyGrade: t.dynasty_grade ?? "",
    totalValue: num(t.total_value),
    starterValue: num(t.starter_value),
    projectedPpg: num(t.projected_ppg),
    trajectoryPct: num(t.trajectory_pct),
    yearTotals: t.year_totals ?? {},
    positional,
    avgStarterAge: num(t.avg_starter_age),
    weakness: typeof t.weakness === "string" ? t.weakness : null,
  };
}

export function getRosterGrades(
  leagueId: string,
  userId: string,
): Promise<RAGradesByRosterId> {
  return cached(GRADES_KEY(leagueId, userId), GRADES_TTL, async () => {
    const res = await raFetch<GradesResponse>(
      `/projections/roster-grades?league_id=${leagueId}&user_id=${userId}`,
    );
    const out: RAGradesByRosterId = {};
    for (const raw of res.teams ?? []) {
      const slim = slimGradeTeam(raw);
      if (slim) out[slim.rosterId] = slim;
    }
    return out;
  });
}

// --- Player profile + stats ---

const PLAYER_PAGE_KEY = (id: string) => `rosteraudit:v1:player-page:${id}`;
const PLAYER_PAGE_TTL = 6 * 60 * 60;
const PLAYER_STATS_KEY = (id: string) => `rosteraudit:v1:player-stats:${id}`;
const PLAYER_STATS_TTL = 24 * 60 * 60;

type RawPlayerPage = {
  player?: Record<string, unknown>;
  value?: Record<string, unknown>;
  value_history?: Array<{ date?: string; sf?: number; one_qb?: number }>;
};

function strOrNull(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null;
}

function numOrNull(v: unknown): number | null {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function slimProfile(raw: RawPlayerPage): RAPlayerProfile {
  const p = (raw.player ?? {}) as Record<string, unknown>;
  const v = (raw.value ?? {}) as Record<string, unknown>;
  const history = (raw.value_history ?? []).map((h) => ({
    date: h.date ?? "",
    sf: num(h.sf),
    oneQb: num(h.one_qb),
  }));
  return {
    player: {
      sleeperId: String(p.sleeper_id ?? ""),
      name: String(p.name ?? ""),
      position: String(p.position ?? ""),
      team: strOrNull(p.team),
      age: numOrNull(p.age),
      yearsExp: numOrNull(p.years_exp),
      college: strOrNull(p.college),
      height: strOrNull(p.height),
      weight: numOrNull(p.weight),
      jersey: numOrNull(p.jersey),
      photoUrl: strOrNull(p.photo_url),
      status: strOrNull(p.status),
      injuryStatus: strOrNull(p.injury_status),
      buyLow: flag(p.buy_low),
      sellHigh: flag(p.sell_high),
      breakout: flag(p.breakout),
    },
    value: {
      sf: num(v.sf),
      oneQb: num(v.one_qb),
      tier: num(v.tier),
      tierLabel: String(v.tier_label ?? ""),
      rankSf: num(v.rank_sf),
      rank1qb: num(v.rank_1qb),
      rankPosSf: num(v.rank_pos_sf),
      rankPos1qb: num(v.rank_pos_1qb),
      trend7d: trendNum(v.trend_7d),
      trend30d: trendNum(v.trend_30d),
      trend90d: trendNum(v.trend_90d),
      delta7d: num(v.delta_7d),
      delta30d: num(v.delta_30d),
      buyLow: flag(v.buy_low),
      sellHigh: flag(v.sell_high),
      breakout: flag(v.breakout),
    },
    valueHistory: history,
  };
}

export function getPlayerProfile(
  sleeperId: string,
): Promise<RAPlayerProfile | null> {
  return cached(PLAYER_PAGE_KEY(sleeperId), PLAYER_PAGE_TTL, async () => {
    try {
      const raw = await raFetch<RawPlayerPage>(`/player-page/${sleeperId}`);
      if (!raw.player) return null;
      return slimProfile(raw);
    } catch {
      return null;
    }
  });
}

type RawWeeklyStat = {
  wk?: number;
  fp?: number;
  fpp?: number;
  opp?: string | null;
  cmp?: number;
  att?: number;
  pass?: number;
  ptd?: number;
  int?: number;
  car?: number;
  rush?: number;
  rtd?: number;
  rec?: number;
  tgt?: number;
  recy?: number;
  retd?: number;
  epa?: number;
  repa?: number;
};

type RawPlayerStats = {
  season?: number;
  weekly?: RawWeeklyStat[];
  error?: string;
};

function slimStat(raw: RawWeeklyStat): RAWeeklyStat {
  return {
    week: num(raw.wk),
    fp: num(raw.fp),
    fpp: num(raw.fpp),
    opp: typeof raw.opp === "string" ? raw.opp : null,
    cmp: raw.cmp != null ? num(raw.cmp) : undefined,
    att: raw.att != null ? num(raw.att) : undefined,
    pass: raw.pass != null ? num(raw.pass) : undefined,
    ptd: raw.ptd != null ? num(raw.ptd) : undefined,
    int: raw.int != null ? num(raw.int) : undefined,
    car: raw.car != null ? num(raw.car) : undefined,
    rush: raw.rush != null ? num(raw.rush) : undefined,
    rtd: raw.rtd != null ? num(raw.rtd) : undefined,
    rec: raw.rec != null ? num(raw.rec) : undefined,
    tgt: raw.tgt != null ? num(raw.tgt) : undefined,
    recy: raw.recy != null ? num(raw.recy) : undefined,
    retd: raw.retd != null ? num(raw.retd) : undefined,
    epa: raw.epa != null ? num(raw.epa) : undefined,
    repa: raw.repa != null ? num(raw.repa) : undefined,
  };
}

export function getPlayerStats(
  sleeperId: string,
): Promise<RAPlayerStats | null> {
  return cached(PLAYER_STATS_KEY(sleeperId), PLAYER_STATS_TTL, async () => {
    try {
      const raw = await raFetch<RawPlayerStats>(`/player-stats/${sleeperId}`);
      if (raw.error || !raw.weekly) return null;
      return {
        season: num(raw.season),
        weekly: raw.weekly.map(slimStat),
      };
    } catch {
      return null;
    }
  });
}

// --- League history for GM Scout ---

const HISTORY_MGRS_KEY = (leagueId: string) =>
  `rosteraudit:v1:history:managers:${leagueId}`;
const HISTORY_MGR_KEY = (leagueId: string, userId: string) =>
  `rosteraudit:v1:history:manager:${leagueId}:${userId}`;
const HISTORY_TTL = 12 * 60 * 60;

type RawManagerSummary = Record<string, unknown>;
type RawManagerHistory = {
  totals?: Record<string, unknown>;
  seasons?: Array<Record<string, unknown>>;
};

function slimManagerSummary(raw: RawManagerSummary): RAManagerSummary {
  return {
    userId: String(raw.user_id ?? ""),
    displayName: String(raw.display_name ?? ""),
    avatar: typeof raw.avatar === "string" ? raw.avatar : null,
    seasonsPlayed: num(raw.seasons_played),
    totalGames: num(raw.total_games),
    totalWins: num(raw.total_wins),
    totalLosses: num(raw.total_losses),
    totalTies: num(raw.total_ties),
    winPct: num(raw.win_pct),
    totalPf: num(raw.total_pf),
    avgPfPerSeason: num(raw.avg_pf_per_season),
    championships: num(raw.championships),
    runnerUps: num(raw.runner_ups),
    lastPlaces: num(raw.last_places),
    playoffAppearances: num(raw.playoff_appearances),
    playoffWins: num(raw.total_playoff_wins),
    playoffLosses: num(raw.total_playoff_losses),
    highestWeekScore: num(raw.highest_week_score),
    lowestWeekScore: num(raw.lowest_week_score),
  };
}

export function getLeagueManagers(
  leagueId: string,
): Promise<RAManagerSummary[]> {
  return cached(HISTORY_MGRS_KEY(leagueId), HISTORY_TTL, async () => {
    try {
      const raw = await raFetch<{ managers?: RawManagerSummary[] }>(
        `/league-history/${leagueId}/managers`,
      );
      return (raw.managers ?? []).map(slimManagerSummary);
    } catch {
      return [];
    }
  });
}

export function getManagerHistory(
  leagueId: string,
  userId: string,
): Promise<RAManagerHistory | null> {
  return cached(HISTORY_MGR_KEY(leagueId, userId), HISTORY_TTL, async () => {
    try {
      const raw = await raFetch<RawManagerHistory>(
        `/league-history/${leagueId}/manager/${userId}`,
      );
      const t = (raw.totals ?? {}) as Record<string, unknown>;
      const seasons: RAManagerSeasonRow[] = (raw.seasons ?? []).map((s) => ({
        season: String(s.season ?? ""),
        rosterId: num(s.roster_id),
        wins: num(s.wins),
        losses: num(s.losses),
        ties: num(s.ties),
        pointsFor: num(s.points_for),
        pointsAgainst: num(s.points_against),
        finalStanding: num(s.final_standing),
        madePlayoffs: flag(s.made_playoffs),
        wonChampionship: flag(s.won_championship),
        runnerUp: flag(s.runner_up),
        lastPlace: flag(s.last_place),
      }));
      return {
        totals: {
          displayName: String(t.display_name ?? ""),
          seasons: num(t.seasons),
          totalWins: num(t.total_wins),
          totalLosses: num(t.total_losses),
          championships: num(t.championships),
          runnerUps: num(t.runner_ups),
          lastPlaces: num(t.last_places),
          totalPf: num(t.total_pf),
          playoffWins: num(t.playoff_wins),
          playoffLosses: num(t.playoff_losses),
          winPct: num(t.win_pct),
        },
        seasons,
      };
    } catch {
      return null;
    }
  });
}

export type {
  RAValue,
  RAValuesBySleeperId,
  RAFormatKey,
  RAPick,
  RATeamGrade,
  RAGradesByRosterId,
  RAPlayerProfile,
  RAPlayerStats,
  RAManagerSummary,
  RAManagerHistory,
  RAWeeklyStat,
  PickSlot,
};
