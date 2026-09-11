import { latestWeekly, readWeekly, type StoredWeeklyEntry } from "@/lib/jingles/ingest";
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
  /** Rank in the Top 150 FLEX list. Null means outside it, not unranked. */
  flexRank: number | null;
  sleeperId: string | null;
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;

  const askedWeek = Number(params.get("week"));
  const latest = await latestWeekly();
  const weekly =
    Number.isFinite(askedWeek) && askedWeek > 0 && latest
      ? await readWeekly(latest.season, askedWeek)
      : latest;

  if (!weekly) {
    return Response.json({
      ok: false,
      error:
        "No weekly rankings have been ingested. Nothing here is a start/sit answer until his weekly post is in.",
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
        positionRank: e.rank,
        flexRank: null,
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
        positionRank: null,
        flexRank: e.rank,
        sleeperId: e.sleeperId,
      });
    }
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
      "For a FLEX decision compare flexRank, which is the only list where he ranks running backs, receivers and tight ends against each other. Comparing two positionRanks across different positions is meaningless.",
      "For a dedicated slot (QB, RB, WR, TE, DEF) compare positionRank.",
      "flexRank null means he left that player out of his Top 150 FLEX list, which is a real signal in a flex decision, not missing data.",
      "A player absent entirely is one he did not rank this week. Say so rather than guessing at a rank.",
      `If the league is not ${scoringLabel}, say so: full PPR lifts pass-catching backs and slot receivers above where this list puts them, standard pushes them down, and a tight end premium lifts tight ends further still.`,
    ],
    counts: {
      returned: players.length,
      matching: matching.length,
      ranked: all.length,
      inFlexList: all.filter((r) => r.flexRank !== null).length,
    },
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
