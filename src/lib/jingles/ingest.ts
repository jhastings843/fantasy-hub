import "server-only";
import { redis } from "@/lib/redis/client";
import { getAllPlayers, getNflState } from "@/lib/sleeper/client";
import { fetchPosts, type JinglesPost } from "./feed";
import { inboxConfigured } from "./inbox";
import { parseMentions, parsePlays, parseRankings, type Scoring } from "./parse";
import { fetchAllWeeklyBoards, type FpRow } from "./fantasypros";
import { parseWeekly } from "./weekly";
import { parseWaivers } from "./waivers";
import { resolveNames, toCandidates } from "./resolve";

// Turning his posts into something the app can use.
//
// The shape deliberately mirrors the hand-curated data.ts, so everything
// downstream (the draft board, the rank chips, the player pages) keeps reading
// what it already reads. This replaces where the rows come from, not what they
// look like.
//
// Rankings are stored per scoring. That is the whole point of the exercise:
// Dah Chopped is a full-PPR league that has been advised off a half-PPR list
// all preseason, and once he posts full PPR the right list is simply there.

const KEY = {
  rankings: (scoring: Scoring) => `jingles:v1:rankings:${scoring}`,
  // Deliberately its own namespace. The weekly list and the Lab 300 are
  // different documents with different shapes and different lifetimes, and a
  // week of rankings landing on top of the season list would silently degrade
  // the draft board, scout, trade and plan tabs, which all read that key.
  weekly: (season: string, week: number) => `jingles:v1:weekly:${season}:w${week}`,
  weeklyLatest: () => `jingles:v1:weekly:latest`,
  // Per scoring, because from week 2 on there are three genuinely different
  // weekly lists rather than one list and a paragraph telling you how to adjust
  // it. The v1 keys above are the single half-PPR store his Substack posts
  // filled, and they are still read as a fallback so week 1 does not vanish.
  weeklyFor: (season: string, week: number, scoring: Scoring) =>
    `jingles:v2:weekly:${season}:w${week}:${scoring}`,
  weeklyLatestFor: (scoring: Scoring) => `jingles:v2:weekly:latest:${scoring}`,
  // His waiver post, which is a third document again: thirty players, a bid
  // and a rostered percent each, alive for exactly one week.
  waivers: (season: string, week: number) => `jingles:v1:waivers:${season}:w${week}`,
  waiversLatest: () => `jingles:v1:waivers:latest`,
  previous: (scoring: Scoring) => `jingles:v1:rankings:${scoring}:previous`,
  notes: () => `jingles:v1:notes`,
  seen: () => `jingles:v1:seen`,
  lastRun: () => `jingles:v1:last-run`,
};

/** Rankings are stable research, not live data. A month is generous. */
const TTL = 60 * 60 * 24 * 30;

/** Where he publishes them now, for anything that links back to the source. */
const RANKINGS_URL = process.env.JINGLES_RANKINGS_URL ?? "https://rankings.jingleslabs.com";

export interface StoredEntry {
  rank: number;
  sleeperId: string;
  name: string;
  position: string;
  positionRank: number;
  team: string;
  tier: string | null;
}

export interface StoredRankings {
  scoring: Scoring;
  title: string;
  url: string;
  postedAt: string;
  ingestedAt: string;
  source: "feed" | "inbox";
  entries: StoredEntry[];
  tiers: string[];
  /** Players in his list the app could not key to Sleeper. Surfaced, not hidden. */
  unresolved: { name: string; position: string; team: string | null; reason: string }[];
}

export interface StoredWeeklyEntry {
  /** Rank within its own list: the position list, or the FLEX 150. */
  rank: number;
  sleeperId: string | null;
  name: string;
  position: string;
  team: string;
  opponent: string;
  home: boolean;
  /**
   * Everything below arrives only from the FantasyPros board, so all of it is
   * optional: a week stored from one of his old Substack posts carries none of
   * it, and a reader has to treat absence as "not known" rather than as zero.
   */
  positionRank?: number;
  /** Expert consensus rank for the same player, where FantasyPros has one. */
  ecrRank?: number | null;
  /** Consensus rank minus his. POSITIVE means he is higher than the field. */
  vsEcr?: number | null;
  bye?: number | null;
  fantasyProsId?: string;
  /** The only id Jack's Yahoo league could ever be joined on. */
  yahooId?: string | null;
  note?: string | null;
}

