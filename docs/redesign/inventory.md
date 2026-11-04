# Hobby Hub page inventory

Static read of src/app on branch redesign/hobby-hub, 2026-11-03. Written by Astra (read-only), reviewed by Claude. Line numbers refer to main at 9e56fb9.

Verified 38 `page.tsx` files, 8 `layout.tsx` files, and 12 files in `src/components`. Read-only inspection only. No files changed, no commits or pushes, and no .env files opened.

Counts include blank lines and comments. Inline components are included in their page’s count. Component-file counts are whole-file counts, not rendered-code counts. Data order below follows JSX order; conditional blocks appear only when their data exists.

`L` below means `/l/[leagueId]`. Shared navigation inherited from layouts is listed separately.

### /  (src/app/page.tsx)
- Data shown: introduction; league discovery errors/status; league cards with format, season, team count and status from `getMyLeagues`; tool cards for Strategy, Survivor, Picks and Resources.
- Main action: read, choose a league.
- Query params / tabs / sub-views: none. Links to `L`, `/strategy`, `/survivor`, `/picks`, `/resources`.
- Crowded or duplicated: tool cards repeat global navigation. League metadata repeats the league layout and `L`.
- Line count of the page file and its local components: 185; inline components included; no separate local component files.

### /today  (src/app/today/page.tsx)
- Data shown: date and issued-stake counts; “In play now” slips; “Next up” slips; model drivers and status legend; issued record/open exposure/ready-to-send counts. Sources: `getPicksReport`, `getNbaBoard`, `getNbaPicksView`, `stakedPropsToday`, `stakedNbaToday`, `scoreboard`, `findGame`; local `loadProducts` calls `getOurNflView`, `getOurFtdView`, `getOurNbaView`.
- Main action: bet, review the issued or upcoming position.
- Query params / tabs / sub-views: none. Football and NBA game links; market links carried by staked props; `/picks`, `/props`, `/records`.
- Crowded or duplicated: slips repeat betting boards; model drivers repeat their model-lineup sections; record repeats `/records`. The settled headline aggregates football reports, while open slips can include other sports/products.
- Line count of the page file and its local components: 320; inline `SlipCard`; shared `picks/board.tsx` 484, `picks/ui.tsx` 156. Imports helpers from `picks/nba/NbaView.tsx` 850 and `props/top.tsx` 404.

### /picks  (src/app/picks/page.tsx)
- Data shown: NFL header, filters and freshness warnings. Board: spread/straight-up/total game rows; NFL straight-up pool card; model lineup; season/week/rule/learner stats; budget/exposure disclosure; sources. Results: summary stats, issued performance, curves and weekly/game ledgers. Research: rule, tested cuts, baselines and own-model research. Log: model records, tracking progress, changes and cut comparisons. Sources: `getPicksReport`, `scoreboard`, `getPoolShares`, `getPoolTrack`, `redisStore.state/active/journal`; own-model records use `loadForecasts`, `closingLines`, `trackedGames`, `signalRecords`.
- Main action: bet.
- Query params / tabs / sub-views: `m=ats|su|ou`; `v=week|results|research|log`. `m=ftd` redirects to `/props?m=ftd`, preserving non-week `v`. Links to CFB/NBA/CBB boards, `/picks/model?l=nfl`, game details, `/learning`, external sources.
- Crowded or duplicated: issued results repeat `/records`; model method repeats `/picks/model`; learner status repeats `/learning`; pool and research details are secondary. Budget already uses a disclosure.
- Line count of the page file and its local components: 18; `PicksView` 307, `ats` 1,225, `su-totals` 546, `pool` 188, `ours` 93, `log` 125, `learning` 263, `model-records` 90, `game/GameStats` 50; shared `board` 484, `ui` 156.

### /picks/cfb  (src/app/picks/cfb/page.tsx)
- Data shown: same football structure as `/picks`, using CFB data. Research additionally includes John Harris and the college model. Sources: `getPicksReport("cfb")`, `scoreboard`, picks learner stores, `getCfbModelView`, Harris loaders used by `HarrisCard`.
- Main action: bet.
- Query params / tabs / sub-views: `m=ats|su|ou`; `v=week|results|research|log`. Links to other sport boards, `/picks/model?l=cfb`, football game details and `/learning`.
- Crowded or duplicated: records repeat `/records`; college-model research repeats `/picks/model?l=cfb`; source and cut histories overlap `/learning`.
- Line count of the page file and its local components: 15; football files listed for `/picks`; additionally `harris` 69 and `cfb-model` 135. NFL-only pool/own-spread branches are not rendered here.

### /picks/nba  (src/app/picks/nba/page.tsx)
- Data shown: header/filter controls; Board model lineup; record/rule/staking/learner stats; live/upcoming game table; background explanation. Results: performance summary, cumulative units, pending grading, weekly game records. Research: selected rules, cut comparisons, gate/staking criteria, own NBA model. Log: model records, tracking progress, changes and cut ranges. Sources: `getNbaBoard`, `getNbaPicksView`, `readNba`, `nbaBets`, `getNbaGameModelView`, `scoresAt`.
- Main action: bet.
- Query params / tabs / sub-views: `m=ats|su|ou`; `v=week|results|research|log`. Links to other sport boards and `/picks/nba/game?id=...`.
- Crowded or duplicated: current games repeat `/today`; Sam’s tracked spread record repeats `/records`; own-model records repeat game previews and research/log views; stake methodology could remain behind disclosure.
- Line count of the page file and its local components: 15; `NbaView` 850, `game-model` 108, `model-records` 90; shared `board` 484, `ui` 156.

### /picks/cbb  (src/app/picks/cbb/page.tsx)
- Data shown: header and sport/market/view controls. Board: priced/all filter, games with market versus model numbers, explanation. Results: record hero, slice table, signal records and latest graded games. Log: progress, latest changes and tested slices. Research: retrospective accuracy, opener/closing-edge cuts and model methodology. Sources: `getCbbBoard`, `getCbbRecord`, `signalsOf`, `graded`, `scoresAt`; static `backtest.json`.
- Main action: bet.
- Query params / tabs / sub-views: `m=ats|su|ou`; `v=week|results|research|log`; `show=priced|all`. Links to other sports and `/picks/cbb/bracket`. Board rows expand locally.
- Crowded or duplicated: slice tables repeat between Results and Log; game numbers repeat `/picks/cbb/game`; historical research is secondary to choosing today’s games.
- Line count of the page file and its local components: 16; `CbbView` 708; shared `board` 484, `ui` 156. Imports `nbaHref` from `NbaView` 850 without rendering that view.

