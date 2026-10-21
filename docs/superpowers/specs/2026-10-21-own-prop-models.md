# Our own prop models (NBA props, First Basket, NFL props, First TD)

Written 2026-10-21. Status: research done, plan agreed, nothing built.

## Why

Sam moved player props, first TD and "biggest disagreements" behind a "Parlay Science"
membership on 2026-10-21 (the join button links to `https://your-signup-link-here`, a
placeholder). His boards, game breakdowns and record pages stay free, so game picks are
unaffected. Jack (2026-10-21): "We create our own models for NFL/NBA props, first basket,
first TD. Build it." Credits are fine to spend; use Astra where it fits.

What is blocked (checked 2026-10-21 by fetching every linked page):
- `nfl/props/{slug}.html`: members only (4 games show "PLAYER PROPS, LOCKED")
- `nfl/firsttd/{slug}.html`: all 14 members only
- `nba/props/{id}.html`: all 11 members only
- `nfl/gaps.html`, `ncaaf/gaps.html`: members only
- Our parsers return null on the members page, so nothing bad is saved. The NBA capture
  logs a misleading "no ESPN game for this page" because it reads the page title
  (`nba-props.ts:101-105`); NFL and first TD log "page did not read".

Saved before the wall: NFL week 7 props and first TD for NE at CHI only; NBA props for the
three 10-20 games (graded). Sam's history in Redis (NFL weeks 6-7, NBA week 1) is the
benchmark our models get compared against.

## Data we can get for free (verified 2026-10-21)

| Need | Source | Notes |
|---|---|---|
| NBA DraftKings player prop lines AND prices | ESPN core `sports.core.api.espn.com/v2/sports/basketball/leagues/nba/events/{id}/competitions/{id}/odds/100/propBets?limit=1000` | 1,373 items for one game: points, rebounds, assists, threes, steals, blocks, PRA and combos, double double, **First Basket (with prices, e.g. +568, open +610)**, 1st Team FG Scorer, First Team to Score, milestones. `athlete.$ref` gives the ESPN athlete id. Provider 100 = DraftKings. |
| NFL DraftKings player prop lines | Same endpoint, football/nfl | Lines (current and open) for pass/rush/rec yards, receptions, attempts, completions, TDs, First TD Scorer, Anytime TD. **No prices on 10-21 for a Thursday game**; recheck closer to kickoff. Already used in `props/espn.ts:116`. |
| NFL DraftKings prices | David Sasser board (`props/david.ts`) | DK line plus over/under prices for 6 markets. |
| First TD prices | Kalshi `KXNFLFIRSTTD` (`firsttd/kalshi.ts`) | Already captured. |
| First Basket prices | ESPN core DK "First Basket" (above); Kalshi `KXNBAFIRSTBASKET` series exists, 0 events listed on 10-21 | |
| NBA box scores and play-by-play | ESPN `site.api.espn.com/.../basketball/nba/summary?event=` | Play 1 is the jump ball with both jumpers and who gained possession (e.g. "Chet Holmgren vs. Victor Wembanyama (Stephon Castle gains possession)"), then every shot with scorer ids. Enough to build tip and first-basket history. stats.nba.com blocks cloud IPs; do not depend on it. |
| NFL play-by-play, snaps, injuries, depth charts | nflverse GitHub releases, e.g. `github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_2026.csv.gz` (and `.parquet`), `snap_counts/snap_counts_2026.csv.gz`, `injuries/`, `depth_charts/`, `rosters/` | Weekly player stats moved from `player_stats` (404 for 2026) to the `stats_player` release. Participation (routes) only ships after the postseason, so use snaps plus targets/carries for shares. |
| Starting lineups, injuries | RotoWire lineups page, NBA official injury PDFs, ESPN injuries | NBA starters matter most for first basket (DK voids non-starters). |

Paid option, only if Jack approves: The Odds API (`the-odds-api.com`): 500 free credits a
month (too few for daily NBA), paid plans for volume and historical props. Gives multi-book
prices and `player_first_basket`, `player_1st_td`. Not needed for v1.

**The gap that matters most: there is no history of prop lines anywhere.** Start archiving
ESPN DK prop lines on every capture from day one, so closing-line value and backtests
against real lines become possible in a few weeks.

## Model designs (from the research, kept simple for v1)