export interface StoredWeekly {
  season: string;
  week: number;
  scoring: Scoring;
  title: string;
  url: string;
  postedAt: string;
  /** His own "Last Updated" line. The field that decides whether a re-read is new. */
  updatedLabel: string | null;
  ingestedAt: string;
  source: "feed" | "inbox" | "fantasypros";
  /** QB, RB, WR, TE, DEF, K. */
  positional: Record<string, StoredWeeklyEntry[]>;
  /** RB, WR and TE only. He publishes no quarterbacks in this list. */
  flex: StoredWeeklyEntry[];
  /**
   * His superflex ordering: quarterbacks ranked against everyone else. Absent
   * on any week stored from a Substack post, because he never published one.
   */
  superflex?: StoredWeeklyEntry[];
  /** His publish stamp from the platform, e.g. "2026-09-17 07:19:57". */
  publishedAt?: string | null;
  unresolved: { name: string; position: string; team: string | null; reason: string }[];
}

export interface StoredWaiverRow {
  /** His rank in the week's ranked list, or null for a player named only in the prose. */
  rank: number | null;
  sleeperId: string | null;
  name: string;
  position: string;
  /** The dollars he wrote, against the budget his post is priced for. */
  faab: number;
  /** The bid as a percent of that budget, which is the form the app prices in. */
  faabPercent: number;
  rostered: number | null;
  /** His case for the player, quoted. Only the players he wrote about have one. */
  note: string | null;
}

export interface StoredWaivers {
  season: string;
  week: number;
  /** The budget his dollars are priced against, usually $100. */
  budget: number;
  title: string;
  url: string;
  postedAt: string;
  ingestedAt: string;
  rows: StoredWaiverRow[];
  unresolved: { name: string; position: string; team: string | null; reason: string }[];
}

export interface StoredNote {
  sleeperId: string;
  name: string;
  /** His words, quoted. Never paraphrased into a claim of our own. */
  quote: string;
  adp?: string;
  jinglesRank?: string;
  postTitle: string;
  postUrl: string;
  postedAt: string;
  /** Prose extraction is a suggestion, and the UI has to say so. */
  confidence: "extracted";
}

export interface IngestReport {
  ranAt: string;
  postsSeen: number;
  postsNew: number;
  rankingsIngested: { scoring: Scoring; count: number; unresolved: number; title: string }[];
  weeklyIngested: {
    season: string;
    week: number;
    scoring: Scoring;
    rows: number;
    unresolved: number;
    updatedLabel: string | null;
    changed: boolean;
  }[];
  waiversIngested: {
    season: string;
    week: number;
    rows: number;
    unresolved: number;
    budget: number;
    changed: boolean;
  }[];
  notesIngested: number;
  bettingPostsSeen: number;
  skipped: { title: string; reason: string }[];
  /** The week this run was working on, as the schedule understands it. */
  week?: number | null;
  /**
   * True when his rankings and his waiver post for that week were both already
   * in the store, so a run asked to work only if needed did nothing.
   */
  weekComplete?: boolean;
}

async function readSeen(): Promise<Set<string>> {
  try {
    const ids = await redis.get<string[]>(KEY.seen());
    return new Set(Array.isArray(ids) ? ids : []);
  } catch {
    return new Set();
  }
}

async function writeSeen(ids: Set<string>): Promise<void> {
  try {
    // Keep the window bounded; he posts a few times a week.
    await redis.set(KEY.seen(), [...ids].slice(-200), { ex: TTL });
  } catch {
    // A failed write means a post is reprocessed next run, which is harmless:
    // ingestion is idempotent by design.
  }
}

export async function readRankings(scoring: Scoring): Promise<StoredRankings | null> {
  try {
    return (await redis.get<StoredRankings>(KEY.rankings(scoring))) ?? null;
  } catch {
    return null;
  }
}

/**
 * His weekly list for one week in one scoring.
 *
 * Falls back to the single half-PPR store his Substack posts wrote. Week 1 of
 * 2026 only ever existed there, so without the fallback the first week of the
 * season would disappear the moment the new source took over. The fallback is
 * offered ONLY to a half-PPR caller: handing that list to a full-PPR league
 * would resurrect exactly the mislabelling this per-scoring split exists to end.
 */
export async function readWeeklyFor(
  scoring: Scoring,
  season: string,
  week: number,
): Promise<StoredWeekly | null> {
  try {
    const stored = await redis.get<StoredWeekly>(KEY.weeklyFor(season, week, scoring));
    if (stored) return stored;
  } catch {
    // Fall through to the legacy store rather than going quiet.
  }

  if (scoring !== "half_ppr") return null;

  try {
    const legacy = await redis.get<StoredWeekly>(KEY.weekly(season, week));
    return legacy ?? null;
  } catch {
    return null;
  }
}