### /picks/cbb/bracket  (src/app/picks/cbb/bracket/page.tsx)
- Data shown: field/source notice; pool/perfect controls; recommended champion, Final Four and payout/perfect-bracket summary; bracket graphic; upset picks or closest calls; under-picked/over-picked teams; full round-odds table; selected-team sheet; methodology disclosure. Sources: `getBracketField`, fallback `FIELD_FIXTURE`; `prepare`, `mostLikely`, `chalk`, `bestCandidate`, `poolValue`, `upsetRows`, `pickRows`.
- Main action: bet, choose a pool bracket.
- Query params / tabs / sub-views: `mode=pool|perfect`, `n` clamped to 2–10,000, `score` validated against `SCORING_IDS`, `pay=wta|top3`; team sheet is local state. Back to `/picks/cbb`.
- Crowded or duplicated: full odds and public-pick tables could be disclosures. Rating context overlaps CBB research. Method/loading copy says 2,000 simulations, while `T_SIMS` is 8,000.
- Line count of the page file and its local components: 73; `BracketView` 788, `Bracket` 286; shared `board` 484. Query parsing and optimizer worker are separate `.ts` helpers.

### /picks/game  (src/app/picks/game/page.tsx)
- Data shown: back link; game/call hero; market-versus-models; decision explanation and statistical boxes; rule tests; every matching tested cut; line history; every number; totals/straight-up disclosure; own projected score. Source: `getPicksReport`, with `coverRead` and other report-derived calculations.
- Main action: bet.
- Query params / tabs / sub-views: `l=nfl|cfb`, `g=AWAY@HOME`. Back to the corresponding spread board.
- Crowded or duplicated: board numbers repeat `/picks` or `/picks/cfb`; cut tests and line history are secondary detail. This full page differs materially from its modal.
- Line count of the page file and its local components: 83, including `OurScore`; `ats` 1,225, `GameStats` 50; shared `board` 484, `ui` 156.

### /picks/nba/game  (src/app/picks/nba/game/page.tsx)
- Data shown: back link; teams, timing and score; spread, total and straight-up sections with Sam’s statistical boxes and own-model boxes; own prop edges; underlying lines. Sources: `getNbaBoard`, `getNbaPicksView`, `getNbaGameModelView`, `getOurNbaView`, `ourBoxes`.
- Main action: bet.
- Query params / tabs / sub-views: `id`; back to `/picks/nba`, props link to `/props?m=nba`.
- Crowded or duplicated: game data repeats NBA board; prop edges repeat `/props?m=nba`; model records repeat NBA learner/research views.
- Line count of the page file and its local components: 31; `NbaGame` 72, `NbaOurStats` 43, `GameProps` 139, `OurStats` 61; uses rendering helpers in `NbaView` 850 and record helpers in `model-records` 90.

### /picks/cbb/game  (src/app/picks/cbb/game/page.tsx)
- Data shown: back link; teams, score/timing, projected score; spread, total and winner market comparisons with model-record boxes; “Behind the number.” Sources: `getCbbBoard`, `getCbbRecord`, `coverChance`, `overChance`, `ourBoxes`.
- Main action: bet.
- Query params / tabs / sub-views: `id`; back to `/picks/cbb`.
- Crowded or duplicated: repeats board projections and CBB model records; rating breakdown is secondary detail.
- Line count of the page file and its local components: 30; `CbbGame` 273, `OurStats` 61, shared `ui` 156.

### /picks/model  (src/app/picks/model/page.tsx)
- Data shown: sport controls; method hero; issued performance stats; ordered steps from model inputs to issued bet, including limits and sizing; recent learner changes; own NFL/CFB model card. Sources: `getPicksReport`, `redisStore.journal/state/active`, staking/limits/criteria constants; `loadForecasts`, `closingLines`, `signalRecords` or `getCfbModelView`.
- Main action: read.
- Query params / tabs / sub-views: `l=nfl|cfb`; links to the selected board, Research and Learner log.
- Crowded or duplicated: method/limits repeat betting-board disclosures; changes repeat learner logs; own-model card repeats Research.
- Line count of the page file and its local components: 138; `ours` 93, `cfb-model` 135; shared `board` 484, `ui` 156. Imports `leagueOf` from `learning` 263.

### /props  (src/app/props/page.tsx)
- Data shown: header and market/view controls; Board begins with model lineup. NFL/NBA props then show tracked-edge cards, expandable game tables, performance stats and gate disclosure. First TD/First Basket show betting-state hero, record/progress, edges and game tables. Anytime TD adds Sunday and night-game parlays, edges, games and records. Lottos shows nightly ticket, edge rungs, games and records. King of the Court shows recommended tag, summary stats, top tag candidates and top-30 table. King of the End Zone shows best value and game boards. NFL props additionally has David’s board disclosure; NBA props adds injury news. Results replaces boards with records, graded games and calibration/slice tables; Log shows progress, changes and cut comparisons; NFL Research shows David’s research.
- Main action: bet.
- Query params / tabs / sub-views: `m=pp|ftd|nba|fb|kotc|lotto|attd|kotez`; `v=week|results|research|log`. Research is exposed only for `pp`; other markets map requested Research to Results. KOTEZ Log states no learner exists. Game disclosures and parlay leg count are local controls. Links to learner views, `/learning` and external sources.
- Crowded or duplicated: records repeat `/records`; gates/status repeat `/learning`; individual player/game data repeats previews; David’s background board, staking tables, calibration and recipe comparisons are disclosure candidates, with several already folded.
- Line count of the page file and its local components: 15; `PropsView` 152, `top` 404, `week` 966, `davidprops` 366, `ournfl` 99, `ourftd` 214, `ournba` 386, `attd` 511, `lotto` 374, `kotc` 406, `kotez` 201, `news` 116, `learning` 196, `matchup` 44, `ParlayPicker` 67; shared `board` 484, `ui` 156.

The `/props` data sources, by market, are:

| Market | `src/lib` functions |
|---|---|
| NFL props | `getOurNflView`, `getPropsView`, `ourSliceBets`, `record`, `liveBox`, `tvByEvent` |
| NBA props / First Basket | `getOurNbaView`, `ourSliceBets`, `record`, `liveBox`, `tvByEvent`; NBA news uses `getNewsEvents` |
| First TD | `getOurFtdView`, `bestBets`, `bestCost`, `ftdEdge`, `kalshiCost`, `kalshiFor` |
| Anytime TD | `getOurFtdView`, `attdGraded`, `getAttdLearning`, `loadAttdParlays`, `loadNightParlays`, `loadVenomChances`, `loadVenomWeekPicks`, `attdEdges`, `summarizeAttd` |
| Lottos | `allBoards`, `getNbaSectionLearning`, `rungsOf`, `tickets`, `summarize`, `recipeRecords` |
| King of the Court | `getKotcNights`, `getOurNbaView`, `getNbaSectionLearning`, `fetchMostBet`, `bestTag`, `gradeTag`, `crowdMultiplier` |
| King of the End Zone | `getOurFtdView`, `loadKotez`, `kotezGame`, `tvByEvent`, `backers`, `payoutLine` |