Research notes: Perplexity deep research on NBA and NFL prop modeling (2026-10-21),
two YouTube walkthroughs via /watch (Billy Collins "How to Start Building Your Own NBA
Betting Model", Oct 2026; "Don't Ask AI for Picks", Aug 2026). Key shared advice: model
opportunity (minutes, targets, carries) before results; shrink small samples; price the
line from the distribution (CDF), not the mean; backtest walk-forward with only
pre-game information; judge by calibration and CLV, not hit rate.

### NBA player props (points, rebounds, assists, threes; combos later)
1. **Minutes first.** Projected minutes from recent games in the same role (starter or
   bench), shrunk toward season and prior-season averages; cut for blowout risk from the
   spread; zero for OUT players and redistribute their minutes to the same-position
   rotation. Team minutes sum to 240.
2. **Per-minute rates** for each stat, empirical Bayes: `r = (n * r_current + k * r_prior) / (n + k)`
   with `n` = minutes played this season and `k` a tuned pseudo-sample (start around
   200 minutes; tune per stat). Prior = last season's rate (ESPN game logs).
3. **Pace:** scale by projected game possessions over league average, from both teams'
   pace and the game total. Apply once.
4. **Distribution:** negative binomial for counts (threes, rebounds, assists), normal with
   fitted variance for points as a first cut; later a joint simulation so PRA keeps the
   correlation. `P(over L) = P(X >= floor(L) + 1)` for half-point lines.
5. Output into the existing `PropsGame`/`PropMarket` shape (see "Plug-in seam") with our
   projection as `model`, DK from ESPN as `books`, and the edge rules from `samVsMarket`
   (`parse.ts:281-298`) retuned for our model.

### NBA First Basket (first field goal; DK rules: free throws do not count, non-starters void)
- `q = P(team A wins the tip)` from the two expected jumpers' shrunk tip records (logistic
  on jumper A minus jumper B), from ESPN play 1 history.
- `a = P(A scores first FG | A wins tip)`, `b = P(A scores first FG | B wins tip)`, fitted
  from play-by-play. `P(A first) = q*a + (1-q)*b`.
- Player share among the five starters from first-shot share and FG%, separately for
  won-tip and lost-tip, with an "other" bucket. `P(i) = q*a*s_i,won + (1-q)*b*s_i,lost`.
- Grade from ESPN play-by-play (first made field goal). Compare to DK First Basket prices
  (remove vig across the listed field before comparing).
- This is the First Basket section under NBA props that Jack asked for on 10-20. The daily
  First Basket check (`scripts/check-first-basket.mjs`, launchd
  `com.jackh.first-basket-check`) becomes moot; unload it once this ships.

### NFL player props (pass/rush/rec yards, receptions; attempts later)
1. Team volume from the market: implied team total `(total ± spread)/2`, team plays and
   pass rate (situation-neutral pass rate over expected from nflverse pbp).
2. Player shares: target share, carry share, red-zone shares from nflverse weekly stats
   and snaps, empirical-Bayes shrunk (`(x + alpha) / (n + alpha + beta)` with a position
   prior); injuries and absences redistribute shares to players who gain snaps.
3. Per-opportunity efficiency (yards per target/carry, catch rate), shrunk hard.
4. Simulate (Monte Carlo) targets/carries then yards per opportunity with a skewed
   mixture; price lines from the simulated CDF (median, not mean, for yardage).
5. Same `PropsGame` output; lines from ESPN DK, prices from David where available
   (default -110 where none, as grading already does).

### NFL First TD
- Possession-level hazard model: each team's TD rate per drive from its implied total;
  opening-kickoff receipt 50/50 until known; `P(no TD)` kept as its own outcome.
- Conditional on a team TD, the scorer is drawn from that team's TD shares (red-zone and
  goal-line usage, receiving vs rushing), plus "other" (defense, special teams).
- Output `FtdGame` (`firsttd/parse.ts:52`) with player names in `F.Last` form so
  `sameName` and `kalshiFor` keep working; `p` + `rest` + `none` sums to about 1.
  Grading, Kalshi money slices and trends then work unchanged.

## Plug-in seam (from a read of the code on 2026-10-21)

Everything downstream of the parsers is source-agnostic. Swap the producer, not the
pipeline:
- NFL props: `props/store.ts:218` (`parsePropsPage`) produces `PropsGame`. Grading reads
  `stat, player, model, line, side, clears, books` (`grade.ts:144`, `parse.ts:351`);
  trends also read `gap, consensus, lean, favorites`.