/** His weekly list for one week, or null if that week was never read. */
export async function readWeekly(season: string, week: number): Promise<StoredWeekly | null> {
  return readWeeklyFor("half_ppr", season, week);
}

/**
 * The most recent weekly list, whichever week that is.
 *
 * A pointer rather than a scan, because there is no key listing on this client
 * and guessing the current week from the calendar gets bye weeks and a shifting
 * Tuesday-to-Thursday publication window wrong. What was stored last is what he
 * published last.
 */
export async function latestWeeklyFor(scoring: Scoring): Promise<StoredWeekly | null> {
  try {
    const at = await redis.get<{ season: string; week: number }>(
      KEY.weeklyLatestFor(scoring),
    );
    if (at) {
      const stored = await readWeeklyFor(scoring, at.season, at.week);
      if (stored) return stored;
    }
  } catch {
    // Fall through.
  }

  if (scoring !== "half_ppr") return null;

  try {
    const at = await redis.get<{ season: string; week: number }>(KEY.weeklyLatest());
    if (!at) return null;
    return await readWeeklyFor("half_ppr", at.season, at.week);
  } catch {
    return null;
  }
}

export async function latestWeekly(): Promise<StoredWeekly | null> {
  return latestWeeklyFor("half_ppr");
}

/** His waiver post for one week, or null if that week was never read. */
export async function readWaivers(season: string, week: number): Promise<StoredWaivers | null> {
  try {
    return (await redis.get<StoredWaivers>(KEY.waivers(season, week))) ?? null;
  } catch {
    return null;
  }
}

/**
 * The most recent waiver post, whichever week that is.
 *
 * A pointer rather than a scan, for the same reason the weekly list keeps one:
 * there is no key listing on this client, and guessing the week from the
 * calendar gets the Tuesday-to-Wednesday window wrong in both directions.
 */
export async function latestWaivers(): Promise<StoredWaivers | null> {
  try {
    const at = await redis.get<{ season: string; week: number }>(KEY.waiversLatest());
    if (!at) return null;
    return await readWaivers(at.season, at.week);
  } catch {
    return null;
  }
}

export async function readNotes(): Promise<StoredNote[]> {
  try {
    return (await redis.get<StoredNote[]>(KEY.notes())) ?? [];
  } catch {
    return [];
  }
}

export async function lastRun(): Promise<IngestReport | null> {
  try {
    return (await redis.get<IngestReport>(KEY.lastRun())) ?? null;
  } catch {
    return null;
  }
}

/**
 * A rankings post is only stored if it parsed cleanly.
 *
 * A list with holes in it is not a shorter list, it is a broken one, and
 * quietly publishing 260 of 300 players would push everyone below the first gap
 * to the wrong rank. Better to keep the previous version and say why.
 */
function rankingsAreSound(rows: number, missing: number[], duplicates: number[]): string | null {
  if (rows < 50) return `only ${rows} rows parsed, which is not a ranking list`;
  if (duplicates.length > 0) return `duplicate ranks: ${duplicates.slice(0, 5).join(", ")}`;
  if (missing.length > rows * 0.02) {
    return `${missing.length} missing ranks, starting at ${missing[0]}`;
  }
  return null;
}

async function ingestRankings(
  post: JinglesPost,
  report: IngestReport,
): Promise<void> {
  const parsed = parseRankings(post.html, post.title);

  if (parsed.scoring === "unknown") {
    report.skipped.push({
      title: post.title,
      reason: "could not tell which scoring this list is for, so it is not safe to apply",
    });
    return;
  }

  const problem = rankingsAreSound(parsed.rows.length, parsed.missingRanks, parsed.duplicateRanks);
  if (problem) {
    report.skipped.push({ title: post.title, reason: problem });
    return;
  }

  const players = await getAllPlayers();
  const { resolved, unresolved, ambiguous } = resolveNames(
    parsed.rows.map((r) => ({ ...r, team: r.team })),
    toCandidates(players),
  );

  const entries: StoredEntry[] = resolved
    .map(({ input, playerId }) => ({
      rank: input.rank,
      sleeperId: playerId,
      name: input.name,
      position: input.position,
      positionRank: input.positionRank,
      team: input.team,
      tier: input.tier,
    }))
    .sort((a, b) => a.rank - b.rank);

  const stored: StoredRankings = {
    scoring: parsed.scoring,
    title: post.title,
    url: post.url,
    postedAt: post.postedAt,
    ingestedAt: new Date().toISOString(),
    source: post.source,
    entries,
    tiers: parsed.tiers,
    unresolved: [
      ...unresolved.map((u) => ({
        name: u.name,
        position: u.position,
        team: u.team,
        reason: "no Sleeper player matched",
      })),
      ...ambiguous.map((a) => ({
        name: a.input.name,
        position: a.input.position,
        team: a.input.team,
        reason: `matched ${a.candidates.length} players: ${a.candidates.join(", ")}`,
      })),
    ],
  };

  try {
    // Keep the version being replaced, so a refresh can show what moved rather
    // than silently swapping three hundred rows.
    const current = await redis.get<StoredRankings>(KEY.rankings(parsed.scoring));
    if (current && current.postedAt !== stored.postedAt) {
      await redis.set(KEY.previous(parsed.scoring), current, { ex: TTL });
    }
    await redis.set(KEY.rankings(parsed.scoring), stored, { ex: TTL });
  } catch (e) {
    report.skipped.push({
      title: post.title,
      reason: `parsed fine but could not be stored: ${e instanceof Error ? e.message : e}`,
    });
    return;
  }

  report.rankingsIngested.push({
    scoring: parsed.scoring,
    count: entries.length,
    unresolved: stored.unresolved.length,
    title: post.title,
  });
}