### /props/player  (src/app/props/player/page.tsx)
- Data shown: back link; player/team/game header and overall edge summary; each market’s line, own projection/chance, David projection, historical distribution, recent outcomes and record; David-only markets; First TD block when present. Source: `loadPlayer`.
- Main action: bet.
- Query params / tabs / sub-views: `l=nfl|nba`, required `t` and `n`, optional `g`; back to `/props` or `/props?m=nba`.
- Crowded or duplicated: market projections repeat `/props`; repeated history/record blocks could use one expandable market-detail pattern.
- Line count of the page file and its local components: 31; `PlayerPreview` 249.

### /records  (src/app/records/page.tsx)
- Data shown: header; issued record/net/return/open stats; sortable settled bets; open bets; shadow-record disclosure covering NBA/NFL props, First Basket, First TD and Sam’s NBA spreads. Sources: `getPicksReport`, `getOurNbaView`, `getOurNflView`, `getOurFtdView`, `getNbaPicksView`, `ourSliceBets`, `record`; local `ftdBestRecord`.
- Main action: read.
- Query params / tabs / sub-views: no URL parameters; settled-table sorting is local state. Links to corresponding prop markets and NBA board.
- Crowded or duplicated: football issued records repeat Picks Results and Today. Shadow records repeat Props Results. Issued rows are assembled from NFL/CFB reports, so this is not yet a complete issued ledger for every product.
- Line count of the page file and its local components: 205; `RecordsTable` 131; shared `board` 484, `ui` 156; helper import from `props/week` 966.

### /learning  (src/app/learning/page.tsx)
- Data shown: learning explanation and forecast link; Football picks; college outside sources; own college models; public betting/line moves; NBA picks; Props. Each row shows the learning rule, live/collecting state and latest change. Sources: `redisStore.state`, `loadActivePolicy`, `sourceState`, `suInForce`, `getNbaPicksView`, `loadSection`.
- Main action: read.
- Query params / tabs / sub-views: none. Links to `/learning/forecast` and relevant Picks/Props Research, Results or Log views.
- Crowded or duplicated: per-section states repeat board/model-lineup and learner pages; long rule explanations could be disclosed beneath a compact status row.
- Line count of the page file and its local components: 247; inline helpers; imports formatting from `picks/ui` 156.

### /learning/forecast  (src/app/learning/forecast/page.tsx)
- Data shown: forecast explanation; four status totals; rules currently staking; five best go-live prospects; grouped forecasts for football picks, CFB/CBB models, NFL props/David/First TD/Anytime TD, NBA props/First Basket/Lottos/KOTC; quiet forecasts in disclosures. Sources: `getPicksCore`, `redisStore.state`, `getCfbModelView`, `getCbbRecord`, `getOurNflView`, `getPropsView`, `getOurFtdView`, `getAttdLearning`, `getOurNbaView`, `getNbaSectionLearning`, `forecast`, `byOutlook`.
- Main action: read.
- Query params / tabs / sub-views: none. Back to `/learning`; group links to corresponding Research, Results or Log views.
- Crowded or duplicated: live rules repeat `/today` and football boards; samples/status repeat learner pages. Quiet rows are already disclosed. NBA game-picks forecasts are not included in the assembled forecast groups.
- Line count of the page file and its local components: 326; inline `Row`; no separate local component file.

### /money  (src/app/money/page.tsx)
- Data shown: header, desk tabs and freshness/errors, followed by the selected desk. Overview: paper-dollar comparison table, units comparison table, chart disclosure, combined learner log. Phil: hero, stats, bankroll chart, open bets, categories, settled disclosure, learning/log. Kalshi: Gus’s same desk structure, then Phil’s shadow-learning/watch/radar/settled panels. Books: hero, totals, book charts, holdings, recent trades, learner log. Trends: hero/stats, book chart, picks, passed/over-cap disclosures, learner/slices, graded picks, holdings, playbook/review. Day Trader: hero/stats, SPY comparison, filter results, breakouts/open positions, recent trades, rule, skills and tax/log disclosures. Weather: hero/brake, stats, bankroll, slice learning, open bets, forecast board, learned calibration and settled results. Source: `getMoneyView`; intraday interpretation uses `intradayHead`, `filterRead`, `todayRows`, `openTrades`, `decidedOdds`.
- Main action: read.
- Query params / tabs / sub-views: `v=overview|phil|kalshi|books|trends|intraday|weather`. `bets` is hidden by `SHOW_BETS=false` and parses to Overview. Links to `/money/book/[id]`, `/picks`, `/props` and their result/log views.
- Crowded or duplicated: overview charts repeat each desk; book holdings/strategy repeat book detail; sports totals repeat `/records` and sport Results. Numerous logs/slices already use disclosures.
- Line count of the page file and its local components: 14; `MoneyView` 1,793, `desks` 399, `Chart` 100, `IntradayTab` 351, `Term` 34; shared `picks/board` 484 and `ui` 156.

### /money/book/[id]  (src/app/money/book/[id]/page.tsx)
- Data shown: back link; book performance hero; equity/return/drawdown stats; interactive equity/trade chart; strategy, exact rule and opening rationale; holdings/reasons; weekly grade; learner log. Source: `getMoneyView`; drawdown and display calculations are local.
- Main action: read.
- Query params / tabs / sub-views: dynamic book `id`, including the separate trend book. Chart inspection is local. Back to `/money?v=books` or `v=trends`; missing-book fallback links to Books.
- Crowded or duplicated: performance, holdings and learner entries repeat `/money`; full strategy belongs here, while the overview can stay compact.
- Line count of the page file and its local components: 175; `BookChart` 131, `desks` 399; shared `board` 484, `ui` 156.

### /l/[leagueId]  (src/app/l/[leagueId]/page.tsx)
- Data shown: league header/tools; My Team record, value, format-dependent dynasty grade/rank movement and position summary; roster with values/flags; standings; same-team/position conflict and drop candidates. Sources: Sleeper `getLeague`, `getUser`, `getLeagueRosters`, `getLeagueUsers`, `getAllPlayers`, `getLeagueMatchups`; `getValuesForProfile`, `getRosterGrades`, `getGradeHistory`, `rankMove`, `seasonResults`, `guillotineStandings`, `allPlayRecord`, `detectRosterConflicts`.
- Main action: read.
- Query params / tabs / sub-views: none. Links to `L/plan`, `/players`, `/draft`, `/trade`, `/scout/[userId]`, player profiles.
- Crowded or duplicated: roster/value data repeats Players, Trade and player profiles; record/position summaries repeat Plan; conflicts could be disclosed. Source contains an `after` callback to `recordGradeSnapshot`, so rendering this route is not necessarily read-only.
- Line count of the page file and its local components: 832; inline components included.

