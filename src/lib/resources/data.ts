// Curated dynasty fantasy football resources, rendered by /resources.
// Edit this file to add, remove, or update entries. The page reads from
// RESOURCES, REDDITORS, and CATEGORIES below.
//
// Status flags are advisory and shown as colored badges:
//   "integrated"      = Hobby Hub already pulls data from this source
//   "free"            = freely accessible, no scraping required
//   "free_tier"       = has a useful free tier alongside paid
//   "paid"            = paid only
//   "scrape_required" = data only available by parsing HTML; fragile
//   "outdated"        = link or content known stale; verify before relying
//
// To add a category, add it to CATEGORIES and reference its key in entries.
// To pin a resource at the top of the page, set `featured: true`.

import type { LeagueType } from "@/lib/league/types";

export type ResourceStatus =
  | "integrated"
  | "free"
  | "free_tier"
  | "paid"
  | "scrape_required"
  | "outdated";

export type ResourceCategoryKey =
  | "weekly_rankings"
  | "start_sit"
  | "waiver_wire"
  | "projections"
  | "advanced_stats"
  | "injury_news"
  | "schedule"
  | "trade_calculators"
  | "trade_value_charts"
  | "trade_databases"
  | "trade_tracker"
  | "rankings"
  | "league_power_rankings"
  | "rookie_draft_prep"
  | "adp"
  | "mock_draft"
  | "survivor_tools"
  | "devy"
  | "apps"
  | "channels";

export interface Resource {
  name: string;
  url: string;
  category: ResourceCategoryKey;
  /**
   * Which league formats this is actually useful for. Rankings and strategy
   * diverge sharply between formats, so an untagged list is misleading: a
   * dynasty trade value chart is actively wrong for a redraft league.
   *
   * An empty array means the resource is not tied to any league format
   * (survivor pool tools, for example) and shows only under the All filter.
   */
  formats: LeagueType[];
  status?: ResourceStatus[];
  note?: string;
  featured?: boolean;
}

export interface ResourceCategory {
  key: ResourceCategoryKey;
  title: string;
  blurb?: string;
}

export interface Redditor {
  handle: string;
  url: string;
  posts: string;
  formats: LeagueType[];
  status?: ResourceStatus[];
  featured?: boolean;
}

export const CATEGORIES: ResourceCategory[] = [
  { key: "weekly_rankings", title: "Weekly rankings" },
  { key: "start_sit", title: "Start / sit" },
  { key: "waiver_wire", title: "Waiver wire + FAAB" },
  { key: "projections", title: "Projections" },
  {
    key: "advanced_stats",
    title: "Advanced stats",
    blurb:
      "Snap share, routes run, target share, and expected points. Where role changes show up before the box score does.",
  },
  { key: "injury_news", title: "Injury news + beat reporting" },
  { key: "schedule", title: "Schedule + byes" },
  { key: "trade_calculators", title: "Trade calculators" },
  { key: "trade_value_charts", title: "Trade value charts" },
  { key: "trade_databases", title: "Trade databases" },
  { key: "trade_tracker", title: "Trade trackers" },
  { key: "rankings", title: "Player rankings" },
  {
    key: "league_power_rankings",
    title: "League power rankings",
    blurb:
      "Useful for spotting trade fits. Hobby Hub computes this locally on the trade analyzer.",
  },
  { key: "rookie_draft_prep", title: "Rookie draft prep" },
  { key: "adp", title: "ADP" },
  { key: "mock_draft", title: "Mock draft" },
  { key: "survivor_tools", title: "Survivor pool tools" },
  { key: "devy", title: "Devy" },
  { key: "apps", title: "Apps" },
  { key: "channels", title: "YouTube + podcasts" },
];

