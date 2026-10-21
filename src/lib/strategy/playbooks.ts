import type { LeagueType } from "@/lib/league/types";

// Written playbooks, one per format. These are the researched principles behind
// the computed goals on each league's plan page, in one place you can read
// before a draft.
//
// Guillotine is the one worth reading closely, because it is the format whose
// strategy least resembles the others and the one with no league connected yet.

export interface PlaybookSource {
  label: string;
  url: string;
}

export interface PlaybookSection {
  heading: string;
  points: string[];
}

export interface Playbook {
  type: LeagueType;
  title: string;
  /** The single question the format asks you to optimize. */
  thesis: string;
  sections: PlaybookSection[];
  sources: PlaybookSource[];
}

export const PLAYBOOKS: Playbook[] = [
  {
    type: "dynasty",
    title: "Dynasty",
    thesis:
      "Rosters carry over, so you are managing an asset portfolio across years, not a single season. The question is whether your window is open now or later, and every move is priced against that.",
    sections: [
      {
        heading: "Know your trajectory before you trade",
        points: [
          "Contender: pay up for win-now starters and stop hoarding picks. The window closes.",
          "Rebuild: sell aging veterans while they still carry value. A 29-year-old RB is worth more today than at any future point.",
          "Transition is the trap. Sitting between the two means paying contender prices with rebuild results. Pick a direction by the trade deadline.",
        ],
      },
      {
        heading: "Age curves are the whole game",
        points: [
          "RB value falls off a cliff around 27, WR holds into the late 20s, TE peaks latest, QB holds longest of all, especially in superflex.",
          "Superflex changes QB pricing more than any other setting. In a 12-team superflex, 24 QBs start, so the position is genuinely scarce.",
          "Target an average starter age under 25 if you are rebuilding. Contenders can carry older rosters, but should know what they are buying.",
        ],
      },
      {
        heading: "Pick capital",
        points: [
          "Future firsts are the currency of rebuilds, and they are cheapest to acquire in-season from teams chasing a title.",
          "Rookie picks are systematically overpriced in the weeks before a rookie draft and cheapest right after the NFL season ends.",
        ],
      },
    ],
    sources: [
      { label: "RosterAudit values and team grades", url: "https://rosteraudit.com" },
    ],
  },
  {
    type: "redraft",
    title: "Redraft",
    thesis:
      "One season, then everything resets. Youth, draft capital, and long-term upside are worth exactly nothing in December, so every decision is judged on this year's points alone.",
    sections: [
      {
        heading: "Draft for a complete starting lineup",
        points: [
          "Fill every starting slot before taking upside swings. A bench player scores zero.",
          "Ignore age entirely. A 30-year-old producing this season beats a rookie who might produce in 2028.",
          "Spread byes across starters, especially RB and WR. Concentrated byes cost you real games.",
        ],
      },
      {
        heading: "Read scoring, not record",
        points: [
          "Points for is a better forward signal than wins. A team losing close games with strong scoring is usually fine.",
          "The reverse is the real danger: a good record on weak scoring means you are being carried by schedule luck, and it will not hold.",
        ],
      },
      {
        heading: "Trade by playoff position",
        points: [
          "In the hunt: convert bench depth into a starting upgrade before the deadline. Depth wins nothing in a 6-team playoff.",
          "Outside but alive: consolidate. Two mid starters for one better starter raises your ceiling in a way depth cannot.",
          "Eliminated: nothing carries over, so stream freely and take variance. There is no future to protect.",
        ],
      },
      {
        heading: "Spend your FAAB",
        points: [
          "Unlike dynasty or guillotine, there is no endgame market to save for. Budget left over when the playoffs start was wasted.",
          "Keep a reserve for injury replacement mid-season, then spend down as the playoffs approach.",
        ],
      },
      {
        heading: "Build for the playoff weeks",
        points: [
          "Once you are through, weight starters by their playoff-week matchups rather than season-long averages. Those are the only games left.",
        ],
      },
    ],
    sources: [
      { label: "FantasyCalc redraft values", url: "https://fantasycalc.com" },
      {
        label: "Jingles Labs, half-PPR redraft research",
        url: "https://www.reddit.com/r/JoeInglesOfficial/",
      },
    ],
  },
  {
    type: "guillotine",
    title: "Guillotine",
    thesis:
      "The lowest-scoring team each week is eliminated and their entire roster returns to waivers. You are not trying to score the most, you are trying not to score the least. A second-place week and a second-to-last week are the same result.",
    sections: [
      {
        heading: "The format",
        points: [
          "The standard is 18 teams, one chopped per scoring week, last team standing wins. Yahoo public leagues run 14 teams over 13 weeks, and some private leagues stop chopping at four and decide the finish on cumulative points.",
          "FAAB is the only acquisition currency. There are no trades and no head-to-head record.",
          "Check your specific league's final-week rules before you draft or budget. They vary more than any other part of the format.",
        ],
      },
      {
        heading: "FAAB pacing: save early, spend late",
        points: [
          "A conservative benchmark on a $1,000 budget: hold $900 or more after September, $750 after October, and about $250 after November, then deploy the rest in December.",
          "Less conservative frameworks spend 20 to 35 percent in September instead. Treat the conservative numbers as a ceiling on spend, not a floor.",
          "Cap any single bid at 25 percent of budget through the first half, except in a genuine injury emergency.",
          "Keep about 5 percent back for bye-week and injury coverage.",
        ],
      },
      {
        heading: "Your budget's real value is its market share",
        points: [
          "$1,000 in an 18-team league is 5.6 percent of the money on the table. The same $800 when the surviving field holds $5,000 total is 16 percent, nearly triple the buying power.",
          "Track every surviving team's balance. Your effective bid ceiling is one dollar over the richest rival, not an abstract percentage.",
          "Prices collapse as bidders disappear. In one tracked season, winning bids on Travis Kelce fell from $486 in September to $310 in October, $222 in November, and $53 in December.",
        ],
      },
      {
        heading: "Floor over ceiling, until it isn't",
        points: [
          "A player scoring a steady 12 to 14 every week beats one alternating 25 and 4. The four-point week can eliminate you outright.",
          "Favor secure roles, volume, and health over upside. Avoid touchdown-dependent deep threats and uncertain rookies early.",
          "Avoid stacking one NFL offense and avoid concentrated early byes. Weeks 5 and 6 are the usual trap.",
          "Flip to ceiling late. Survival thresholds climb through the year: roughly 85 PPR points can survive September, while December can require 120 and still lose.",
        ],
      },
      {
        heading: "The wire inverts",
        points: [
          "Every chop returns a full roster of drafted players while the number of bidders falls. This waiver wire gets richer as the season goes on, the opposite of redraft.",
          "Skip the traps: injured stars who cannot play now, boom-bust names facing bad short-term matchups, and one-week wonders. They usually return to the wire a week or two later, cheaper.",
        ],
      },
      {
        heading: "When to break the pacing rules",
        points: [
          "Spend when a purchase materially lowers this week's elimination risk, not because the calendar says so. FAAB is worth nothing after you are chopped.",
          "But do not panic. An average roster in an 18-team league carries about 5.6 percent weekly elimination risk, and a functional roster's early-week survival odds are above 90 percent.",
        ],
      },
      {
        heading: "How the bid card learns",
        points: [
          "Sleeper keeps every waiver bid in the league, the losing ones too. The card reads all of them each week, so it knows who bid on whom, how much, and what it took to win.",
          "Each rival gets a head-to-head score: when two or more managers chase the same player, how high do they go against the middle bid? A few bids are not enough to judge, so new or quiet bidders count as average.",
          "That score moves your bid. If a rival who pushes hard wants the same player, the bid goes up; if only soft bidders want him, it comes down. The change is capped (15 percent down, 25 percent up) and never goes past your walk-away.",
          "It grades our own bids: won or lost, by how much, what we paid over the runner-up, and what the player scored for us afterward.",
          "It saves each Tuesday card before waivers run, then replays it against the real bids under other rules (bid lower, bid higher, bid the walk-away) to see what each would have bought.",
          "It checks the chop odds against who actually got chopped, so you can see whether the risk numbers deserve trust.",
          "What it will not do on its own: change the strategy itself. One league and a dozen weeks is too few to prove a rule better, so the replays are shown to you and the call stays yours.",
          "All of it lives in \"What the room has taught us\" on the league's FAAB page.",
        ],
      },
    ],
    sources: [
      {
        label: "Fantasy Life, FAAB management in guillotine leagues",
        url: "https://www.fantasylife.com/articles/guillotine-leagues/how-to-manage-your-faab-in-guillotine-league-fantasy-football",
      },
      {
        label: "RotoWire, how much FAAB should you bid",
        url: "https://www.rotowire.com/football/article/guillotine-league-strategy-how-much-faab-should-you-bid-85174",
      },
      {
        label: "DraftSharks, best guillotine league strategy",
        url: "https://www.draftsharks.com/kb/best-guillotine-league-strategy",
      },
      {
        label: "Footballguys, a guide to guillotine leagues",
        url: "https://www.footballguys.com/article/2023-a-guide-to-guillotine-leagues",
      },
      {
        label: "Fantasy Index, FAAB strategies",
        url: "https://fantasyindex.com/2023/07/27/guillotine-leagues/faab-strategies",
      },
      { label: "GuillotineLeagues.com rules", url: "https://www.guillotineleagues.com/" },
    ],
  },
];

export function playbookFor(type: LeagueType): Playbook {
  return PLAYBOOKS.find((p) => p.type === type) ?? PLAYBOOKS[0];
}