### /l/[leagueId]/lineup  (src/app/l/[leagueId]/lineup/page.tsx)
- Data shown: change/no-change headline and freshness; recommended slot swaps or pickup replacements; remaining free agents; injury/superflex issues; scoring-adjustment decisions; full lineup; source/scoring notes; historical advice scorecard. Sources: `buildWeeklyLineups`, `buildWaivers`, `mergePickups`, `readSeason`, `isSettled`, scorecard `season`.
- Main action: start.
- Query params / tabs / sub-views: none. Link to `L/waivers`.
- Crowded or duplicated: pickup suggestions repeat Waivers; roster repeats league home; scoring rationale and historical scorecard could be disclosed.
- Line count of the page file and its local components: 591; inline cards/table/scorecard included.

### /l/[leagueId]/waivers  (src/app/l/[leagueId]/waivers/page.tsx)
- Data shown: claim-opportunity headline, source/freshness/issues; players who would start this week; season upgrades; droppable players; source notes. Rows include research/Jingles/usage evidence, proposed drop and bid. Sources: `buildWaivers`, `usageText`.
- Main action: claim.
- Query params / tabs / sub-views: none; no dedicated internal route links in the page body.
- Crowded or duplicated: immediate starters repeat Lineup; season/value candidates overlap Players; detailed research/usage/bid reasoning could be expandable.
- Line count of the page file and its local components: 330; inline components included.

### /l/[leagueId]/faab  (src/app/l/[leagueId]/faab/page.tsx)
- Data shown: spend/selective/hold verdict and budget; chop-line graphic; ordered claim chains and worst-case spend; season budget plan/rival wallets; room learning; pacing; lineup/fragility/last-week/byes; field; local market prices; caveats/scoring notes. Source: `buildWeeklyReport`.
- Main action: claim.
- Query params / tabs / sub-views: none. Empty-state link to `L`.
- Crowded or duplicated: lineup repeats Lineup/home; field repeats standings; season plan and pacing repeat budget facts; room-learning tables, price estimates and caveats could be disclosures.
- Line count of the page file and its local components: 762; `ChopLine` 164, `Learning` 205.

### /l/[leagueId]/plan  (src/app/l/[leagueId]/plan/page.tsx)
- Data shown: league/format header; format strategy summary; dynasty trajectory when applicable and current phase; live progress/value/rank/draft-slot/record/weakest/strongest metrics; automatic goals; custom goals; key dates. Sources: Sleeper league/user/draft/roster/player loaders, `getValuesForProfile`, `getRosterGrades`, `computeTeamSummaries`, `inferTrajectory`, `currentPhase`, `buildGoals`, `keyDates`, `STRATEGY_SUMMARY`.
- Main action: read.
- Query params / tabs / sub-views: none. Back to `L`; custom goals use local storage.
- Crowded or duplicated: value/record/position facts repeat home and Trade; format explanation repeats `/strategy`; dates and completed goals could be disclosed.
- Line count of the page file and its local components: 497; `CustomGoals` 168.

### /l/[leagueId]/draft  (src/app/l/[leagueId]/draft/page.tsx)
- Data shown: dynasty branch: draft status/refresh; completed-draft grade when applicable; next pick; owned picks; position needs; recommendations; available rookies; drafted-team value summary; round targets; latest picks. Sources: `getLeagueDrafts`, `getDraftPicks`, `getTradedPicks`, Sleeper roster/player/user/league loaders, `getValuesForProfile`, `getAllPicks`, `getKTCValues`, `buildRecommendations`. Redraft/guillotine branch: draft header/Jingles context; projected owned picks; starting-slot coverage; top recommendations; Jingles versus ADP; best available, using `activeLab`, `buildLiveBoard` and redraft-board calculations.
- Main action: claim, choose the next draft selection.
- Query params / tabs / sub-views: format-driven branch; rookie-list filters and refresh controls. Links to `L`, `L/draft/board`, player profiles and research sources.
- Crowded or duplicated: owned/latest picks repeat draft board; available/recommended/round-target player lists overlap; grade/value summaries repeat within this page and league home.
- Line count of the page file and its local components: 1,056; `Recommendations` 177, `RookieList` 170, `RoundTargets` 271, `RedraftDraft` 663.

### /l/[leagueId]/draft/board  (src/app/l/[leagueId]/draft/board/page.tsx)
- Data shown: draft status and refresh controls; full round-by-team pick grid with player portraits, positions and pick/value context. Sources: Sleeper league/user/drafts/rosters/users/players/picks/traded-picks loaders, `getAllPicks`, `getValuesForProfile`, `profileFromSleeper`.
- Main action: read.
- Query params / tabs / sub-views: none; auto-refresh pause/resume. Back to `L/draft`; player links; error-state `/`.
- Crowded or duplicated: picks repeat Draft’s owned/latest-picks blocks. The grid is appropriately separated from recommendations.
- Line count of the page file and its local components: 410; inline helpers included.

### /l/[leagueId]/trade  (src/app/l/[leagueId]/trade/page.tsx)
- Data shown: header; Jingles valuation context when applicable; ready-to-copy offers; more trade ideas disclosure; partner selection; position rankings; trade fits; selected-package summary/verdict/levelers; outgoing player/pick/FAAB controls; incoming roster or league-wide matches. Sources: Sleeper loaders, `getValuesForProfile`, `getAllPicks`, `activeLab`, `latestWaivers`, `blendWithJingles`, `computeTeamSummaries`, `markUntouchables`, `suggestTradeFits`, `findBestTrades`, `evaluateTrade`, `tradeOffers`.
- Main action: claim, choose an acquisition package; “trade” is the more accurate verb outside the supplied vocabulary.
- Query params / tabs / sub-views: local partner/anyone mode, position filters, selections, pick/FAAB controls; session-storage persistence. Back to `L`; player-profile links.
- Crowded or duplicated: offers and more ideas overlap; full roster/value lists repeat home/Players; position rankings repeat Plan; levelers and match tiers are already expandable.
- Line count of the page file and its local components: 173; `TradeBuilder` 1,871, `Offers` 106.