/**
 * Fold his weekly list into the store.
 *
 * Three things make this different from ingestRankings, and each one is a bug
 * that would otherwise have been silent:
 *
 * 1. It parses with parseWeekly, because parseRankings returns ZERO rows on the
 *    real post. The row shapes differ.
 * 2. It writes to its own key. The Lab 300 is never touched.
 * 3. It stores only when his "Last Updated" line has changed. He edits this
 *    post all week as injury news lands, so a re-read that finds the same stamp
 *    is a no-op rather than a rewrite.
 */
async function ingestWeekly(post: JinglesPost, report: IngestReport): Promise<void> {
  const parsed = parseWeekly(post.html, post.title);

  if (parsed.week === null || parsed.season === null) {
    report.skipped.push({
      title: post.title,
      reason: "could not tell which week this list is for, so it is not safe to file",
    });
    return;
  }

  const rows = [...Object.values(parsed.positional).flat(), ...parsed.flex];
  if (rows.length === 0) {
    report.skipped.push({
      title: post.title,
      reason: "read as a weekly list but no rows came out of it, so the post shape has changed",
    });
    return;
  }

  const gaps = Object.entries(parsed.missingRanks);
  if (gaps.length > 0) {
    // Reported, not refused. A weekly list with one missing rank is still worth
    // far more than no list, and the alternative is going quiet on a Thursday
    // morning over a typo of his.
    report.skipped.push({
      title: post.title,
      reason: `stored, but with gaps: ${gaps
        .map(([pos, ranks]) => `${pos} is missing ${ranks.length}`)
        .join(", ")}`,
    });
  }

  const existing = await readWeekly(parsed.season, parsed.week);
  const changed = !existing || existing.updatedLabel !== parsed.updatedLabel;
  if (!changed) {
    report.weeklyIngested.push({
      season: parsed.season,
      week: parsed.week,
      scoring: parsed.scoring,
      rows: rows.length,
      unresolved: existing.unresolved.length,
      updatedLabel: parsed.updatedLabel,
      changed: false,
    });
    return;
  }

  const players = await getAllPlayers();
  const candidates = toCandidates(players);
  const { resolved, unresolved, ambiguous } = resolveNames(rows, candidates);

  // One id per name, reused across both lists, so a player who appears in his
  // RB list and his FLEX 150 resolves once and cannot end up with two ids.
  const idFor = new Map<string, string>();
  const keyOf = (r: { name: string; position: string; team: string }) =>
    `${r.name}|${r.position}|${r.team}`;
  for (const { input, playerId } of resolved) idFor.set(keyOf(input), playerId);

  const store = (r: (typeof rows)[number]): StoredWeeklyEntry => ({
    rank: r.rank,
    sleeperId: idFor.get(keyOf(r)) ?? null,
    name: r.name,
    position: r.position,
    team: r.team,
    opponent: r.opponent,
    home: r.home,
  });

  const stored: StoredWeekly = {
    season: parsed.season,
    week: parsed.week,
    scoring: parsed.scoring,
    title: post.title,
    url: post.url,
    postedAt: post.postedAt,
    updatedLabel: parsed.updatedLabel,
    ingestedAt: new Date().toISOString(),
    source: post.source,
    positional: Object.fromEntries(
      Object.entries(parsed.positional).map(([pos, list]) => [pos, list.map(store)]),
    ),
    flex: parsed.flex.map(store),
    unresolved: [
      ...unresolved.map((u) => ({
        name: u.name,
        position: u.position,
        team: u.team,
        reason: "no Sleeper player matched",
      })),
      ...ambiguous.map((a) => ({
        name: a.input.name,
        position: a.input.position,
        team: a.input.team,
        reason: `matched ${a.candidates.length} players: ${a.candidates.join(", ")}`,
      })),
    ],
  };

  try {
    await redis.set(KEY.weekly(parsed.season, parsed.week), stored, { ex: TTL });
    await redis.set(
      KEY.weeklyLatest(),
      { season: parsed.season, week: parsed.week },
      { ex: TTL },
    );
  } catch (e) {
    report.skipped.push({
      title: post.title,
      reason: `parsed fine but could not be stored: ${e instanceof Error ? e.message : e}`,
    });
    return;
  }

  report.weeklyIngested.push({
    season: parsed.season,
    week: parsed.week,
    scoring: parsed.scoring,
    rows: rows.length,
    unresolved: stored.unresolved.length,
    updatedLabel: parsed.updatedLabel,
    changed: true,
  });
}

