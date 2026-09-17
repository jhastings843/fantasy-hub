import {
  latestWeeklyFor,
  readWeeklyFor,
  type StoredWeeklyEntry,
} from "@/lib/jingles/ingest";
import type { Scoring } from "@/lib/jingles/parse";
import { normalizeTeam } from "@/lib/jingles/resolve";
import { fixtureMap, type Fixture } from "@/lib/nfl/week";
import { getSeasonGames } from "@/lib/survivor/odds";

export const dynamic = "force-dynamic";

// GET /api/jingles/weekly - his weekly rankings, for a start/sit question.
//
// Separate from /api/jingles, which serves the Lab 300, because they answer
// different questions and holding the wrong one is how a confident wrong answer
// happens. The Lab 300 is "who is better for the rest of the season". This is
// "who do I start on Sunday", and a player can be well ahead on one and behind
// on the other.
//
// It exists for the league Atlas cannot see. Jack's four Sleeper leagues get
// this through the lineup tab, which reads his roster and solves the slots. His
// Yahoo league is not connected to anything, so the only way to ask "Kittle or
// Thomas this week" is to ask Atlas, and until now Atlas had only the
// season-long list to answer it with.
//
// THE FLEX RANK IS THE POINT. His positional lists rank a tight end against
// tight ends, which cannot answer a flex decision between a tight end and a
// receiver. The Top 150 FLEX list is the only place he ranks them against each
// other, so every player here carries both numbers and the response says which
// to use for which slot. Answering a flex question with two positional ranks is
// the specific mistake this endpoint is shaped to prevent.

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 25;

/** Case, punctuation and generational suffixes, so one source matches another. */
const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z ]/g, "")
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();

interface Row {
  name: string;
  position: string;
  team: string;
  opponent: string;
  home: boolean;
  matchup: string;
  /** Rank within his list for that position. */
  positionRank: number | null;
  /** Rank in his FLEX list. Null means outside it, not unranked. */
  flexRank: number | null;
  /** Rank in his superflex list, where quarterbacks are ranked against the rest. */
  superflexRank: number | null;
  /** Expert consensus rank, where FantasyPros publishes one. */
  ecrRank: number | null;
  /** Consensus minus his. POSITIVE means he is higher on the player than the field. */
  vsEcr: number | null;
  sleeperId: string | null;
}