### /l/[leagueId]/players  (src/app/l/[leagueId]/players/page.tsx)
- Data shown: roster-fit free agents; risers; fallers; searchable player list with owner/value/rank context. Sources: Sleeper loaders, `getValuesForProfile`, `computeTeamSummaries`, `moversFromValues`, `startablePositions`, `isStartableIn`; Jingles static data.
- Main action: claim.
- Query params / tabs / sub-views: local text and position filters; no query parameters. Back to `L`; player profiles.
- Crowded or duplicated: waiver fits overlap Waivers/Lineup; movers can recur in search results; player values repeat home and Trade.
- Line count of the page file and its local components: 410; `PlayerSearch` 192.

### /l/[leagueId]/movers  (src/app/l/[leagueId]/movers/page.tsx)
- Data shown: none; redirects to `L/players`.
- Main action: read, through the destination.
- Query params / tabs / sub-views: no consumed query parameters; redirect destination is hardcoded.
- Crowded or duplicated: compatibility route for functionality consolidated into Players.
- Line count of the page file and its local components: 15; none.

### /l/[leagueId]/player/[id]  (src/app/l/[leagueId]/player/[id]/page.tsx)
- Data shown: player identity/biography/flags; value, trends and league ownership; Jingles call; dynasty KTC cross-check; recent news; dynasty value-history chart; recent weekly stats; similarly valued players; attribution. Sources: `getPlayerProfile`, `getPlayerStats`, `getPlayerNews`, `getKTCValues`, `getValuesForProfile`, Sleeper league/roster/user/player loaders; Jingles static data.
- Main action: read.
- Query params / tabs / sub-views: dynamic player `id`; format-gated dynasty sections. Back to `L`; similar-player routes; news/source links.
- Crowded or duplicated: value/ownership repeats Players/home; Jingles call repeats draft/player-list badges; biography, historical chart and weekly stats are secondary to the headline decision.
- Line count of the page file and its local components: 591; `ValueChart` 186.

### /l/[leagueId]/scout/[userId]  (src/app/l/[leagueId]/scout/[userId]/page.tsx)
- Data shown: manager identity; career record/seasons/championships/playoffs; current league state/grade; repeatedly rostered players (“Crushes”); NFL-team fandom; other leagues; attribution. Sources: `getManagerHistory`, `getRosterGrades`, `getUserLeagues`, `getLeagueRosters`, `getLeagueUsers`, `getAllPlayers`, `getValuesForProfile`.
- Main action: read.
- Query params / tabs / sub-views: dynamic `userId`; no query parameters. Back to `L`; player links; external RosterAudit.
- Crowded or duplicated: current state repeats league standings; holdings overlap roster/Trade. Other-league and fandom evidence could be disclosed.
- Line count of the page file and its local components: 404; inline helpers included.

### /survivor  (src/app/survivor/page.tsx)
- Data shown: report error if any; pool selector/status/settings; eliminated, saved-pick or recommended-pick state; safest alternative and warnings; field/pick-history logging and board ingestion; other candidates; future path; used-team grid; strategy articles; survivor resources. Sources: `buildReports`, `parsePickPaste`, `formatPickPaste`, static `STRATEGY_ARTICLES`, filtered `RESOURCES`.
- Main action: bet, choose the survivor team.
- Query params / tabs / sub-views: pool, settings, week-to-log, alternatives and used-team selections are local state. Save/read operations target survivor APIs. External strategy/tool links.
- Crowded or duplicated: strategy/resources overlap `/strategy` and `/resources`; field logging, screenshot ingestion, settings and future-path detail compete with the weekly pick.
- Line count of the page file and its local components: 113; `SurvivorTool` 1,408.

### /strategy  (src/app/strategy/page.tsx)
- Data shown: introduction; dynasty, redraft and guillotine playbooks, each with thesis, principle cards and sources. Source: static `PLAYBOOKS`, `LEAGUE_TYPE_LABEL`.
- Main action: read.
- Query params / tabs / sub-views: none; external source links.
- Crowded or duplicated: format summaries repeat `L/plan`; all three formats could become tabs/disclosures.
- Line count of the page file and its local components: 98; no separate local components.

### /resources  (src/app/resources/page.tsx)
- Data shown: introduction; format filters/counts; featured resources; category anchors; category resource cards with status/notes; Redditor directory. Sources: static `RESOURCES`, `CATEGORIES`, `REDDITORS`.
- Main action: read.
- Query params / tabs / sub-views: `format=all|dynasty|redraft|guillotine`; category anchors; external resource/profile links.
- Crowded or duplicated: survivor resources repeat `/survivor`; many category cards are secondary directory detail and could collapse.
- Line count of the page file and its local components: 290; inline `ResourceCard`/`StatusBadge` included.

### /picks/game  (src/app/@modal/(.)picks/game/page.tsx)
- Data shown: modal team/score header; spread/total call summaries; market comparisons; calls; rule statistical boxes; own spread/total/winner record boxes; NFL prop edges; full-breakdown link. Sources: `getPicksReport`; own-record helpers use `loadForecasts`, `closingLines`, `signalRecords`, `getCfbModelView`; NFL props use `getOurNflView`.
- Main action: bet.
- Query params / tabs / sub-views: `l=nfl|cfb`, `g`; close/Escape/backdrop invokes history back. Full-breakdown anchor loads `/picks/game`; NFL props link to `/props?m=pp`.
- Crowded or duplicated: repeats board and full-page data, but adds own-model statistical boxes and NFL props absent from the full page.
- Line count of the page file and its local components: 18; `GamePreview` 218, `GameStats` 50, `FootballOurStats` 82, `OurStats` 61, `GameProps` 139; shared `Modal` 58.

### /picks/nba/game  (src/app/@modal/(.)picks/nba/game/page.tsx)
- Data shown: the same NBA game preview as the full route, inside `Modal`. Sources: `getNbaBoard`, `getNbaPicksView`, `getNbaGameModelView`, `getOurNbaView`.
- Main action: bet.
- Query params / tabs / sub-views: `id`; history-back close; props link to `/props?m=nba`.
- Crowded or duplicated: same preview content as full-page NBA game and repeated board/props records.
- Line count of the page file and its local components: 17; `NbaGame` 72, `NbaOurStats` 43, `GameProps` 139, `OurStats` 61, `Modal` 58.

### /picks/cbb/game  (src/app/@modal/(.)picks/cbb/game/page.tsx)
- Data shown: the same CBB game preview as the full route, inside `Modal`. Sources: `getCbbBoard`, `getCbbRecord`, `coverChance`, `overChance`, `ourBoxes`.
- Main action: bet.
- Query params / tabs / sub-views: `id`; history-back close.
- Crowded or duplicated: full-page preview and CBB board/model records.
- Line count of the page file and its local components: 16; `CbbGame` 273, `OurStats` 61, `Modal` 58.