/**
 * Fold his FantasyPros board into the store, one stored list per scoring.
 *
 * This is the weekly path from week 2 of 2026 onward. It does not read a post
 * and is not triggered by one: on 2026-09-17 he moved the rankings to
 * rankings.jingleslabs.com and the Substack post that announced it contains a
 * link and no rows. Waiting for a post that will never come again is how this
 * would have gone quiet for the rest of the season while still looking healthy.
 *
 * Stored only when his publish stamp has moved, the same contract the post
 * parser held with his "Last Updated" line. He edits these lists through the
 * week, so a re-read that finds the same stamp is a no-op rather than a rewrite.
 */
async function ingestWeeklyBoards(
  season: string,
  week: number,
  report: IngestReport,
  options: { force?: boolean } = {},
): Promise<void> {
  const boards = await fetchAllWeeklyBoards(season, week);

  if (boards.length === 0) {
    report.skipped.push({
      title: `Weekly rankings, ${season} week ${week}`,
      reason:
        "his rankings board returned no players for this week, which is normal before he publishes it",
    });
    return;
  }

  const players = await getAllPlayers();
  const candidates = toCandidates(players);

  for (const board of boards) {
    const existing = await readWeeklyFor(board.scoring, board.season, board.week);
    const changed =
      options.force ||
      !existing ||
      (existing.publishedAt ?? existing.updatedLabel) !== board.publishedAt;

    if (!changed) {
      report.weeklyIngested.push({
        season: board.season,
        week: board.week,
        scoring: board.scoring,
        rows: Object.values(existing.positional).flat().length + existing.flex.length,
        unresolved: existing.unresolved.length,
        updatedLabel: existing.updatedLabel,
        changed: false,
      });
      continue;
    }

    // Every row he published this week, resolved ONCE. A player sits in his
    // positional list, his flex list and his superflex list, and resolving them
    // separately is how one player ends up with two Sleeper ids.
    const everyRow = [
      ...Object.values(board.positional).flat(),
      ...board.flex,
      ...board.superflex,
    ];
    const keyOf = (r: FpRow) => `${r.name}|${r.position}|${r.team}`;
    const unique = new Map<string, FpRow>();
    for (const row of everyRow) unique.set(keyOf(row), row);

    const { resolved, unresolved, ambiguous } = resolveNames([...unique.values()], candidates);
    const idFor = new Map<string, string>();
    for (const { input, playerId } of resolved) idFor.set(keyOf(input), playerId);

    const store = (r: FpRow): StoredWeeklyEntry => ({
      rank: r.rank,
      sleeperId: idFor.get(keyOf(r)) ?? null,
      name: r.name,
      position: r.position,
      team: r.team,
      opponent: r.opponent,
      home: r.home,
      positionRank: r.positionRank,
      ecrRank: r.ecrRank,
      vsEcr: r.vsEcr,
      bye: r.bye,
      fantasyProsId: r.fantasyProsId,
      yahooId: r.yahooId,
      note: r.note,
    });

    const scoringLabel =
      board.scoring === "full_ppr" ? "PPR" : board.scoring === "standard" ? "Standard" : "Half PPR";

    const stored: StoredWeekly = {
      season: board.season,
      week: board.week,
      scoring: board.scoring,
      title: `Jingles Labs Week ${board.week} Rankings (${scoringLabel})`,
      url: RANKINGS_URL,
      postedAt: board.publishedAt
        ? new Date(`${board.publishedAt.replace(" ", "T")}Z`).toISOString()
        : new Date().toISOString(),
      // His publish stamp IS the updated label now. Kept in the same field so
      // every reader that already shows "updated when" keeps working unchanged.
      updatedLabel: board.publishedAt,
      publishedAt: board.publishedAt,
      ingestedAt: new Date().toISOString(),
      source: "fantasypros",
      positional: Object.fromEntries(
        Object.entries(board.positional).map(([pos, list]) => [pos, list.map(store)]),
      ),
      flex: board.flex.map(store),
      superflex: board.superflex.map(store),
      unresolved: [
        ...unresolved.map((u) => ({
          name: u.name,
          position: u.position,
          team: u.team,
          reason: "no Sleeper player matched",
        })),
        ...ambiguous.map((a) => ({
          name: a.input.name,
          position: a.input.position,
          team: a.input.team,
          reason: `matched ${a.candidates.length} players: ${a.candidates.join(", ")}`,
        })),
      ],
    };

    try {
      await redis.set(KEY.weeklyFor(board.season, board.week, board.scoring), stored, {
        ex: TTL,
      });
      await redis.set(
        KEY.weeklyLatestFor(board.scoring),
        { season: board.season, week: board.week },
        { ex: TTL },
      );
    } catch (e) {
      report.skipped.push({
        title: stored.title,
        reason: `read fine but could not be stored: ${e instanceof Error ? e.message : e}`,
      });
      continue;
    }

    report.weeklyIngested.push({
      season: board.season,
      week: board.week,
      scoring: board.scoring,
      rows: Object.values(stored.positional).flat().length + stored.flex.length,
      unresolved: stored.unresolved.length,
      updatedLabel: stored.updatedLabel,
      changed: true,
    });
  }
}

