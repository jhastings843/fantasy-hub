import { getValuesForProfile } from "@/lib/values";
import { resolveLeague } from "@/lib/league/discover";
import {
  getAllPlayers,
  getDraftPicks,
  getLeague,
  getLeagueDrafts,
  getLeagueRosters,
  getUser,
} from "@/lib/sleeper/client";
import { displayPositionRank } from "@/lib/redraft/draft-board";
import { buildLiveBoard, neededPositionList } from "@/lib/redraft/live-board";
import { jinglesAppliesTo, LAB_300_APPLIES_TO } from "@/lib/jingles/data";
import { activeLab } from "@/lib/jingles/active";
import { scoringSkewNotes } from "@/lib/guillotine/scoring";

export const dynamic = "force-dynamic";

// GET /api/draft?league=<id> - the live draft board, as data.
//
// Everything here already existed inside the draft page. That meant it existed
// only on a screen, so during the one hour of the year it matters most, "who do
// I take" was answerable on a laptop Jack was not looking at. He drafts on his
// phone. This is the same board, computed by the same code (lib/redraft/
// live-board.ts), reachable by Atlas.
//
// REDRAFT AND GUILLOTINE ONLY. The board is ranked on the Lab 300, which is
// half-PPR redraft research and not a dynasty opinion. A dynasty league gets a
// refusal rather than a board built on the wrong question.

const MAX_BEST = 25;

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const leagueId = (params.get("league") ?? params.get("leagueId") ?? "").trim();
  if (!leagueId) {
    return Response.json({ ok: false, error: "Name a league: /api/draft?league=<id>." }, { status: 400 });
  }

  const username = process.env.SLEEPER_USERNAME;
  if (!username) {
    return Response.json({ ok: false, error: "SLEEPER_USERNAME is not set, so there is no roster to build a board against." }, { status: 500 });
  }

  let league;
  try {
    league = await resolveLeague(leagueId);
  } catch (e) {
    console.error("/api/draft: could not read league", leagueId, e);
    return Response.json({ ok: false, error: "Could not read that league from Sleeper. Try again in a minute." }, { status: 502 });
  }
  if (!league) return Response.json({ ok: false, error: `No league ${leagueId}.` }, { status: 404 });

  if (!jinglesAppliesTo(league.type)) {
    return Response.json({
      ok: false,
      appliesTo: LAB_300_APPLIES_TO,
      error: `${league.name} is ${league.type}. This board ranks on half-PPR redraft research, which is not a dynasty opinion, so there is no honest board to give you here.`,
    }, { status: 409 });
  }

  const [me, drafts, rosters, players, valueSet, rawLeague, lab] = await Promise.all([
    getUser(username),
    getLeagueDrafts(leagueId),
    getLeagueRosters(leagueId),
    getAllPlayers(),
    // The values source needs the raw Sleeper league as well as the profile.
    // A failure here is not fatal: the Lab 300 alone still produces a board,
    // it just loses the value column.
    getLeague(leagueId)
      .then((raw) => getValuesForProfile(league, raw))
      .then((r) => r.values)
      .catch(() => ({})),
    // Cached, so asking a second time costs nothing. Needed for the scoring
    // notes, which the profile flattens too far to reconstruct.
    getLeague(leagueId).catch(() => null),
    // His rankings for THIS league's scoring, when one has been ingested.
    activeLab(league),
  ]);

  const draft = drafts[0] ?? null;
  const picks = draft ? await getDraftPicks(draft.draft_id).catch(() => []) : [];
  const myRoster = rosters.find((r) => r.owner_id === me.user_id) ?? null;
  const myPickIds = picks.filter((p) => p.picked_by === me.user_id).map((p) => p.player_id);

  const board = buildLiveBoard({
    labList: lab.list,
    rankings: { byId: lab.byId, tierFor: lab.tierFor },
    rosterPositions: league.rosterPositions,
    draftedIds: picks.map((p) => p.player_id),
    myIds: [...(myRoster?.players ?? []), ...myPickIds],
    positionById: (id) => players[id]?.position ?? undefined,
    values: valueSet as never,
    limit: 8,
  });

  const slim = (p: (typeof board.bestAvailable)[number]) => ({
    id: p.id,
    name: p.name,
    position: p.position,
    team: p.team,
    labRank: p.labRank,
    labPositionRank: displayPositionRank(p),
    labTier: p.labTier,
    call: p.jingles ? { verdict: p.jingles.verdict, note: p.jingles.note } : null,
  });

  return Response.json({
    ok: true,
    appliesTo: LAB_300_APPLIES_TO,
    // The board is ordered by the Lab 300, which is HALF-PPR research. When the
    // league is not half PPR that ordering is systematically off in a direction
    // worth naming, and the page said so while this route did not. Atlas reads
    // this route and cannot see the league settings, so without these notes it
    // would quote a half-PPR rank at a full-PPR draft and sound certain.
    scoringNotes: [
      // A skew note is only true while the list is the wrong one for this
      // league, so the list being quoted is passed in and the note suppresses
      // itself. It used to be added unconditionally and sat directly above the
      // line saying the list matched, which is two answers to one question.
      ...scoringSkewNotes(rawLeague?.scoring_settings ?? {}, lab.scoring),
      ...(lab.matchesLeagueScoring
        ? [`Ranked on his ${lab.scoring.replace("_", " ")} list, which matches this league's scoring.`]
        : []),
    ],
    rankings: {
      source: lab.source,
      scoring: lab.scoring,
      matchesLeagueScoring: lab.matchesLeagueScoring,
      title: lab.title,
      url: lab.url,
      postedAt: lab.postedAt,
      players: lab.list.length,
    },
    league: { id: leagueId, name: league.name, type: league.type },
    draft: draft
      ? {
          status: draft.status,
          rounds: draft.settings?.rounds ?? null,
          teams: draft.settings?.teams ?? null,
          picksMade: picks.length,
          // Whether the draft has started at all is the first thing to say. A
          // board for a draft that has not begun is a cheat sheet, not advice,
          // and the two read very differently to somebody on the clock.
          started: picks.length > 0,
        }
      : null,
    you: {
      picksMade: myPickIds.length,
      rosterSize: myRoster?.players?.length ?? 0,
      // What is still unfilled, in plain words, so a reply can say "you still
      // need a TE" without the caller doing the reading.
      stillNeed: neededPositionList(board.needs),
      openSlots: board.needs.map((n) => ({ slot: n.slot, required: n.required, filled: n.filled })),
      slotsNoSourceCovers: board.uncoveredSlots.map((n) => n.slot),
    },
    take: board.board.map((r) => ({
      rank: r.rank,
      why: r.headline,
      reasoning: r.reasoning,
      fillsNeed: r.fillsNeed,
      player: slim(r.player),
    })),
    bestAvailable: board.bestAvailable.slice(0, MAX_BEST).map(slim),
    poolSize: board.pool.length,
  });
}