- NBA props: `props/nba-props.ts:114` (`parseNbaPropsPage`), then `samVsMarket`.
- First TD: `firsttd/store.ts:138` (`parseFirstTdPage`), plus the board-slug discovery at
  `firsttd/store.ts:99-121` which must come from ESPN's schedule instead of Sam's board.
- Give each of our models its own learning section (like `PROPS_SECTION`,
  `FTD_SECTION`) so its evidence never mixes with Sam's record. Keep Sam's code paths;
  if he reopens, both can run side by side.
- Redis: new keys under a new prefix (for example `props:v1:ours:...`), never rewrite
  Sam's saved weeks.

## Build order (each phase ships, is tested, and is useful on its own)

0. **Line archive, first and today:** capture ESPN DK propBets (NBA and NFL, with prices
   when present) and Kalshi first-TD/first-basket every capture slot, timestamped, into
   Redis (open, current, close). Fix the misleading NBA paywall message ("behind Sam's
   paywall"). No model yet.
1. **NBA props v1** (points, rebounds, assists, threes): history loader from ESPN game logs
   and box scores (this season plus last), minutes plus rates model, distribution, output
   into the props pipeline, its own learning section, UI cards like Sam's. Backtest
   walk-forward on last season for accuracy and calibration (no historical lines yet), and
   against Sam's saved 10-20 numbers.
2. **NBA First Basket**: tip and first-FG history from ESPN play-by-play (last season plus
   this one), model above, DK First Basket prices, grading, section under NBA props.
3. **NFL props v1**: nflverse loader (a GitHub Action or Node script that turns the season
   CSVs into compact per-player share and rate tables in Redis), simulation, output,
   grading. Benchmark against Sam's saved weeks 6-7 and David.
4. **NFL First TD**: hazard and scorer model, `FtdGame` output, Kalshi comparison.

Per phase: pure modeling code in `src/lib/models/{nba,nfl}/` with vitest tests (fixtures
from real ESPN and nflverse responses), capture wired into the existing routes and
GitHub workflows, walk-forward evaluation script under `scripts/`, HANDOFF.md and
.dashboard.json updated, committed and pushed to main. Jack runs `npx vercel --prod`
himself (auto mode blocks production deploys; git push does not trigger a Vercel build on
this project).

## Rules that apply

- Every number shown comes from code or data; label estimates. No made-up weights: every
  tuned constant (shrinkage `k`, blowout cut, dispersion) is fit or chosen by the
  walk-forward script and recorded with its test result.
- A model's edge on the page is a model edge, not a betting recommendation, until its
  learning section clears the existing gate (`PROPS_GATE`).
- No em dashes in UI text or docs.
- No new paid service without asking Jack (The Odds API is the likely ask if ESPN's NFL
  prices never fill in).

## Build log

### Phase 0: line archive (2026-10-21)
- `src/lib/models/lines.ts` (pure) reads ESPN's DK propBets into one entry per (athlete, market); `src/lib/models/archive.ts` stores one value per game at `lines:v1:{league}:{season}:{espnEventId}` plus a set `lines:v1:{league}:{season}:events`. Each market keeps DK's own opening number (`dkOpen`), our first read (`first`) and the latest pregame read (`last`); the first capture after the start sets `closedAt`, so `last` is the close.
- Over/under order: the first of the two rows is the over. Checked 14 of 14 on ATL at ORL (2026-10-21): the matching "Points Milestones" price at ceil(line) sits next to the first row every time.
- Kept types: NBA points, rebounds, assists, threes, PRA and the three pairs, steals, blocks, double double, First Basket; NFL pass/rush/rec yards, receptions, attempts, completions, carries, pass TDs, rush+rec yards, First TD Scorer, Anytime TD. Milestones and quarter markets are left out (size).
- Kalshi: KXNFLFIRSTTD (13 games open on 10-21) and KXNBAFIRSTBASKET (series exists, no events yet; the matcher assumes the NFL's "AAA vs BBB" sub-title) are saved with each game, first and latest read.
- First run from this Mac on 2026-10-21 11:50 ET: 13 NBA games (52 to 141 markets each, all priced), 14 NFL games (lines only, 0 priced; ESPN still has no NFL prices).
- `/api/lines` runs on the NBA props workflow (6 daily slots) and the first TD workflow (NFL slots).
- Sam's members pages (title "... members") are now reported as `paywalled` by the NBA props, NFL props and first TD captures instead of "no ESPN game for this page" or "page did not read".