/**
 * Fold his waiver post into the store.
 *
 * Stored only when the bids have actually moved. He edits this post through
 * Tuesday evening as injury news lands, and a re-read that finds the same
 * thirty players at the same prices is a no-op rather than a rewrite, which is
 * what lets the Tuesday-to-Thursday schedule run repeatedly without churn.
 *
 * A short list is refused rather than stored. Thirty rows is what he publishes;
 * four rows means the shape of his post changed and the parser caught the
 * wreckage, and half a waiver board is worse than yesterday's whole one.
 */
async function ingestWaivers(
  post: JinglesPost,
  season: string,
  report: IngestReport,
): Promise<void> {
  const parsed = parseWaivers(post.html, post.title);
  const week = parsed.week;

  if (!week) {
    report.skipped.push({
      title: post.title,
      reason: "read as a waiver post but its title names no week, so it could not be filed",
    });
    return;
  }

  if (parsed.rows.length < 10) {
    report.skipped.push({
      title: post.title,
      reason: `read as a waiver post but only ${parsed.rows.length} players came out of it, so the post shape has changed`,
    });
    return;
  }

  const existing = await readWaivers(parsed.season ?? season, week);
  const signature = (rows: { name: string; faab: number }[]) =>
    rows.map((r) => `${r.name}:${r.faab}`).join("|");
  if (existing && signature(existing.rows) === signature(parsed.rows)) {
    report.waiversIngested.push({
      season: existing.season,
      week: existing.week,
      rows: existing.rows.length,
      unresolved: existing.unresolved.length,
      budget: existing.budget,
      changed: false,
    });
    return;
  }

  const players = await getAllPlayers();
  const { resolved, unresolved, ambiguous } = resolveNames(
    parsed.rows.map((r) => ({ name: r.name, position: r.position, team: null })),
    toCandidates(players),
  );
  const idByName = new Map(resolved.map((r) => [r.input.name, r.playerId]));

  const stored: StoredWaivers = {
    season: parsed.season ?? season,
    week,
    budget: parsed.budget,
    title: post.title,
    url: post.url,
    postedAt: post.postedAt,
    ingestedAt: new Date().toISOString(),
    rows: parsed.rows.map((r) => ({
      rank: r.rank,
      sleeperId: idByName.get(r.name) ?? null,
      name: r.name,
      position: r.position,
      faab: r.faab,
      faabPercent: r.faabPercent,
      rostered: r.rostered,
      note: r.note,
    })),
    unresolved: [
      ...unresolved.map((u) => ({
        name: u.name,
        position: u.position,
        team: u.team,
        reason: "no Sleeper player matched",
      })),
      ...ambiguous.map((a) => ({
        name: a.input.name,
        position: a.input.position,
        team: a.input.team,
        reason: `matched ${a.candidates.length} players: ${a.candidates.join(", ")}`,
      })),
    ],
  };

  try {
    await redis.set(KEY.waivers(stored.season, week), stored, { ex: TTL });
    await redis.set(KEY.waiversLatest(), { season: stored.season, week }, { ex: TTL });
  } catch (e) {
    report.skipped.push({
      title: post.title,
      reason: `read fine but could not be stored: ${e instanceof Error ? e.message : e}`,
    });
    return;
  }

  report.waiversIngested.push({
    season: stored.season,
    week,
    rows: stored.rows.length,
    unresolved: stored.unresolved.length,
    budget: stored.budget,
    changed: true,
  });
}

