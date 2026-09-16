import { buildWeeklyReport } from "@/lib/guillotine/report";

export const dynamic = "force-dynamic";

// GET /api/faab?league=<id> - the weekly guillotine FAAB guide, as data.
//
// Registered as an Atlas source for the same reason the draft board is: the
// decision happens on a phone on a Tuesday, not in front of the app. The page,
// this route and the Tuesday email all call buildWeeklyReport, so none of them
// can drift from the others.
//
// GUILLOTINE ONLY. Every number in here assumes a chopped roster hits waivers
// each week and that FAAB never replenishes. In a redraft league that is not
// slightly wrong, it is a different game, so those leagues get a refusal by
// name rather than an answer.
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const leagueId = (params.get("league") ?? params.get("leagueId") ?? "").trim();

  if (!leagueId) {
    return Response.json(
      { ok: false, error: "Name a league: /api/faab?league=<id>." },
      { status: 400 },
    );
  }

  let report;
  try {
    report = await buildWeeklyReport(leagueId);
  } catch (e) {
    return Response.json(
      { ok: false, error: `Could not build the report: ${(e as Error).message}` },
      { status: 502 },
    );
  }

  if (report.state !== "ok") {
    return Response.json(
      { ok: false, state: report.state, error: report.message },
      { status: report.state === "not_guillotine" ? 400 : 200 },
    );
  }

  // The response leads with the verdict. A board of players is a cheat sheet;
  // the answer to "where does my money go this week" is the posture and the
  // number, and burying those under a roster dump would be the same mistake
  // the draft board made before it was extracted.
  return Response.json({
    ok: true,
    league: report.league,
    week: report.week,
    generatedAt: report.generatedAt,

    verdict: {
      posture: report.posture.posture,
      headline: report.posture.headline,
      detail: report.posture.detail,
      spendThisWeek: Math.round(report.card.maxPossibleSpend),
      weeklyCap: Math.round(report.budget.weeklyCap),
      sitOut: report.card.sitOut,
      summary: report.card.summary,
    },

    me: {
      team: report.me.name,
      faabRemaining: report.me.faabRemaining,
      projected: Number(report.me.projected.toFixed(1)),
      chopProbability: report.risk.myChopProbability,
      marginOverChopLine:
        report.risk.myMargin == null ? null : Number(report.risk.myMargin.toFixed(1)),
      weakestSlots: report.me.weakSlots,
      byeAlerts: report.me.byeAlerts,
      fragility: {
        fragile: report.me.fragility.fragile,
        reasons: report.me.fragility.reasons,
        worstOneOut: report.me.fragility.worstOneOut
          ? {
              name: report.me.fragility.worstOneOut.name,
              slot: report.me.fragility.worstOneOut.slot,
              projectedWithout: Number(report.me.fragility.worstOneOut.total.toFixed(1)),
            }
          : null,
        shakyStarters: report.me.fragility.shakyStarters,
        thinSlots: report.me.fragility.thinSlots,
        lineupAsSet:
          report.me.fragility.submittedTotal == null
            ? null
            : {
                projected: Number(report.me.fragility.submittedTotal.toFixed(1)),
                underBest: Number(report.me.fragility.submittedGap.toFixed(1)),
                holes: report.me.fragility.submittedHoles,
              },
      },
      lastWeek: report.me.lastWeek
        ? {
            week: report.me.lastWeek.week,
            score: Number(report.me.lastWeek.score.toFixed(1)),
            rankFromBottom: report.me.lastWeek.rankFromBottom,
            teams: report.me.lastWeek.teams,
            lowest: Number(report.me.lastWeek.lowest.toFixed(1)),
            marginOverLowest: Number(report.me.lastWeek.margin.toFixed(1)),
          }
        : null,
    },

    field: {
      teamsAlive: report.league.teamsAlive,
      expectedChopLine: Number(report.risk.expectedChopLine.toFixed(1)),
      baselineRisk: report.risk.baselineRisk,
      mostAtRisk: report.field.slice(0, 5).map((t) => ({
        team: t.name,
        isMine: t.isMine,
        projected: Number(t.projected.toFixed(1)),
        chopProbability: Number(t.chopProbability.toFixed(4)),
      })),
    },

    budget: {
      phase: report.budget.phase,
      phaseNote: report.budget.phaseNote,
      eliminationsRemaining: report.budget.eliminationsRemaining,
      neutralAllowance: Math.round(report.budget.neutralAllowance),
      holdFloor: Math.round(report.budget.holdFloor),
      maxSingleBid: Math.round(report.budget.maxSingleBid),
      purchasingPowerShare: Number(report.budget.purchasingPowerShare.toFixed(4)),
      maxRivalBid: Math.round(report.budget.maxRivalBid),
      notes: report.budget.notes,
    },

    bids: report.card.chains.map((chain) => ({
      need: chain.need,
      drop: chain.drop?.name ?? null,
      // Order matters: these all drop the same player, so winning the first
      // cancels the rest. Submitting them out of order is how a fallback
      // becomes an accidental second purchase.
      claims: chain.targets.map((t, index) => ({
        order: index + 1,
        player: t.player.name,
        position: t.player.position,
        team: t.player.team,
        tier: t.tier,
        bid: t.bid,
        walkAway: t.walkAway,
        marketExpected: Math.round(t.marketExpected),
        addsToLineup: Number(t.weekGain.toFixed(1)),
        replaces: t.displaces?.name ?? null,
        fromChoppedRoster: t.player.fromChoppedRoster,
        injuryStatus: t.player.injuryStatus,
        byeWeek: t.player.byeWeek,
        why: t.reason,
      })),
    })),

    market: {
      note: report.market.note,
      expected: Object.fromEntries(
        Object.entries(report.market.estimates).map(([tier, e]) => [
          tier,
          { expected: Math.round(e.expected), basis: e.basis, observations: e.observations },
        ]),
      ),
    },

    scoringNotes: report.league.scoringNotes,
    caveats: report.caveats,
  });
}
