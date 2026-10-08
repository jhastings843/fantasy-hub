# Handoff (2026-10-07, evening)

Last session: built the **Picks tab** (two-model ATS backtest for NFL and college, straight-up pick'em, Wednesday email), then added **Jay's PEM** as a third college model. Everything is deployed (commits dd36431, 2a07dfc, c298711, c5ed6fe). Next up is the Prediction Tracker consensus (details below).

## Picks tab: what exists
- Pages: /picks (NFL) and /picks/cfb. JSON: /api/picks?league=nfl|cfb (`?refresh=1` with the cron secret). Email preview: /api/picks-email?dry=1.
- Code: `src/lib/picks/` (parse.ts pure parsers, engine.ts backtest and tiers, report.ts fetch and Redis, email.ts, run.ts, pem.ts, pem-card.ts) and `src/app/picks/` (PicksView.tsx, TierChecker.tsx, picks.module.css, its own fonts in layout.tsx). Tests: parse, engine and pem test files, against saved pages in `test/fixtures/picks/`.
- Sources: davidsasser.com/nfl and /cfb (the board, plus the Google history sheet linked from it, one tab per week, read as CSV) and samthemodelman.smmodel.workers.dev/nfl/ and /ncaaf/ (board and record.html). Both sites are server-rendered. David's NFL history only has Weeks 3 and 4; Sam's NFL record starts Week 3; nobody has NFL Weeks 1 and 2.
- Conventions: lines are home-side (-3.5 = home favored). Shared picks are graded at the WORSE of the two sites' lines. A model is on the home side when its line is below the market's.
- The rule auto-picks (Jack's choice): best cut by the low end of its 90% Wilson range, needing 10+ graded games and a winning record. Tier 2 is the next cut that adds games. As of today: NFL "Agree on underdog" 14-2 (10 Tier 1 plays in Week 5); college "Agree, line 14+ either side" 14-6.
- Straight up: follows the method with the best SU record. NFL is the average of both models (21-11, vs Vegas favorite 17-15). College is the Vegas favorite (86-28). Confidence bands: NFL lock 6+, solid 3+; college 14+ and 7+.
- Redis keys (never expire unless noted): `picks:v1:{league}:rows:{sam|david}` (archive of every graded row, so history only grows), `picks:v1:{league}:snap:{season}:w{n}` (the week's board, frozen when the email sends, graded later as the live record), `picks:v1:{league}:report` (3h cache plus last-known-good), `picks:v1:cfb:pem:{season}:w{n}`.
- Schedule: pulse hourly job "picks" (respects the 3h cache). Send "picks" Wed 9am ET with a Thu 9am fallback; it skips until both NFL boards show the new week. **First real email: Wed Oct 14.**

## PEM (college third model)
- Jay (@FansOfCFB) posts "Week N PEM picks. All N games" as one image every Tuesday. `scripts/pem-relay.mjs` (LaunchAgent `com.jackh.pem-relay`, every 2 hours, log at `.pem-relay/relay.log`) reads his last 40 posts through OpenCLI and Chrome's X login, and POSTs new cards to /api/picks/pem using `PEM_RELAY_SECRET` (in .env.local and Vercel production; it can only post cards).
- The app splits the image into columns (sharp), reads each with Haiku, and retries with Sonnet if the check fails. It keeps a week only if every row's EDGE equals |PEM - line| and the game count matches the post. Unverified weeks are stored but left out, and the page says so. A failed card is not marked as read, so the relay retries it.
- On file: Week 5 (typed from his results card, `test/fixtures/picks/pem-week5.csv`; grading reproduces his 30-24-1) and Week 6 (read live, 58/58 verified, 8 rows spot-checked by hand). **First automatic card: Tue Oct 13.** Check the relay log that day.
- Week 5 cuts: all three agree 13-7, on the dog 6-1, on the favorite 7-6, PEM breaking a Sam/David split 11-9-1, PEM alone 30-24-1. One week, so not proven. No PEM cut can become the rule until it has 10+ games and wins.
- Needs Chrome (main profile, not incognito) logged into X. Pulling 1,500 posts at once got the account rate-limited (HTTP 429) on Oct 7; the relay only reads 40.
- College team names: `CFB_ALIASES` in parse.ts. Add to it when the page lists an unmatched game.

## Closing lines (built 2026-10-07, session 2)
- `src/lib/picks/closing.ts` (pure: ESPN parsing, CLV math, tables; tests in closing.test.ts with fixtures `test/fixtures/picks/espn-*.json`) and `closing-store.ts` (fetch plus Redis). Source: ESPN game summary `pickcenter[0].pointSpread.home.open/close` (DraftKings) on finished games; the scoreboard drops odds once a game ends. Stored per week at `picks:v1:{league}:close:{season}:w{n}`, never refetched; finished-but-unpriced games are stored with null lines.
- CLV = points better than the close (home pick: line taken minus close; road pick: close minus line taken). Each model graded at the market number on its own site, shared picks at the worse line. The rule row uses the rule's own cut. Plays as sent (frozen snapshots, tiers 1 and 2) get their own rows once the first email freezes a week.
- Page: "Beating the closing line" section on /picks and /picks/cfb, after "The plays as made". JSON: `report.clv`.
- First numbers (2026-10-07): NFL Sam +0.69 (18 beat / 3 worse of 32), David +0.30, rule (agree on dog) +0.63 on 16. College Sam +0.46 (53/32 of 114), David 0.00, PEM -0.38 (17/27 of 55), rule (agree, line 14+) -0.16 on 19. 114 of 115 college games matched (App State at NC State, Week 4, did not).

## Prediction Tracker (decided 2026-10-07: not a vote)
- Walk-forward backtest on ncaa2025.csv (795 graded games): top 5 by season ATS 379-358 (51.4%), top 5 with 4+ agreeing 50.3%, top 5 by lowest error 51.9%, every model averaged 422-373 (53.1%), all-model median with a 3+ edge 125-98 (56.1%, 90% low end 50.5%). Break-even 52.4%. The top-5 list reshuffles nearly every week. Jack chose closing lines instead.
- `src/lib/picks/tracker.ts` saves nflpredictions.csv and ncaapredictions.csv once per ET day (`picks:v1:{league}:tracker:{YYYY-MM-DD}`, hourly pulse job "tracker"). Nothing reads it yet; it is a 2026 history for testing the all-model median against Sam, David and PEM later.
- Column mapping solved: system names on prednfl.php / predncaa.php match CSV columns exactly (e.g. NFL "Versus Sports Simulator" = linepugh, "Turnover Adj. L2" = linel2to; college "Dokter" = linedokter, "Massey Consenus" = linecons). The results pages use slightly different names (Sagarin Points = linesagpred). The tracker grades against its own line, so its records differ from a recompute by a few games.

## Next
1. Watch the first CLV rows for plays as sent after the Oct 14 email freezes Week 6.
2. Totals: the ESPN summaries also carry the total's open and close (`totalOpen/totalClose` already stored per game). Both sites print model totals; same agreement method plus CLV.
3. Injury and big line-move flags (open vs current is now easy from the same summaries).
4. Revisit the tracker's all-model median once a few 2026 weeks are archived.
5. Public betting % last.

## Watch
- Wed Oct 14 picks email; Tue Oct 13 PEM relay; the hourly "picks" job in /api/health receipts.
- If a site changes its markup, the parser returns zero rows and the page names the site. Fixtures plus tests in `src/lib/picks/*.test.ts` will show the break.

## Old uncommitted edits: committed 2026-10-07
The Oct 2 to 5 edits were reviewed, tested and committed (9278045 Sunday alarm to 12:15; e314cd7 Field Notes email shell and fuller lineup detail).

## Dynasty (from Oct 5, unchanged)
- Keep list in `src/lib/dynasty/untouchables.ts`: Gibbs (9221) and Dart (12508). Retooling for 2027. The trade list is in `.dashboard.json` next_steps. The app prices on RosterAudit, which values veterans far below FantasyCalc.
- Open: a position-fit idea can still trade young core for older players during a retool. Possible fix: read the season-plan trajectory and skip age-up trades when rebuilding.