/** "full_ppr", "ppr", "full", "1" and friends all mean the same list. */
function askedScoring(raw: string | null): Scoring {
  const s = (raw ?? "").trim().toLowerCase().replace(/[\s-]/g, "_");
  if (!s) return "half_ppr";
  if (/^(full_?ppr|ppr|full|1|1_?0)$/.test(s)) return "full_ppr";
  if (/^(standard|std|non_?ppr|none|0|0_?0)$/.test(s)) return "standard";
  return "half_ppr";
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;

  const scoring = askedScoring(params.get("scoring"));
  const askedWeek = Number(params.get("week"));
  const latest = await latestWeeklyFor(scoring);
  const weekly =
    Number.isFinite(askedWeek) && askedWeek > 0 && latest
      ? await readWeeklyFor(scoring, latest.season, askedWeek)
      : latest;

  if (!weekly) {
    return Response.json({
      ok: false,
      error:
        "No weekly rankings have been ingested for that scoring. Nothing here is a start/sit answer until his board is in.",
      scoring,
      players: [],
    });
  }

  // One row per player, carrying BOTH ranks. Built from the positional lists
  // first because those cover more players than the FLEX 150 does, then the
  // flex rank is folded in where he ranked them there too.
  // The schedule decides who a team plays and at whose ground, because his post
  // has been wrong about it. Week 1 had the 49ers "vs LAR" in four sections and
  // "@ LAR" in a fifth, and Atlas answering a start/sit question with the wrong
  // venue is the same wrongness as the lineup tab showing it.
  //
  // A failed fetch falls back to his own row rather than emptying the field.
  const fixtures = await getSeasonGames(Number(weekly.season))
    .then((s) => fixtureMap(s.games.filter((g) => g.week === weekly.week)))
    .catch(() => new Map<string, Fixture>());

  const matchupOf = (e: StoredWeeklyEntry): { opponent: string; home: boolean } => {
    const f = fixtures.get(normalizeTeam(e.team) ?? "");
    return f
      ? { opponent: f.opponent, home: f.home }
      : { opponent: normalizeTeam(e.opponent) ?? e.opponent, home: e.home };
  };

  // One vocabulary for the whole payload. He writes JAC and the schedule says
  // JAX, so leaving his spelling on `team` while `opponent` came from the
  // fixture gave Cleveland an opponent of JAX and Jacksonville a team of JAC,
  // which no consumer can join up. Sleeper's codes win, since a sleeperId sits
  // on every row anyway.
  const teamOf = (e: StoredWeeklyEntry) => normalizeTeam(e.team) ?? e.team;

  const rows = new Map<string, Row>();
  const keyOf = (e: StoredWeeklyEntry) => e.sleeperId ?? `${norm(e.name)}|${e.position}`;

  for (const [position, list] of Object.entries(weekly.positional)) {
    for (const e of list) {
      const { opponent, home } = matchupOf(e);
      rows.set(keyOf(e), {
        name: e.name,
        position,
        team: teamOf(e),
        opponent,
        home,
        matchup: `${home ? "vs" : "@"} ${opponent}`,
        positionRank: e.positionRank ?? e.rank,
        flexRank: null,
        superflexRank: null,
        ecrRank: e.ecrRank ?? null,
        vsEcr: e.vsEcr ?? null,
        sleeperId: e.sleeperId,
      });
    }
  }
  for (const e of weekly.flex) {
    const key = keyOf(e);
    const existing = rows.get(key);
    if (existing) existing.flexRank = e.rank;
    else {
      const { opponent, home } = matchupOf(e);
      rows.set(key, {
        name: e.name,
        position: e.position,
        team: teamOf(e),
        opponent,
        home,
        matchup: `${home ? "vs" : "@"} ${opponent}`,
        positionRank: e.positionRank ?? null,
        flexRank: e.rank,
        superflexRank: null,
        ecrRank: e.ecrRank ?? null,
        vsEcr: e.vsEcr ?? null,
        sleeperId: e.sleeperId,
      });
    }
  }

  // His superflex ordering, folded onto whatever is already here. New from week
  // 2: he never published one on Substack, so a week read from an old post
  // simply has none and every superflexRank stays null.
  for (const e of weekly.superflex ?? []) {
    const key = keyOf(e);
    const existing = rows.get(key);
    if (existing) {
      existing.superflexRank = e.rank;
      continue;
    }
    const { opponent, home } = matchupOf(e);
    rows.set(key, {
      name: e.name,
      position: e.position,
      team: teamOf(e),
      opponent,
      home,
      matchup: `${home ? "vs" : "@"} ${opponent}`,
      positionRank: e.positionRank ?? null,
      flexRank: null,
      superflexRank: e.rank,
      ecrRank: e.ecrRank ?? null,
      vsEcr: e.vsEcr ?? null,
      sleeperId: e.sleeperId,
    });
  }

  const all = [...rows.values()];

  const position = (params.get("position") ?? "").trim().toUpperCase();
  // He labels a defence D/ST and stores it as DEF. Take either rather than
  // making the caller know which vocabulary this list uses.
  const wanted = position === "DST" || position === "D/ST" ? "DEF" : position;
  const byPosition = wanted ? all.filter((r) => r.position.toUpperCase() === wanted) : all;

  const namesParam = (params.get("player") ?? params.get("q") ?? "").trim();
  const names = namesParam ? namesParam.split(",").map(norm).filter(Boolean) : [];

  const matching = names.length
    ? byPosition.filter((r) => {
        const n = norm(r.name);
        return names.some((want) => n === want || n.includes(want) || want.includes(n));
      })
    : byPosition;

  const rawLimit = Number(params.get("limit"));
  const limit =
    Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.min(Math.floor(rawLimit), MAX_LIMIT)
      : DEFAULT_LIMIT;

  // A name search returns everyone asked for and ignores the limit. Asking
  // about three players and being handed two because of a page size is the
  // quiet truncation the season endpoint already learned to avoid.
  const sorted = [...matching].sort((a, b) => {
    const fa = a.flexRank ?? Number.MAX_SAFE_INTEGER;
    const fb = b.flexRank ?? Number.MAX_SAFE_INTEGER;
    if (fa !== fb) return fa - fb;
    return (a.positionRank ?? 999) - (b.positionRank ?? 999);
  });
  const players = names.length ? sorted : sorted.slice(0, limit);

  const scoringLabel =
    weekly.scoring === "full_ppr"
      ? "full PPR"
      : weekly.scoring === "standard"
        ? "standard"
        : "half PPR";

  return Response.json({
    ok: true,
    week: weekly.week,
    season: weekly.season,
    scoring: weekly.scoring,
    listTitle: weekly.title,
    listUrl: weekly.url,
    /** His own "Last Updated" line. He edits this post through the week. */
    updatedLabel: weekly.updatedLabel,
    ingestedAt: weekly.ingestedAt,

    // The instructions, in the payload, because whoever reads this cannot see
    // the league the question is about.
    howToUse: [
      `These are ${scoringLabel} rankings for week ${weekly.week} only. They are a start/sit opinion, not a season-long or dynasty one.`,
      "For a FLEX decision compare flexRank, which is the list where he ranks running backs, receivers and tight ends against each other. Comparing two positionRanks across different positions is meaningless.",
      "For a SUPERFLEX or two-quarterback slot compare superflexRank, which is the only list where he ranks quarterbacks against everyone else.",
      "For a dedicated slot (QB, RB, WR, TE, DEF, K) compare positionRank.",
      "flexRank null means he left that player out of his flex list, which is a real signal in a flex decision, not missing data.",
      "A player absent entirely is one he did not rank this week. Say so rather than guessing at a rank.",
      "vsEcr is his rank against the expert consensus, and POSITIVE MEANS HE IS HIGHER on that player than the field. It is where his stance differs from everyone else, which is the reason to quote him rather than a consensus list. ecrRank null means FantasyPros published no consensus for that player.",
      `Ask for another scoring with ?scoring=full_ppr or ?scoring=standard. He now publishes all three as genuinely different lists, so quote the one that matches the league rather than adjusting ${scoringLabel} in your head.`,
    ],
    counts: {
      returned: players.length,
      matching: matching.length,
      ranked: all.length,
      inFlexList: all.filter((r) => r.flexRank !== null).length,
      inSuperflexList: all.filter((r) => r.superflexRank !== null).length,
    },
    /** The scorings he publishes, so a caller does not have to guess at the parameter. */
    scoringOptions: ["half_ppr", "full_ppr", "standard"],
    // Named rather than returned empty, so a spelling difference does not read
    // as "he is not ranked this week".
    notFound: names.length
      ? namesParam
          .split(",")
          .map((n) => n.trim())
          .filter(
            (n) =>
              n && !players.some((p) => norm(p.name).includes(norm(n)) || norm(n).includes(norm(p.name))),
          )
      : [],
    players,
  });
}