export const RESOURCES: Resource[] = [

  // --- REDRAFT ---------------------------------------------------------
  // Rankings and strategy diverge sharply from dynasty, so none of the above
  // carries over. Sourced August 2026; every URL was checked before adding.
  {
    name: "Jingles Labs",
    url: "https://www.reddit.com/r/JoeInglesOfficial/",
    category: "weekly_rankings",
    formats: ["redraft"],
    status: ["integrated", "free"],
    featured: true,
    note: "Half-PPR redraft research, and redraft or guillotine only: none of it is a dynasty opinion, because a redraft rank is a bet on four months and a dynasty value is a bet on three years. The Lab 300 is his tiered top-300 ranking, version 2.0 posted 2026-08-30; Hobby Hub orders the redraft draft board by it. He also posts players he is high and low on versus ADP and single-player deep dives ending in a league-winner verdict. Updates often, so check the sub for anything newer than what Hobby Hub has pulled in. Also @JinglesLabs on TikTok, X, and Instagram.",
  },
  {
    name: "FantasyPros weekly half-PPR rankings",
    url: "https://www.fantasypros.com/nfl/rankings/half-point-ppr-flex.php",
    category: "weekly_rankings",
    formats: ["redraft", "guillotine"],
    status: ["free"],
    note: "Expert consensus baseline. Shows disagreement between rankers, which is the useful part.",
  },
  {
    name: "4for4 weekly rankings",
    url: "https://www.4for4.com/nfl",
    category: "weekly_rankings",
    formats: ["redraft", "guillotine"],
    status: ["paid"],
    note: "One coherent projection system instead of a consensus blend. Lite is about $39 a season.",
  },
  {
    name: "FantasyPros Who Should I Start",
    url: "https://www.fantasypros.com/nfl/start/",
    category: "start_sit",
    formats: ["redraft", "guillotine"],
    status: ["free"],
    note: "Fast head-to-head calls between two to four players.",
  },
  {
    name: "Fantasy Life waiver wire + FAAB calculator",
    url: "https://www.fantasylife.com/tools/waiver-wire",
    category: "waiver_wire",
    formats: ["redraft"],
    status: ["free_tier"],
    note: "Projected FAAB, weekly and rest-of-season ranks, matchup, and roster rates in one sortable view.",
  },
  {
    name: "Fantasy Life guillotine waiver wire",
    url: "https://www.fantasylife.com/tools/guillotine-league-waiver-wire",
    category: "waiver_wire",
    formats: ["guillotine"],
    status: ["free_tier"],
    note: "Built specifically for guillotine: the chopped roster hitting waivers each week is the whole game.",
  },
  {
    name: "FantasyPros waiver wire assistant",
    url: "https://www.fantasypros.com/nfl/myplaybook/waiver-wire-assistant.php",
    category: "waiver_wire",
    formats: ["redraft", "guillotine"],
    status: ["free_tier"],
    note: "Compares every available player against your actual roster and proposed drop.",
  },
  {
    name: "FTN waiver wire tool",
    url: "https://ftnfantasy.com/fantasy/nfl/waiver-wire-tool",
    category: "waiver_wire",
    formats: ["redraft", "guillotine"],
    status: ["free"],
    note: "Jeff Ratcliffe. Sortable, casts a wide net below 70% rostered, with suggested FAAB percentages.",
  },
  {
    name: "Establish The Run waiver analysis",
    url: "https://establishtherun.com/category/waiver-wire-analysis/",
    category: "waiver_wire",
    formats: ["redraft", "guillotine"],
    status: ["paid"],
    note: "Prioritized adds with explicit FAAB ranges rather than vague advice.",
  },
  {
    name: "Footballguys multi-site ADP",
    url: "https://www.footballguys.com/adp?season=2026",
    category: "adp",
    formats: ["redraft"],
    status: ["free"],
    note: "Compares ESPN, Yahoo, Sleeper, NFFC, FFPC, CBS side by side. Use the column matching your host, not the consensus.",
  },
  {
    name: "NFFC ADP",
    url: "https://nfc.shgn.com/adp/football",
    category: "adp",
    formats: ["redraft"],
    status: ["free"],
    note: "High-stakes market signal from drafters with money in. Includes min, max, and sample size.",
  },
  {
    name: "FantasyPros half-PPR ADP",
    url: "https://www.fantasypros.com/nfl/adp/half-point-ppr-overall.php",
    category: "adp",
    formats: ["redraft"],
    status: ["free"],
    note: "Matches this league's scoring directly.",
  },
  {
    name: "FantasyPros Draft Wizard",
    url: "https://draftwizard.fantasypros.com/football/mock-draft-simulator/",
    category: "mock_draft",
    formats: ["redraft"],
    status: ["free_tier"],
    note: "Fast solo mocks to test a draft slot repeatedly.",
  },
  {
    name: "Sleeper mock drafts",
    url: "https://sleeper.com/mockdraft",
    category: "mock_draft",
    formats: ["redraft"],
    status: ["free"],
    note: "Best option since your league is on Sleeper: same interface, unlimited mocks against people or CPU.",
  },
  {
    name: "Fantasy Points",
    url: "https://www.fantasypoints.com/",
    category: "advanced_stats",
    formats: ["redraft", "guillotine"],
    status: ["free_tier", "paid"],
    note: "Expected fantasy points, route share, target share, air yards, targets per route run.",
  },
  {
    name: "Fantasy Life utilization report",
    url: "https://www.fantasylife.com/nfl/utilization-report/season-stats",
    category: "advanced_stats",
    formats: ["redraft", "guillotine"],
    status: ["free_tier"],
    note: "Dwain McFarland. Routes, TPRR, aDOT, and backfield usage rolled into a readable weekly role-change view.",
  },
  {
    name: "FantasyPros snap count analysis",
    url: "https://www.fantasypros.com/nfl/reports/snap-count-analysis/",
    category: "advanced_stats",
    formats: ["redraft", "guillotine"],
    status: ["free"],
    note: "Free snaps, snap percentage, rush share, target share, and points per 100 snaps.",
  },
  {
    name: "RotoViz tools",
    url: "https://www.rotoviz.com/tools-2/",
    category: "advanced_stats",
    formats: ["redraft", "guillotine"],
    status: ["paid"],
    note: "Range-of-outcomes and similarity modeling. Good for judging how fragile a projection is.",
  },
  {
    name: "nflverse / nflreadr",
    url: "https://nflreadr.nflverse.com/",
    category: "advanced_stats",
    formats: ["dynasty", "redraft", "guillotine"],
    status: ["free"],
    note: "Raw open data if you want to build your own models. Snap counts back to 2012.",
  },
  {
    name: "32BeatWriters",
    url: "https://www.32beatwriters.com/",
    category: "injury_news",
    formats: ["dynasty", "redraft", "guillotine"],
    status: ["free_tier"],
    note: "Aggregates local beat reporters. Camp roles and depth chart changes surface here before national feeds.",
  },
  {
    name: "Rotoworld player news",
    url: "https://www.nbcsports.com/fantasy/football/player-news",
    category: "injury_news",
    formats: ["dynasty", "redraft", "guillotine"],
    status: ["free"],
    note: "Free news wire with the fantasy consequence spelled out in each blurb.",
  },
  {
    name: "Official NFL injury reports",
    url: "https://www.nfl.com/injuries/",
    category: "injury_news",
    formats: ["dynasty", "redraft", "guillotine"],
    status: ["free"],
    note: "Authoritative practice participation and game designations. Check here rather than trusting an aggregator's reading.",
  },
  {
    name: "Sports Injury Central",
    url: "https://sicscore.com/",
    category: "injury_news",
    formats: ["dynasty", "redraft", "guillotine"],
    status: ["free_tier"],
    note: "Medical read on likely limitation and reinjury risk, not just a questionable tag.",
  },
  {
    name: "FantasyPros strength of schedule",
    url: "https://www.fantasypros.com/nfl/strength-of-schedule.php",
    category: "schedule",
    formats: ["redraft", "guillotine"],
    status: ["free"],
    note: "Matters most for the fantasy playoff weeks.",
  },
  {
    name: "FantasyPros bye weeks",
    url: "https://www.fantasypros.com/nfl/bye-weeks.php",
    category: "schedule",
    formats: ["redraft", "guillotine"],
    status: ["free"],
    note: "Concentrated byes cost real games. Weeks 5 and 6 are the usual trap in guillotine.",
  },
  {
    name: "FantasyPros weekly projections",
    url: "https://www.fantasypros.com/nfl/projections/hppr-flex.php",
    category: "projections",
    formats: ["redraft", "guillotine"],
    status: ["free"],
  },
  {
    name: "Late-Round Fantasy Football",
    url: "https://lateround.com/shows/",
    category: "channels",
    formats: ["redraft"],
    status: ["free"],
    note: "JJ Zachariason. The most analytical redraft show: hit rates, roster construction, regression.",
  },
  {
    name: "The Fantasy Footballers",
    url: "https://www.thefantasyfootballers.com/",
    category: "channels",
    formats: ["redraft"],
    status: ["free"],
    note: "Best all-round home-league show. Rankings, starts and sits, waivers, trades.",
  },
  {
    name: "Harris Football",
    url: "https://www.harrisfootball.com/podcast/",
    category: "channels",
    formats: ["redraft"],
    status: ["free"],
    note: "Film-first counterweight to consensus and projections.",
  },
  {
    name: "CBS Fantasy Football Today",
    url: "https://www.youtube.com/fantasyfootballtoday",
    category: "channels",
    formats: ["redraft"],
    status: ["free"],
    note: "High frequency. Beyond the Box Score is the advanced-data version worth the time.",
  },
  // --- FEATURED (renders at the top of the page) ---
  {
    name: "RosterAudit",
    url: "https://rosteraudit.com",
    category: "trade_calculators",
    formats: ["dynasty"],
    status: ["integrated", "free"],
    featured: true,
    note: "Primary data source for Hobby Hub. Trade calculator, rankings, league hub, and free public API. Values include native TE-premium support matching this league's scoring.",
  },

  // --- Trade calculators ---
  {
    name: "FantasyCalc",
    url: "https://fantasycalc.com/trade-calculator",
    category: "trade_calculators",
    formats: ["dynasty"],
    status: ["free"],
    note: "Secondary value source kept in Hobby Hub for cross-reference on close trades.",
  },
  {
    name: "KeepTradeCut",
    url: "https://keeptradecut.com/trade-calculator",
    category: "trade_calculators",
    formats: ["dynasty"],
    status: ["scrape_required"],
    note: "Community-sourced values, de-facto standard. Has TE-premium variants (tep/tepp/teppp). Could be added later as a v3 secondary source.",
  },
  {
    name: "Dynasty-Daddy",
    url: "https://dynasty-daddy.com/trade-calculator",
    category: "trade_calculators",
    formats: ["dynasty"],
    status: ["free"],
  },
  {
    name: "RotoTrade",
    url: "https://www.rototrade.com/",
    category: "trade_calculators",
    formats: ["dynasty"],
    status: ["free"],
    note: "Site is anti-bot (returns 403 to scrapers).",
  },
  {
    name: "DynastyDealer",
    url: "https://www.dynastydealer.com/trade-calculator",
    category: "trade_calculators",
    formats: ["dynasty"],
    status: ["free"],
  },

  // --- Trade value charts ---
  {
    name: "The Score (NFL trade value chart)",
    url: "https://www.thescore.com/nflfan/news/3183571",
    category: "trade_value_charts",
    formats: ["dynasty"],
    status: ["free"],
  },
  {
    name: "FantasyPros (dynasty trade value, March 2025)",
    url: "https://www.fantasypros.com/2025/03/fantasy-football-rankings-dynasty-trade-value-chart-march-2025-update/",
    category: "trade_value_charts",
    formats: ["dynasty"],
    status: ["free", "outdated"],
    note: "Dated March 2025. Look for a current FantasyPros article instead.",
  },
  {
    name: "Draftsharks (dynasty PPR)",
    url: "https://www.draftsharks.com/trade-value-chart/dynasty/ppr",
    category: "trade_value_charts",
    formats: ["dynasty"],
    status: ["free"],
    note: "Has TE-premium and superflex variants embedded in the page.",
  },
  {
    name: "PeakedInHighSkool (charts)",
    url: "https://peakedinhighskool.com/dynasty-trade-value-charts/",
    category: "trade_value_charts",
    formats: ["dynasty"],
    status: ["free"],
  },

  // --- Trade databases ---
  {
    name: "FantasyCalc trade database",
    url: "https://fantasycalc.com/database",
    category: "trade_databases",
    formats: ["dynasty"],
    status: ["free"],
  },
  {
    name: "KeepTradeCut trade database",
    url: "https://keeptradecut.com/dynasty/trade-database",
    category: "trade_databases",
    formats: ["dynasty"],
    status: ["free"],
  },
  {
    name: "Dynasty-Daddy trade database",
    url: "https://dynasty-daddy.com/trade-database",
    category: "trade_databases",
    formats: ["dynasty"],
    status: ["free"],
  },

  // --- Trade trackers ---
  {
    name: "u/Repulsive_Repeat_681 trade tracker",
    url: "https://www.fantasyamp.com/streamlit/",
    category: "trade_tracker",
    formats: ["dynasty"],
    status: ["free"],
    note: "Maps Sleeper trades including rookie picks to the players they became.",
  },

  // --- Player rankings ---
  {
    name: "KeepTradeCut dynasty rankings",
    url: "https://keeptradecut.com/dynasty-rankings",
    category: "rankings",
    formats: ["dynasty"],
    status: ["free"],
  },
  {
    name: "Dynasty-Daddy fantasy rankings",
    url: "https://dynasty-daddy.com/fantasy-rankings",
    category: "rankings",
    formats: ["dynasty"],
    status: ["free"],
  },
  {
    name: "FantasyCalc dynasty rankings",
    url: "https://fantasycalc.com/dynasty-rankings",
    category: "rankings",
    formats: ["dynasty"],
    status: ["free"],
  },

  // --- League power rankings ---
  {
    name: "KeepTradeCut power rankings",
    url: "https://keeptradecut.com/dynasty/power-rankings",
    category: "league_power_rankings",
    formats: ["dynasty"],
    status: ["free"],
  },
  {
    name: "Dynasty-Daddy league rankings",
    url: "https://dynasty-daddy.com/fantasy-league-rankings",
    category: "league_power_rankings",
    formats: ["dynasty"],
    status: ["free"],
  },
  {
    name: "FantasyCalc league dashboard",
    url: "https://fantasycalc.com/league/dashboard",
    category: "league_power_rankings",
    formats: ["dynasty"],
    status: ["free"],
  },
  {
    name: "FantasyPros MyPlaybook",
    url: "https://www.fantasypros.com/nfl/myplaybook/",
    category: "league_power_rankings",
    formats: ["dynasty", "redraft", "guillotine"],
    status: ["free_tier"],
  },

  // --- Rookie draft prep ---
  {
    name: "Pahowdy's College Database",
    url: "https://docs.google.com/spreadsheets/d/19suThny5WpYuBpv7tKrLe6_qtj_j9DQxHA8vftjkRd0/edit?gid=224755041#gid=224755041",
    category: "rookie_draft_prep",
    formats: ["dynasty"],
    status: ["free"],
    note: "Advanced college stats spreadsheet.",
  },
  {
    name: "CFBNumbers QB Comparison Tool",
    url: "https://cfbnumbers.shinyapps.io/spiderapp/",
    category: "rookie_draft_prep",
    formats: ["dynasty"],
    status: ["free"],
  },
  {
    name: "FantasyCalc rookie rankings",
    url: "https://fantasycalc.com/rookies",
    category: "rookie_draft_prep",
    formats: ["dynasty"],
    status: ["free"],
    note: "Verify URL: FantasyCalc rookie page may live elsewhere.",
  },
  {
    name: "Dynasty Data Lab",
    url: "https://dynastydatalab.com/",
    category: "rookie_draft_prep",
    formats: ["dynasty"],
    status: ["free"],
    note: "ADP, rookie ADP, draft strategy, and trade tools.",
  },
  {
    name: "2026 Dynasty Rookie Big Board",
    url: "",
    category: "rookie_draft_prep",
    formats: ["dynasty"],
    status: ["outdated"],
    note: "Source unclear from notes, fill in URL when confirmed.",
  },

  // --- ADP ---
  {
    name: "FantasyCalc ADP",
    url: "https://www.fantasycalc.com/average-draft-position",
    category: "adp",
    formats: ["dynasty", "redraft", "guillotine"],
    status: ["free"],
    note: "Public website only; no clean public API endpoint for ADP.",
  },
  {
    name: "Dynasty Data Lab rookie ADP",
    url: "https://dynastydatalab.com/adp/rookie/",
    category: "adp",
    formats: ["dynasty"],
    status: ["free"],
    note: "Live rookie ADP across formats with heatmap.",
  },

  // --- Mock draft ---
  {
    name: "FantasyMocks",
    url: "https://fantasymocks.com/",
    category: "mock_draft",
    formats: ["dynasty"],
    status: ["free"],
  },
  {
    name: "FirstDownStudio (2027 early mock)",
    url: "",
    category: "mock_draft",
    formats: ["dynasty"],
    status: ["outdated"],
    note: "Couldn't find a canonical URL, fill in when confirmed.",
  },

  // --- Survivor pool tools ---
  {
    name: "Survivor Grid",
    url: "https://www.survivorgrid.com/",
    category: "survivor_tools",
    formats: [],
    status: ["free"],
    note: "Shows EV, Pick %, and Win % per team per week.",
  },
  {
    name: "Survivor Pick Planner",
    url: "https://footballsurvivor.pro/",
    category: "survivor_tools",
    formats: [],
    status: ["free"],
    note: "Plan picks across the entire NFL season.",
  },

  // --- Devy ---
  {
    name: "Saturday2Sunday Football",
    url: "https://saturday2sundayfootball.com/",
    category: "devy",
    formats: ["dynasty"],
    status: ["free"],
  },
  {
    name: "Campus2Canton",
    url: "https://campus2canton.com/",
    category: "devy",
    formats: ["dynasty"],
    status: ["free_tier"],
  },

  // --- Apps ---
  {
    name: "Dynasty Scout (iOS)",
    url: "https://apps.apple.com/us/app/dynasty-scout/id1567748321",
    category: "apps",
    formats: ["dynasty"],
    status: ["free_tier"],
    note: "League integration, trade calc, player profiler. iOS only.",
  },

  // --- YouTube + podcasts ---
  {
    name: "Fantasy Stock Exchange",
    url: "https://www.youtube.com/@FantasyStockExchange",
    category: "channels",
    formats: ["dynasty"],
    status: ["free"],
    note: "Mock drafts, start/sit, rankings. Hosts also publish at FlockFantasy.com.",
  },
];

