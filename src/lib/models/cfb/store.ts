import "server-only";
import { redis } from "@/lib/redis/client";
import { teamKey } from "@/lib/picks/parse";
import { closingLines } from "@/lib/picks/closing-store";
import { matchSplits, type SplitGame } from "@/lib/picks/splits";
import type { BoardGame } from "@/lib/picks/engine";
import { CFB_MODEL_GATE, sectionView, type SectionView } from "@/lib/learning/engine";
import { loadJournal, loadSection, reviewIfDue } from "@/lib/learning/store";
import { CfbModel, type CfbParams, type CfbResult } from "./model";
import { CFB_SECTION, cfbCandidates, foldRead, forwardRecord, gameKey, liveSlicesFor, type CfbTracked, type Closing, type ForwardRecord } from "./track";
import PARAMS from "./params.json";

// Our college model, live (tracked and learning; nothing staked). Rides along
// the college picks data run (lib/picks/report.ts runPicksData), as our NFL
// spread model does: ratings rebuilt from ESPN's FBS finals (last season and
// this one), each priced board game projected and saved (first read and last
// pregame read), finals written in, then the edge hunt's review once a slate.
//
// Redis:
//   models:v1:cfb:results:{season}:{type}:w{n}   ESPN finals for a finished week (kept)
//   models:v1:cfb:track:{season}                 hash, `${week}|${home}|${away}` -> CfbTracked
//   learn:v1:cfb-model-ours:{season}:state|journal (lib/learning/store.ts)

const P = PARAMS as CfbParams;
const SITE = "https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard";
const resultsKey = (season: number, type: number, week: number) => `models:v1:cfb:results:${season}:${type}:w${week}`;
const trackKey = (season: number) => `models:v1:cfb:track:${season}`;

interface EspnBoard {
  events?: {
    id: string;
    date?: string;
    status?: { type?: { completed?: boolean } };
    competitions?: {
      neutralSite?: boolean;
      conferenceCompetition?: boolean;
      competitors?: { homeAway: string; score?: string; team: { location?: string } }[];
    }[];
  }[];
}

interface WeekRead {
  finals: CfbResult[];
  /** Every game on the week's board, keyed `${home}|${away}`. */
  info: Map<string, { neutral: boolean; conf: boolean; kickoff?: string }>;
  complete: boolean;
}

async function readWeek(season: number, type: number, week: number): Promise<WeekRead> {
  const res = await fetch(`${SITE}?week=${week}&seasontype=${type}&dates=${season}&groups=80&limit=400`, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`ESPN college scoreboard answered ${res.status}`);
  const data = (await res.json()) as EspnBoard;
  const finals: CfbResult[] = [];
  const info: WeekRead["info"] = new Map();
  let complete = true;
  for (const e of data.events ?? []) {
    const c = e.competitions?.[0];
    const h = c?.competitors?.find((x) => x.homeAway === "home");
    const a = c?.competitors?.find((x) => x.homeAway === "away");
    if (!c || !h || !a) continue;
    const home = teamKey("cfb", h.team.location ?? "");
    const away = teamKey("cfb", a.team.location ?? "");
    const neutral = !!c.neutralSite;
    info.set(`${home}|${away}`, { neutral, conf: !!c.conferenceCompetition, kickoff: e.date });
    const done = !!e.status?.type?.completed;
    if (!done) complete = false;
    const hs = Number(h.score);
    const as = Number(a.score);
    if (done && h.score !== undefined && a.score !== undefined && Number.isFinite(hs) && Number.isFinite(as))
      finals.push({ id: e.id, season, date: (e.date ?? "").slice(0, 10), home, away, homeScore: hs, awayScore: as, neutral });
  }
  return { finals, info, complete: complete && (data.events?.length ?? 0) > 0 };
}

/** A week's finals: from Redis once the week is over, else from ESPN. */
async function weekFinals(season: number, type: number, week: number): Promise<CfbResult[]> {
  const kept = await redis.get<CfbResult[]>(resultsKey(season, type, week)).catch(() => null);
  if (kept) return kept;
  const w = await readWeek(season, type, week);
  if (w.complete) await redis.set(resultsKey(season, type, week), w.finals);
  return w.finals;
}

/** Every FBS final from last season's start through this week (the ratings' input). Weeks ESPN can't read are skipped. */
async function allFinals(season: number, week: number): Promise<CfbResult[]> {
  const slots: [number, number, number][] = [
    ...Array.from({ length: 16 }, (_, i): [number, number, number] => [season - 1, 2, i + 1]),
    [season - 1, 3, 1],
    ...Array.from({ length: Math.max(0, week) }, (_, i): [number, number, number] => [season, 2, i + 1]),
  ];
  const out: CfbResult[] = [];
  for (let i = 0; i < slots.length; i += 6) {
    const got = await Promise.all(slots.slice(i, i + 6).map(([s, t, w]) => weekFinals(s, t, w).catch(() => [] as CfbResult[])));
    for (const g of got) out.push(...g);
  }
  return out;
}