### /props/player  (src/app/@modal/(.)props/player/page.tsx)
- Data shown: the same player market/history preview as the full route, inside `Modal`. Source: `loadPlayer`.
- Main action: bet.
- Query params / tabs / sub-views: `l`, `t`, `n`, optional `g`; history-back close.
- Crowded or duplicated: full player-props route and market boards.
- Line count of the page file and its local components: 13; `PlayerPreview` 249, `Modal` 58.

### /[...catchAll]  (src/app/@modal/[...catchAll]/page.tsx)
- Data shown: none; returns `null` to clear the modal slot.
- Main action: read, no standalone decision.
- Query params / tabs / sub-views: matches other navigation in the parallel slot; not an independent content destination.
- Crowded or duplicated: none.
- Line count of the page file and its local components: 4; none.

The eight layouts:

| File | Lines | Data/UI and navigation |
|---|---:|---|
| `src/app/layout.tsx` | 126 | Forced dark document; sticky brand/home link, section tabs, HeaderSearch; conditional Fantasy/Hobby tabs; content; source-attribution footer; modal slot. Inline `BrandMark`, `SiteHeader`, `SiteFooter`. |
| `src/app/l/[leagueId]/layout.tsx` | 100 | `resolveLeague`, `getMyLeagues`, `toolsFor`, `valueSourceFor`; league switcher, format-specific tool tabs and valuation-source link. Unknown league calls `notFound`. Manual leagues replace child content with a notice linking `/strategy`; connected leagues receive `LeagueTypeProvider`. |
| `src/app/today/layout.tsx` | 4 | Flex-column wrapper; no data or links. |
| `src/app/picks/layout.tsx` | 4 | Flex-column wrapper; no data or links. |
| `src/app/props/layout.tsx` | 4 | Flex-column wrapper; no data or links. |
| `src/app/records/layout.tsx` | 4 | Flex-column wrapper; no data or links. |
| `src/app/learning/layout.tsx` | 4 | Flex-column wrapper; no data or links. |
| `src/app/money/layout.tsx` | 4 | Flex-column wrapper; no data or links. |

Also present: `src/app/@modal/default.tsx`, 4 lines, returns `null`; `src/app/l/[leagueId]/loading.tsx`, 27 lines, league loading UI. Neither is a page or layout.

Components in `src/components`:

| File / exports | Lines | Pages using the rendered component |
|---|---:|---|
| `SiteNav.tsx`: `SectionTabs`, `FantasyTabs`, `HobbyTabs` | 125 | Every page through root layout; secondary tabs render conditionally. |
| `HeaderSearch.tsx` | 125 | Every page through root layout; result links come from `/api/search`, fallback `/today`. |
| `LeagueSwitcher.tsx` | 145 | All `L` routes through league layout. |
| `LeagueTypeProvider.tsx`, `useLeagueType` | 30 | All connected `L` routes through layout; consumed by `PlayerLink`. |
| `NavLink.tsx` | 42 | All `L` routes through league tool navigation. |
| `Modal.tsx` | 58 | Four intercepting game/player pages; not catch-all/default. |
| `AutoRefresh.tsx` | 59 | `/today`; `/picks`, `/picks/cfb` during live board views; `L/draft`, `L/draft/board`; applicable `/props` board branches. |
| `RefreshButton.tsx` | 74 | `/`; `L`, `L/draft`, `L/draft/board`, `L/faab`, `L/plan`, `L/players`, `L/scout/[userId]`, `L/trade`. |
| `PlayerAvatar.tsx` | 71 | `L`, Draft including child lists, Draft board, Players/Search, player profile/similar players, Scout, TradeBuilder. |
| `PlayerLink.tsx`, inline `JinglesRank` | 87 | `L`, Draft and children, Draft board, Players/Search, Scout, TradeBuilder/Offers. Player-profile similar links are implemented directly. |
| `JinglesBadge.tsx`: `JinglesBadge`, `JinglesCallCard` | 114 | Badge: `L/players` mover rows. Full call: `L/player/[id]`. Format-gated. |
| `TeamLogo.tsx`, `teamLogoUrl` | 45 | `/today`; football/NBA/CBB boards through `GameCell` or direct markup; game pages/modal previews; CBB bracket; `/props` matchup rows; player-props page/modal. Survivor uses its own logo component. |

Import reachability is broader than rendered usage: for example `/records` imports a helper from `props/week.tsx`, but does not render that module’s `AutoRefresh`; importing `ui.tsx` for formatting does not necessarily render `TeamLogo`.

Ledger styling:

- No `page.tsx` or section layout directly imports `ledger-look.css`.
- `src/app/globals.css:2` imports it; `src/app/layout.tsx:6` imports globals. Every rendered route inherits it.
- Its only specifically named ledger class, `.ledger-brand`, is used at `src/app/layout.tsx:36`, so it appears in every route’s shell.
- It also targets `.tabular-nums`, uppercase tracking combinations, heading-size/tracking classes and `.bg-clip-text`, plus global palette/radius/shadow variables.
- Direct Tailwind-heavy consumers include `/`, all league content pages, `/survivor`, `/strategy`, `/resources`; betting/Money/Results/Learning pages principally use CSS modules, while their shell and some children still consume the global overrides.
- Modal catch-all/default render no styled content of their own.

1. Proposed hub mapping

| Route | Proposed hub | Fit |
|---|---|---|
| `/` | Today | Poor: currently a Fantasy league directory, with no Today betting rundown. |
| `/today` | Today | Good. |
| `/picks` | Bets | Board fits; Results/Research/Log cross into Results. |
| `/picks/cfb` | Bets | Same cross-hub subviews. |
| `/picks/nba` | Bets | Same cross-hub subviews. |
| `/picks/cbb` | Bets | Same cross-hub subviews. |
| `/picks/cbb/bracket` | Bets | Qualified: pool optimization, not a conventional wager board. |
| `/picks/game`, including modal | Bets | Good. |
| `/picks/nba/game`, including modal | Bets | Good. |
| `/picks/cbb/game`, including modal | Bets | Good. |
| `/picks/model` | Results | Qualified: predominantly methodology, with results and change history. Overrides `/picks/*`. |
| `/props` | Bets | Board fits; Results/Research/Log cross into Results; some promos are projection-only. |
| `/props/player`, including modal | Bets | Good. |
| `L` | Fantasy | Good. |
| `L/lineup` | Fantasy | Good. |
| `L/waivers` | Fantasy | Good. |
| `L/faab` | Fantasy | Good; FAAB is fantasy currency, not Money desk reporting. |
| `L/plan` | Fantasy | Good. |
| `L/draft` | Fantasy | Good. |
| `L/draft/board` | Fantasy | Good. |
| `L/trade` | Fantasy | Good. |
| `L/players` | Fantasy | Good. |
| `L/movers` | Fantasy | Redirect only. |
| `L/player/[id]` | Fantasy | Good. |
| `L/scout/[userId]` | Fantasy | Good. |
| `/survivor` | Fantasy | Poor semantic fit: pool-entry decision tool; current nav explicitly separates it from fantasy leagues. |
| `/strategy` | Fantasy | Good. |
| `/resources` | Fantasy | Mostly good; includes survivor/general tools. |
| `/money` | Money | Good overall; sports performance and learner logs cross into Results. |
| `/money/book/[id]` | Money | Good. |
| `/records` | Results | Good, but issued coverage is narrower than the all-product label suggests. |
| `/learning` | Results | Good for model evaluation. |
| `/learning/forecast` | Results | Qualified: prospective readiness rather than settled results. |
| Modal catch-all | None | Routing infrastructure; follows the destination’s hub. |