async function ingestNotes(post: JinglesPost, report: IngestReport): Promise<void> {
  const players = await getAllPlayers();
  const candidates = toCandidates(players);

  // Only look for players the app already knows about from his own rankings,
  // rather than every name in the NFL: scanning prose for two thousand names
  // finds coincidences, not calls.
  const known = new Set<string>();
  for (const scoring of ["half_ppr", "full_ppr", "standard"] as Scoring[]) {
    const stored = await readRankings(scoring);
    for (const e of stored?.entries ?? []) known.add(e.name);
  }
  if (known.size === 0) {
    for (const c of candidates.slice(0, 0)) known.add(c.fullName);
  }

  const mentions = parseMentions(post.html, known);
  if (mentions.length === 0) return;

  const { resolved } = resolveNames(
    mentions.map((m) => ({ name: m.name, position: "", team: null })),
    candidates,
  );
  const idByName = new Map(resolved.map((r) => [r.input.name, r.playerId]));

  const fresh: StoredNote[] = [];
  for (const mention of mentions) {
    const sleeperId = idByName.get(mention.name);
    if (!sleeperId) continue;
    fresh.push({
      sleeperId,
      name: mention.name,
      quote: mention.context,
      ...(mention.adp ? { adp: mention.adp } : {}),
      ...(mention.jinglesRank ? { jinglesRank: mention.jinglesRank } : {}),
      postTitle: post.title,
      postUrl: post.url,
      postedAt: post.postedAt,
      confidence: "extracted",
    });
  }

  if (fresh.length === 0) return;

  try {
    const existing = await readNotes();
    const kept = existing.filter((n) => n.postUrl !== post.url);
    await redis.set(KEY.notes(), [...fresh, ...kept].slice(0, 400), { ex: TTL });
    report.notesIngested += fresh.length;
  } catch {
    report.skipped.push({ title: post.title, reason: "notes could not be stored" });
  }
}

/**
 * What this week already has in the store.
 *
 * "Rankings" means all three scorings, because a week where only half PPR
 * landed is a week his full-PPR and standard readers are still waiting on, and
 * calling that done would stop the later runs from ever fetching it.
 */
async function weekCaptured(
  season: string,
  week: number,
): Promise<{ rankings: boolean; waivers: boolean }> {
  const scorings: Scoring[] = ["half_ppr", "full_ppr", "standard"];
  const stored = await Promise.all(scorings.map((s) => readWeeklyFor(s, season, week)));
  const waivers = await readWaivers(season, week);
  return {
    rankings: stored.every((w) => w !== null && w.week === week),
    waivers: waivers !== null && waivers.week === week,
  };
}

/**
 * Read the publication and fold anything new into the store.
 *
 * Idempotent: a post already seen is skipped, and re-running is safe. Called
 * from the daily snapshot cron rather than a cron of its own, because Vercel
 * Hobby allows two and both are spoken for.
 */