async function loadTracked(season: number): Promise<CfbTracked[]> {
  const h = await redis.hgetall<Record<string, CfbTracked | string>>(trackKey(season)).catch(() => null);
  return Object.values(h ?? {}).map((v) => (typeof v === "string" ? (JSON.parse(v) as CfbTracked) : v));
}

async function closesFor(season: number, games: CfbTracked[]): Promise<Map<string, Closing>> {
  const done = games.filter((g) => g.final);
  if (!done.length) return new Map();
  const { closes } = await closingLines("cfb", season, done).catch(() => ({ closes: new Map() }));
  const out = new Map<string, Closing>();
  for (const c of closes.values()) out.set(gameKey(c), { open: c.open, close: c.close, totalClose: c.totalClose });
  return out;
}

/**
 * One run: rate, project the priced board, save reads, write finals, review
 * once a slate. Returns one line for the picks data receipt.
 */
export async function runCfbModel(season: number, week: number, board: BoardGame[], feed: SplitGame[], now = new Date()): Promise<string> {
  // This week is read once: its finals feed the ratings, its board gives neutral sites and conference games.
  const [earlier, thisWeek] = await Promise.all([allFinals(season, week - 1), readWeek(season, 2, week).catch(() => null)]);
  const finals = [...earlier, ...(thisWeek?.finals ?? [])];
  const model = CfbModel.from(P, finals);
  const tracked = new Map((await loadTracked(season)).map((g) => [gameKey(g), g]));
  const at = now.toISOString();
  const write: Record<string, CfbTracked> = {};

  for (const g of board) {
    const ref = g.basis === "reference" ? g.ref : undefined;
    if (!ref?.kickoff) continue;
    const info = thisWeek?.info.get(`${g.home}|${g.away}`);
    const neutral = info?.neutral ?? false;
    const open = matchSplits({ home: g.home, away: g.away, kickoff: ref.kickoff, line: ref.line }, feed)?.open;
    const k = gameKey({ week, home: g.home, away: g.away });
    const next = foldRead(
      tracked.get(k),
      { week, home: g.home, away: g.away, kickoff: ref.kickoff, neutral, conf: info?.conf ?? null },
      { at, line: ref.line, ...(ref.total !== undefined ? { total: ref.total } : {}), ...(open !== undefined ? { open } : {}), proj: model.project({ season, home: g.home, away: g.away, neutral }) },
    );
    if (next) {
      write[k] = next;
      tracked.set(k, next);
    }
  }

  // Finals: this season's ESPN results, matched by teams, on or after the game's kickoff date.
  const byTeams = new Map<string, CfbResult[]>();
  for (const f of finals) if (f.season === season) byTeams.set(`${f.home}|${f.away}`, [...(byTeams.get(`${f.home}|${f.away}`) ?? []), f]);
  for (const g of tracked.values()) {
    if (g.final) continue;
    const f = byTeams.get(`${g.home}|${g.away}`)?.find((x) => x.date >= new Date(Date.parse(g.kickoff) - 86_400_000).toISOString().slice(0, 10));
    if (!f) continue;
    const next = { ...g, final: { home: f.homeScore, away: f.awayScore } };
    write[gameKey(g)] = next;
    tracked.set(gameKey(g), next);
  }
  if (Object.keys(write).length) await redis.hset(trackKey(season), write);

  const all = [...tracked.values()];
  const closes = await closesFor(season, all);
  const journal = await reviewIfDue(CFB_SECTION, season, week, CFB_MODEL_GATE, cfbCandidates(all, closes), now);
  const reviewed = journal.filter((j) => j.kind !== "registered").length;
  return `college model: ${finals.length} finals rated, ${Object.keys(write).length} games saved, ${all.filter((g) => g.final).length}/${all.length} graded${reviewed ? `, review: ${journal.find((j) => j.kind === "review")?.text ?? `${reviewed} changes`}` : ""}`;
}

export interface CfbModelView {
  record: ForwardRecord;
  section: SectionView;
  /** Games not yet final, soonest first, with any live slice that keeps them. */
  ahead: (CfbTracked & { live: string[] })[];
}

export async function getCfbModelView(season: number): Promise<CfbModelView> {
  const [games, state, journal] = await Promise.all([loadTracked(season), loadSection(CFB_SECTION, season), loadJournal(CFB_SECTION, season)]);
  const closes = await closesFor(season, games);
  const section = sectionView(CFB_MODEL_GATE, state, cfbCandidates(games, closes), journal);
  const ahead = games
    .filter((g) => !g.final)
    .sort((a, b) => a.kickoff.localeCompare(b.kickoff))
    .map((g) => ({ ...g, live: liveSlicesFor(section.entries, g) }));
  return { record: forwardRecord(games, closes), section, ahead };
}
