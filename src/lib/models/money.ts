import "server-only";
import { liveBets, type Bet, type Candidate } from "@/lib/learning/engine";
import { loadSection } from "@/lib/learning/store";
import { etDate, nbaSeasonOfDate } from "@/lib/props/parse";
import { OUR_SECTION, fbCandidates, ourFtdCandidates, ourPropCandidates } from "./learn";
import { fbGraded, gradedList } from "./nba/store";
import { nflGradedList } from "./nfl/store";
import { ftdGraded } from "./nfl/ftd-store";

// Our four models' money for the Money page's props chart, week by week
// (Monday to Sunday, Eastern): every edge each model flagged (1 unit at the
// saved price, NBA and NFL props at DraftKings, First Basket at DraftKings,
// First TD at Kalshi's ask with its fee), and the bets of slices that went
// live on each model's learning section, counted from the day each went live.

export interface OurPropsWeek {
  /** Monday the week starts (Eastern), and the latest bet in it. */
  week: string;
  at: string;
  edges: number;
  edgeBets: number;
  system: number;
  systemBets: number;
}

const nflSeasonOf = (d: Date) => (d.getUTCMonth() < 7 ? d.getUTCFullYear() - 1 : d.getUTCFullYear());

/** Monday (YYYY-MM-DD, Eastern) of the week an instant falls in. */
export function mondayOf(at: string): string {
  const d = etDate(new Date(at));
  const t = Date.parse(`${d}T12:00:00Z`);
  const dow = (new Date(t).getUTCDay() + 6) % 7;
  return new Date(t - dow * 86_400_000).toISOString().slice(0, 10);
}

export async function ourPropsWeeks(now = new Date()): Promise<OurPropsWeek[]> {
  const nba = nbaSeasonOfDate(now);
  const nfl = nflSeasonOf(now);
  const STATS_NBA = ["pts", "reb", "ast", "threes"] as const;
  const STATS_NFL = ["pass_yds", "rush_yds", "rec_yds", "rec"] as const;
  const [nbaG, fbG, nflG, ftdG, sNba, sFb, sNfl, sFtd] = await Promise.all([
    gradedList(nba),
    fbGraded(nba),
    nflGradedList(nfl),
    ftdGraded(nfl),
    loadSection(OUR_SECTION.nbaProps, nba),
    loadSection(OUR_SECTION.nbaFirstBasket, nba),
    loadSection(OUR_SECTION.nflProps, nfl),
    loadSection(OUR_SECTION.nflFirstTd, nfl),
  ]);
  const sections: [Candidate[], string, typeof sNba][] = [
    [ourPropCandidates(nbaG, [...STATS_NBA]), "edge:all", sNba],
    [fbCandidates(fbG), "fb:all", sFb],
    [ourPropCandidates(nflG, [...STATS_NFL]), "edge:all", sNfl],
    [ourFtdCandidates(ftdG), "ftdb:value", sFtd],
  ];
  const weeks = new Map<string, OurPropsWeek>();
  const wk = (b: Bet) => {
    const k = mondayOf(b.at);
    let w = weeks.get(k);
    if (!w) weeks.set(k, (w = { week: k, at: b.at, edges: 0, edgeBets: 0, system: 0, systemBets: 0 }));
    if (b.at > w.at) w.at = b.at;
    return w;
  };
  for (const [cands, all, state] of sections) {
    for (const b of cands.find((c) => c.id === all)?.bets ?? []) {
      const w = wk(b);
      w.edges += b.net;
      w.edgeBets++;
    }
    for (const b of liveBets(state, cands)) {
      const w = wk(b);
      w.system += b.net;
      w.systemBets++;
    }
  }
  return [...weeks.values()].sort((a, b) => a.week.localeCompare(b.week));
}