2. Current navigation and hardcoded route links

`SiteNav.tsx` has three top-level sections, despite an older comment saying five:

| Top level | Destination | Ownership |
|---|---|---|
| Fantasy | `/` | Exact `/`, or `/strategy`, `/resources`, `/l` and descendants |
| Survivor | `/survivor` | Exact route or descendants |
| Hobby | `/today` | Any Hobby-tab route or descendant |

Hobby sub-tabs: Today, Picks, Props, Records, Money, Learning.

Fantasy sub-tabs: Leagues, Strategy, Resources. Leagues owns `/` and `/l/*`.

Active state uses `usePathname`, with exact-or-`base + "/"` prefix matching. Query parameters do not affect these global tabs. Consequently, `/picks/model` activates Hobby > Picks. Modal URLs activate the target section even while the underlying page remains visible.

League tools, from `src/lib/league/tools.ts:17`: League, Lineup, Plan, Draft, Trade, FAAB, Waivers, Players. Trade and Waivers apply to dynasty/redraft; FAAB to guillotine; others to all formats. `NavLink` uses exact matching for league home and prefix matching for tools. League switching preserves a supported top-level tool, but drops detail IDs.

Hardcoded internal-route construction sites are below. Paths are relative to `src/`; each listed line is a route literal, route builder or redirect. Variable-only consumers of these builders are described with their parent view.

| File:line | Destination(s) |
|---|---|
| `components/SiteNav.tsx:18` | Top-level section definitions; `/`, `/survivor`, `/today` |
| `components/SiteNav.tsx:27` | Hobby routes `/today`, `/picks`, `/props`, `/records`, `/money`, `/learning` |
| `components/SiteNav.tsx:38` | Fantasy routes `/`, `/strategy`, `/resources` |
| `components/HeaderSearch.tsx:102` | Search-result href, fallback `/today` |
| `components/PlayerLink.tsx:48` | `L/player/[id]` |
| `lib/league/tools.ts:17,49` | Tool segments and `leaguePath` builder |
| `components/LeagueSwitcher.tsx:34` | Uses tool definitions and `leaguePath` for switch destinations |
| `app/layout.tsx:34` | `/` brand link |
| `app/page.tsx:32,39,45,51,118` | Strategy, Survivor, Picks, Resources, league home |
| `app/l/[leagueId]/layout.tsx:21,69` | Strategy; generated league tools |
| `app/l/[leagueId]/page.tsx:349,355,361,367,707` | Plan, Players, Draft, Trade, Scout |
| `app/l/[leagueId]/lineup/page.tsx:506` | Waivers |
| `app/l/[leagueId]/movers/page.tsx:14` | Redirect to Players |
| `app/l/[leagueId]/faab/page.tsx:480` | League home |
| `app/l/[leagueId]/draft/page.tsx:41,452,464` | `/`, league home, draft board |
| `app/l/[leagueId]/draft/RedraftDraft.tsx:169` | League home |
| `app/l/[leagueId]/draft/board/page.tsx:31,240` | `/`, Draft |
| `app/l/[leagueId]/plan/page.tsx:93,252` | `/`, league home |
| `app/l/[leagueId]/players/page.tsx:41,265` | `/`, league home |
| `app/l/[leagueId]/player/[id]/page.tsx:34,165,546` | `/`, league home, similar-player profile |
| `app/l/[leagueId]/scout/[userId]/page.tsx:39,160` | `/`, league home |
| `app/l/[leagueId]/trade/page.tsx:33,144` | `/`, league home |
| `app/today/page.tsx:74,87,296,306,313` | Football games, Picks, Props, Records |
| `app/picks/ui.tsx:43` | NFL/CFB market/view URL builder |
| `app/picks/PicksView.tsx:47,50,104` | NBA, CBB, model explanation; remaining tabs use `href` |
| `app/picks/page.tsx:16` | Legacy FTD redirect |
| `app/picks/ats.tsx:144` | Football `gameHref`; consumed by board and preview |
| `app/picks/game/page.tsx:69` | Board back link through `href` |
| `app/picks/game/GamePreview.tsx:213` | Full-game anchor through `gameHref` |
| `app/picks/game/GameProps.tsx:131,138` | NBA/NFL props |
| `app/picks/nba/NbaView.tsx:39,46,732` | NBA game/view builders, CBB; other sport links use shared builder |
| `app/picks/nba/game/page.tsx:24` | NBA board |
| `app/picks/cbb/CbbView.tsx:132,666` | CBB view builder, bracket |
| `app/picks/cbb/game/page.tsx:23` | CBB board |
| `app/picks/cbb/bracket/page.tsx:44` | CBB board |
| `app/picks/cbb/bracket/BracketView.tsx:171` | Replaces current query using `toQuery` |
| `app/picks/model/page.tsx:46,50,109,111` | Model sport URLs; board/research/log via shared builder |
| `app/picks/learning.tsx:162` | `/learning` |
| `app/props/PropsView.tsx:45` | Props market/view builder |
| `app/props/player/page.tsx:24` | NFL/NBA props back link |
| `app/props/learning.tsx:62` | `/learning` |
| `app/props/week.tsx:508,562,759,941` | NBA/NFL/FB/FTD learner logs |
| `app/props/attd.tsx:432` | Anytime TD log |
| `app/props/lotto.tsx:242` | Lotto log |
| `app/records/page.tsx:88,90,94,98,101` | NBA props, FB, NFL props, FTD, NBA picks |
| `app/learning/page.tsx:119,132,142,148,160,170,171,178,186–193,209` | Section research/results/log destinations and forecast |
| `app/learning/forecast/page.tsx:80,104,127,190–199,215` | Football boards/research, CBB log, prop results/research/logs, Learning |
| `app/money/MoneyView.tsx:36,139,372,527,842,1492,1515` | Money tabs, Picks Results, book details, Picks, Props |
| `app/money/desks.tsx:93,115,118,134,154,176,179,196,323` | Desk tabs, sports Results and learner logs |
| `app/money/book/[id]/page.tsx:48,67` | Books/Trends back links |
| `app/resources/page.tsx:139` | Format-filter URLs |
| `app/api/search/route.ts:46,50` | Football game and NFL player-props result URLs |
| `lib/search/sports.ts:68,129,187` | NBA/CBB game and NBA player-props result URLs |