export const REDDITORS: Redditor[] = [
  {
    handle: "r/fantasyfootball",
    url: "https://www.reddit.com/r/fantasyfootball/",
    posts:
      "The main sub. Fast news, AMAs, and recurring specialist rankings. Roster questions go in the index threads, not standalone posts.",
    formats: ["redraft"],
  },
  {
    handle: "u/Subvertadown",
    url: "https://www.reddit.com/user/Subvertadown/",
    posts:
      "Weekly DST and kicker streaming rankings built on matchup models. The best free answer to the two positions nobody wants to think about.",
    formats: ["redraft", "guillotine"],
  },
  {
    handle: "u/CoopThereItIs",
    url: "https://www.reddit.com/user/CoopThereItIs/",
    posts: "Weekly tight end rankings and streamers with real route and target upside.",
    formats: ["redraft", "guillotine"],
  },
  {
    handle: "u/KyonFantasyFootball",
    url: "https://www.reddit.com/user/KyonFantasyFootball/",
    posts:
      "Kyle Menton. Data-heavy PPR tiers, offensive line context, ADP value rankings, and rest-of-season trade guides.",
    formats: ["redraft"],
  },
  {
    handle: "u/PeakedInHighSkool",
    url: "https://www.reddit.com/user/PeakedInHighSkool",
    posts: "Nicely formatted trade value charts. Also at peakedinhighskool.com.",
    formats: ["dynasty", "redraft"],
  },
  {
    handle: "u/Repulsive_Repeat_681",
    url: "https://www.reddit.com/user/Repulsive_Repeat_681",
    posts: "Sleeper trade tracker tool that resolves rookie picks to actual players.",
    formats: ["dynasty"],
  },
  {
    handle: "u/I_dont_watch_film",
    url: "https://www.reddit.com/user/I_dont_watch_film",
    posts: "Data-driven player profiles.",
    formats: ["dynasty"],
  },
  {
    handle: "u/Backseat_Scout",
    url: "https://www.reddit.com/user/Backseat_Scout",
    posts: "Scouting profiles.",
    formats: ["dynasty"],
  },
  {
    handle: "u/broadly",
    url: "https://www.reddit.com/user/broadly",
    posts: "Prospect grades going back to 2018.",
    formats: ["dynasty"],
    status: ["outdated"],
  },
  {
    handle: "u/cjfreel",
    url: "https://www.reddit.com/user/cjfreel",
    posts:
      "Rookie rankings and tiers. See their Deeper Dive: docs.google.com/document/d/19dhWxrvY0MbI5j6T72pepI0oqeJMh0QpGgBoTBZhzBI",
    formats: ["dynasty"],
  },
  {
    handle: "u/Bobosbananas",
    url: "https://www.reddit.com/user/Bobosbananas",
    posts:
      "Rookie data back to 2011 for RBs and WRs (great for building your own model).",
    formats: ["dynasty"],
  },
  {
    handle: "u/FootballForteConnor",
    url: "https://www.reddit.com/user/FootballForteConnor",
    posts: "Prospect profiles via Football Forte.",
    formats: ["dynasty"],
  },
  {
    handle: "u/elboberto",
    url: "https://www.reddit.com/user/elboberto",
    posts: "Yearly custom auction value sheet.",
    formats: ["dynasty"],
  },
];