export async function ingestJingles(
  options: { force?: boolean; ifNeeded?: boolean } = {},
): Promise<IngestReport> {
  const report: IngestReport = {
    ranAt: new Date().toISOString(),
    postsSeen: 0,
    postsNew: 0,
    rankingsIngested: [],
    weeklyIngested: [],
    waiversIngested: [],
    notesIngested: 0,
    bettingPostsSeen: 0,
    skipped: [],
    week: null,
    weekComplete: false,
  };

  // Which week the app is working on, and which weeks his board is read for.
  //
  // Sleeper keeps two numbers and they disagree for three days. On a Tuesday
  // after week 2 is played, `week` is already 3 while `display_week` is still
  // 2, because display_week follows the scoreboard and only rolls once waivers
  // process on Wednesday. This ingest asked for display_week, which meant that
  // every Tuesday and every Wednesday morning, the three days when the whole
  // point is preparing for the week ahead, it fetched the week just finished
  // and reported a healthy run. Both weeks are read now, oldest first, so the
  // "latest" pointer ends on the week that is coming.
  let season: string | null = null;
  let upcoming: number | null = null;
  let weeks: number[] = [];
  try {
    const state = await getNflState();
    season = state.season ?? null;
    upcoming = state.week ?? state.display_week ?? null;
    const displayed = state.display_week ?? state.week ?? null;
    weeks = [...new Set([displayed, upcoming].filter((w): w is number => !!w && w >= 1))].sort(
      (a, b) => a - b,
    );
    report.week = upcoming;
  } catch (e) {
    report.skipped.push({
      title: "Weekly rankings board",
      reason: `could not tell which week it is, so his board was not read: ${
        e instanceof Error ? e.message : e
      }`,
    });
  }

  // Asked to work only if there is work: this run is one of several across
  // Tuesday, Wednesday and Thursday, and once his rankings and his waiver post
  // for the week are both in, the later ones have nothing to do. Checked before
  // anything is fetched, so a no-op run costs two reads rather than a crawl of
  // the publication.
  //
  // The daily snapshot ingest does NOT pass this. It keeps re-reading all week,
  // which is what picks up the Thursday practice-report edits he makes to lists
  // already stored.
  if (options.ifNeeded && !options.force && season && upcoming) {
    const captured = await weekCaptured(season, upcoming);
    if (captured.rankings && captured.waivers) {
      report.weekComplete = true;
      report.skipped.push({
        title: `Week ${upcoming}`,
        reason: "his rankings and his waiver post for this week are both already in",
      });
      try {
        await redis.set(KEY.lastRun(), report, { ex: TTL });
      } catch {
        // The report is a convenience, not the work.
      }
      return report;
    }
  }

  // His rankings board FIRST, and not conditional on anything he posted.
  //
  // Until 2026-09-17 the weekly list only ever arrived inside a post, so the
  // ingest looked for a post and parsed it. The list now lives on a platform he
  // updates through the week without writing anything, which means a
  // post-driven ingest would sit there reporting healthy runs and quietly serve
  // week 1 rankings until January.
  if (season) {
    for (const week of weeks) {
      await ingestWeeklyBoards(season, week, report, { force: options.force });
    }
  }

  const posts = await fetchPosts();
  report.postsSeen = posts.length;

  const seen = await readSeen();

  for (const post of posts) {
    // A weekly post is never "seen" for good. He edits it in place all week as
    // injury news and practice reports land, and its own body says so:
    // "Updated live throughout the week". Marking it seen on Monday would mean
    // advising off Monday's ranks on Sunday morning, which is the failure this
    // whole feature exists to avoid. It is cheap to re-read: the store is only
    // written when his Last Updated line has actually moved.
    // Same reasoning for the waiver post: he edits it through Tuesday evening
    // as injury news lands, and a bid that moved from $5 to $25 is exactly the
    // edit worth catching. The store is only written when the prices actually
    // changed, so re-reading is cheap.
    const rereadAlways = post.kind === "weekly_rankings" || post.kind === "waivers";
    if (!options.force && !rereadAlways && seen.has(post.id)) continue;
    report.postsNew++;

    if (post.truncated) {
      // Still a teaser after the inbox was offered its chance, so say which of
      // the two ways it failed. "Paid post" on its own sent somebody looking
      // for a paywall problem that had been solved.
      report.skipped.push({
        title: post.title,
        reason:
          post.audience === "only_paid"
            ? inboxConfigured()
              ? "paid post, and no email of it was found in the inbox either"
              : "paid post, and no mailbox is configured here to read the emailed copy"
            : "body looks truncated",
      });
      seen.add(post.id);
      continue;
    }

    switch (post.kind) {
      case "rankings":
        await ingestRankings(post, report);
        break;
      case "weekly_rankings":
        await ingestWeekly(post, report);
        break;
      case "waivers":
        await ingestWaivers(post, season ?? post.postedAt.slice(0, 4), report);
        break;
      case "targets_fades":
      case "deep_dive":
        await ingestNotes(post, report);
        break;
      case "betting":
        // Fantasy Hub has no use for these; signal-bot reads them separately.
        report.bettingPostsSeen += parsePlays(post.html).length > 0 ? 1 : 0;
        break;
      default:
        break;
    }

    seen.add(post.id);
  }

  await writeSeen(seen);
  try {
    await redis.set(KEY.lastRun(), report, { ex: TTL });
  } catch {
    // The report is a convenience, not the work.
  }

  return report;
}