Additional route links generated outside page UI:

| File:line | Destination(s) |
|---|---|
| `lib/guillotine/email.ts:215` | League FAAB |
| `lib/midweek/email.ts:199,216` | League FAAB; app root |
| `lib/sunday/email.ts:214,215,255` | App root; Survivor |
| `lib/thursday/email.ts:512,513,573` | App root; Survivor |
| `lib/picks/email.ts:222,290,453,479` | NFL/CFB boards; Picks |
| `lib/picks/pool-watch.ts:44` | Picks |
| `lib/picks/run.ts:206` | Picks |
| `lib/models/nfl/ftd-store.ts:374,409` | Anytime TD |
| `lib/notify/golive.ts:86,115` | Props; `/picks?l=nba` |
| `lib/props/staked-core.ts:304,320,356,397,431,451,490,525` | FTD, ATTD, FB, Lotto, KOTC, `/picks?l=nba` |
| `lib/props/staked.ts:103,109,122,128,214,224` | NFL/NBA props |

Notable destination mismatches:

- `lib/notify/golive.ts:115` and `lib/props/staked-core.ts:525` use `/picks?l=nba`. `/picks/page.tsx` ignores `l` and renders NFL.
- Learning’s NBA totals research link omits `m=ou`.
- Learning and Forecast First Basket links use `m=nba&v=results`, which renders NBA player-prop results; First Basket has `m=fb`.
- `/resources` and strategy/source links also contain many external URLs; these are not app-route links.
- Backend fetch paths such as RosterAudit’s `/picks` are external API endpoints, not app navigation.

3. Repeated UI patterns and shared-component candidates

| Pattern | File:line examples | Candidate |
|---|---|---|
| Page heading, freshness and controls | `app/picks/board.tsx:20`; `app/picks/PicksView.tsx:78`; `app/money/MoneyView.tsx:1726` | Existing `PageHead` already provides the base; extend consistently rather than duplicate. |
| Section headings | `app/picks/board.tsx:43`; `app/today/page.tsx:296`; `app/props/attd.tsx:415` | Existing `SecHead`; Fantasy has separate eyebrow implementations. |
| Summary metric grids | `app/picks/board.tsx:72`; `app/l/[leagueId]/faab/page.tsx:68`; `app/survivor/SurvivorTool.tsx:91`; `app/l/[leagueId]/plan/page.tsx:338` | Shared metric cell with value, label, hint and tone. |
| Bordered cards | `app/strategy/page.tsx:54`; `app/l/[leagueId]/trade/TradeBuilder.tsx:847`; `app/learning/page.tsx:224` | Card surface/spacing primitives; retain different content layouts. |
| Status/format/position pills | `components/LeagueSwitcher.tsx:134`; `components/JinglesBadge.tsx:60`; `app/l/[leagueId]/lineup/page.tsx:30`; `app/picks/ui.tsx:69` | Shared pill primitive with semantic tone and optional tooltip. |
| Team/game rows | `app/picks/ui.tsx:136`; `app/picks/nba/NbaView.tsx:251`; `app/picks/cbb/CbbView.tsx:241` | `GameCell` already shared; align expandable row shells and status placement. |
| Team logos | `components/TeamLogo.tsx:26`; `app/picks/game/GamePreview.tsx:68`; `app/props/PlayerPreview.tsx:152`; `app/survivor/SurvivorTool.tsx:59` | Reuse `TeamLogo` in Survivor instead of a separate logo implementation. |
| Player identity/value rows | `components/PlayerAvatar.tsx:32`; `components/PlayerLink.tsx:27`; `app/l/[leagueId]/players/page.tsx:98`; `app/l/[leagueId]/draft/Recommendations.tsx:66` | Shared player row combining avatar, link, position, value and optional flags. |
| Record formatting and outcome tone | `app/picks/ui.tsx:28`; `app/money/MoneyView.tsx:51`; `app/money/IntradayTab.tsx:39`; `app/records/RecordsTable.tsx:45` | Common outcome badge and record formatter with explicit staked/tracked basis. |
| Responsive table wrappers | `app/props/week.tsx:171`; `app/records/page.tsx:172`; `app/l/[leagueId]/trade/TradeBuilder.tsx:963` | Shared scroll container/header/cell styles; sorting remains optional. |
| Disclosure panels | `app/picks/board.tsx:173`; `app/props/week.tsx:256`; `app/records/page.tsx:169`; `app/money/MoneyView.tsx:1563` | Existing `Background` plus a consistent details/summary primitive. |
| Model records and statistical boxes | `app/picks/game/OurStats.tsx`; `app/picks/game/GameStats.tsx`; `app/picks/nba/NbaOurStats.tsx:38`; `app/picks/cbb/CbbGame.tsx:98` | Shared market-evidence panel; keep model probabilities distinct from empirical record estimates. |
| Learner status, logs and cut tables | `app/picks/log.tsx:74`; `app/props/top.tsx:367`; `app/picks/nba/NbaView.tsx:648`; `app/picks/cbb/CbbView.tsx:99` | Common learner section assembled from existing progress/log/cut primitives. |
| Equity/performance charts | `app/money/Chart.tsx`; `app/money/BookChart.tsx`; `app/l/[leagueId]/player/[id]/ValueChart.tsx`; `app/picks/board.tsx` | Shared chart frame/legend/empty state, while preserving different data semantics. |
| Error/configuration panels | `app/l/[leagueId]/draft/page.tsx:36`; `app/l/[leagueId]/plan/page.tsx:88`; `app/l/[leagueId]/players/page.tsx:36` | Shared page-level empty/error panel with optional back link. |
| Sport/market/view tabs | `app/picks/PicksView.tsx:37`; `app/picks/nba/NbaView.tsx:772`; `app/props/PropsView.tsx:76` | Shared URL-driven tab group and centralized route builders. |

Verification limits: this is a static source inventory, not a live-data or browser audit. I did not start the app, call its loaders/APIs, or verify external services. Actual records, conditional block visibility, responsive appearance and modal behavior at runtime remain unverified. Some loaders and page rendering paths can persist data, so executing them would not have preserved the requested read-only scope.