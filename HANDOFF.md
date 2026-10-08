# Handoff (2026-10-09, Picks audit: correctness, layout, learning loop)

Latest session: an audit-driven pass on Picks in three stages (branch `picks-audit`, merged to main). Stage 1 fixed decision and accounting gaps (one exposure allocator, live quotes, durable issuance). Stage 2 rebuilt the page as sport > market > view with current picks first. Stage 3 added a bounded, scheduled strategy review with validation and rollback. An independent review (Astra) of stage 1 found seven issues; all are fixed with regression tests. This file describes what is implemented now; it replaces the earlier, partly contradictory notes on research promotion and the email schedule.

## Sleeper pick'em pool (built 2026-10-09)
- Jack's pool: Sleeper league 1407350265954263040, "Weekly payout": straight up, no spread, NO confidence points, weekly winner, ties go to a tiebreaker. 49 entries, about 22 to 35 actually pick (Week 4: 22 scored; winning 12 tied by 5). Found via the public `/v1/user/{id}/leagues/pickem:nfl/2026` endpoint.
- `src/lib/picks/pool.ts` (pure): picks the entry most likely to finish FIRST. Market no-vig win odds per game; the field picks independently at its pick share; exact opponent-score distribution per simulated week (Poisson binomial DP) and an exact tie-split win share, so candidate entries are scored by lookup. Greedy upset flips from all favorites, up to 4. Tests check it against a brute-force field simulation (within 1 pt).
- `pool-store.ts`: entrants = entries that scored last week; field shares from Sleeper GraphQL `get_pickem_picks_for_league` when `SLEEPER_TOKEN` works, else an estimate (field backs favorites harder than the odds, logit x1.6) labelled as such; tiebreaker = market total of the week's last game; cached 15 min (`picks:v2:pool:*`).
- Page: NFL > Straight up > This week shows "Your pool entry" first (win chance vs all favorites, the upsets and why, full entry, tiebreaker, provenance). No email, no stakes.
- Needs: a fresh `SLEEPER_TOKEN` (the local one is missing; Jack is sending one) to replace the estimate with real pick shares, then calibrate the estimate from past weeks' real shares.

## How Picks works now
- Pages: `/picks` (NFL) and `/picks/cfb`, with `?m=ats|su|ou` (Spreads, Straight up, Totals) and `?v=week|results|research`. URL state is shareable and survives refresh/Back. JSON: `/api/picks?league=nfl|cfb` (`?refresh=1` with the cron secret). Email previews: `/api/picks-email?dry=1` (Tuesday card), `?update=sat&dry=1` (Saturday), `/api/sunday-email?dry=1`.
- Code map (`src/lib/picks/`): parse.ts (site parsers), engine.ts (cuts, tiers, straight up), report.ts (slow core build, quotes cache, data job), compose.ts (core + quotes + exposure -> live report, pure), allocate.ts + limits.ts (stakes inside the protected envelope), staking.ts (wanted stakes per policy), policy.ts + policy-store.ts (frozen policy versions), issued.ts + issued-store.ts + issue-send.ts (what was sent, durable), update.ts (game-day diff), forecasts.ts (append-only pregame evidence), totals*.ts, closing*.ts, research.ts, units.ts, ops.ts, learning/ (strategy review). Page: `src/app/picks/` (PicksView.tsx shell, ats.tsx, su-totals.tsx, learning.tsx, ui.tsx, TierChecker.tsx, picks.module.css).
- Sources: davidsasser.com (board + Google history sheet), samthemodelman.smmodel.workers.dev (board + record.html), PEM cards via the Mac relay (college), current lines/prices/kickoffs/finals/closes from ESPN (DraftKings). Lines are home-side (-3.5 = home favored).

## Decisions and stakes
- Rule: chosen on the SOURCE-LINE backtest (each site's own line; shared picks graded at the worse line): the candidate cut with 10+ decided games and a rate past 52.4% whose 90% Wilson range has the highest low end (an estimate, not a floor). Tier 2: the best other candidate judged only on the games it adds; can be none. Research cuts are candidates only if the strategy review activates them (policy.atsCandidates).
- This week's board: every model judged at ONE current DraftKings quote (ESPN, pregame games only). No quote = research signal, never a bet. Past kickoff = "started", never actionable (applied on every read, whatever the cache). Quotes older than 90 minutes are shown as stale and not offered.
- Stakes (policy p1): quarter Kelly at the QUOTED price on the tier's record pulled toward 50% over 100 games (an estimate stored on every bet, with the policy id; not yet shown calibrated). No quoted price, no stake. Units are risked.
- Protected envelope (limits.ts, pinned by test): 0.25u to 5u per bet; 5u per game across every bet on it; 15u per sport per week covering the Tuesday card AND game-day additions; 30u outstanding across both sports (exactly 2 x 15, so it never enlarges anything; it binds only when last week's bets are still open). One shared bankroll, 1u = 1%. The allocator scales stakes, drops the lowest-priority plays when needed, never exceeds the room, and never re-allocates a game already issued.
- Parlays: off the card. A product of uncalibrated leg estimates times a computed payout (DraftKings' parlay price isn't quoted to us) is not a demonstrated edge. They run in shadow as a report-only hypothesis; the envelope forbids enabling them by policy.
- Straight up: follows the best full-slate method (NFL models' average, college Vegas favorite); margin bands only; pick'em, no stake.
- Totals: model totals from projected scores, judged at the one current total. Tracking only until a totals cut has 10+ decided games and wins in the forward agreement archive.

## Email schedule (as implemented)
- Tuesday card from 5:30pm ET once all four boards show the new week (retries each pulse; Wed and Thu 9am fallbacks need only the NFL boards). College is allocated after NFL with NFL's card reserved.
- Saturday 9:30am college update and an NFL block in the Sunday 9am brief: issued bets re-checked at today's line AND price (still on / off for anyone who hasn't bet / new); issued totals too; kicked off vs no quote told apart. A sent bet stands as sent. Saturday sends only when something is new or off.
- Durable issuance (issue-send.ts): one atomic intent per idempotency key holds the exact HTML, subject and records; records written "pending", email sent with that key, then "sent" and the sent log. Any later run (or a concurrent one) sends the CLAIMED card and records. Pending intents are finished before a new decision. Past 20h an unconfirmed send is never resent: records become "unconfirmed" (exposure, not results) for a person to check. A refused send drops the intent.
- First real email: Wed Oct 7 (Week 5, recovered record, unstaked). First staked sends after deploy: Sat Oct 10 college update, Sun Oct 11 brief block, Tue Oct 13 card.

## Scheduled operations (no page visit needed)
- `picks-data` (pulse live tier every 15 min on game windows, hourly otherwise): fresh quotes, compose, append pregame forecasts, archive totals, settle issued bets, board snapshot. Health in `picks:v2:ops` (last success, last failure + reason, next expected), shown under Research > Strategy review > Scheduler health.
- `picks-review` (hourly check): runs the strategy review when the weekly slot (Tuesday ~7am ET) has passed or 15+ matched games newly settled; otherwise "not due". Also recorded in ops.
- Weekly GitHub workflow `picks-ui-check.yml` (Wed 10am ET): browser checks on the live page, result posted to the learning journal. Report only.

## Strategy review (learning loop)
- Pattern from trade-bot/phil/CYCLE.md: settle -> score -> review -> bounded change -> validate -> record. Code: `src/lib/picks/learning/` (model.ts pure; review.ts orchestration; store.ts Redis; memory-store.ts; run.ts).
- Evidence: only append-only pregame forecasts (`picks:v2:{league}:{season}:forecast:w{n}`, first and last actionable snapshot per game) and issued records. A hypothesis counts only games first seen after it was registered. Comparisons are paired on matched games at recorded prices; CLV vs the close; calibration of stored probabilities.
- Launch hypotheses (23): each research refinement vs its parent (actionable), flat 1u and eighth-Kelly staking vs current (actionable), timing (game-day vs first line), parlay shadow, straight-up average vs Vegas, PEM agreement (report only). Max 24 collecting; at most 2 evidence-generated proposals per review, report-only until a person adds the cut to code.
- Acceptance CRITERIA (model.ts, pinned by learning.test.ts): 30+ settled matched games over 3+ weeks; paired one-sided t >= 1.645; CLV no worse by more than 0.25 pt; drawdown <= 1.25x + 1u; sizing up also needs 50+ settled issued bets with mean estimate within 5 pts of the win rate.
- Activation: at most one per review; new frozen version (`picks:v2:policy:versions`, write-once), active pointer `picks:v2:policy:active`, rollback target recorded; validated first (envelope, replay of this week's card inside the caps with no unpriced stake, issued-history grading identical before/after).
- Rollback (predeclared): validation failure, or the active policy trailing the one it replaced on 20+ settled matched games since activation with t <= -1.645. Never on a single game.
- The loop CAN change: research-cut candidacy and staking parameters inside the envelope. It CANNOT: raise limits, enable parlays, change grading/accounting, rewrite issued records or old stakes, edit CRITERIA, change send timing or code. Those need a person; the review records them as reports/proposals.
- Journal: `picks:v2:learning:journal` (append-only; review, register, activate, retain, reject, rollback, proposal, ui). State: `picks:v2:learning:state`. Hypotheses: `picks:v2:learning:hyp`.
- Rehearsal: `npx tsx scripts/picks-rehearsal.mts` (in memory: register, activate p2 on synthetic evidence, roll back to p1, and a validation-failure retain). Real data, no writes: `GET /api/picks/review?dry=1` with the cron secret (2026-10-09: "no change: kept p1", 0 settled matched games yet).

## Rollback procedures
- Policy: automatic per the rules above. By hand: set `picks:v2:policy:active` to a stored version from `picks:v2:policy:versions` (or delete the key to return to the built-in baseline p1) and append a journal note via `POST /api/picks/review`.
- Code/layout: `git revert` the commit (stage 2 layout is 51b5e05; stage 1 ce5dcd9 + 7ab80ca; stage 3 dfb460b) and push; Vercel redeploys. Redis keys are additive (v2); the old v1 keys are untouched, so a code revert reads the old data as before.

## Redis keys (v2, season-aware)
- `picks:v2:{league}:{season}:rows:{sam|david}` (source archives; seeded once from the old season-less v1 keys), `picks:v2:{league}:core` (3h core cache), `picks:v2:{league}:quotes:{season}:w{n}` (10 min), `picks:v2:{league}:{season}:forecast:w{n}` (+ `-fp`, `-weeks`), `picks:v2:settled:{season}`, `picks:v2:intent:{idempotencyKey}`, `picks:v2:ops`, learning keys above. Unchanged: `picks:v1:{league}:issued:*` (issued records), `picks:v1:{league}:close:*`, `picks:v1:{league}:totals:*`, `picks:v1:cfb:pem:*`, snapshots `picks:v1:{league}:snap:*`.

## Known limits
- Little evidence yet: the pregame archive started 2026-10-08, so no hypothesis can be promoted for at least 3 weeks; stored probabilities are unproven, so stakes cannot size up.
- The rule itself is still chosen on source-line history; reference-line forward evidence only enters through the review.
- The intent claim and the pending->sent transition are atomic per key but not across a lost-and-recovered Redis write; a refused send racing a concurrent success has a tiny window (documented in issue-send.ts).
- UI review is checks + journal only. There is no interaction data, so no claim of measured decision-quality improvement; layout changes stay with a reviewed session.
- ESPN quotes have no quote timestamp; freshness is our read time.

## PEM (college third model)
- Jay (@FansOfCFB) posts "Week N PEM picks" as one image every Tuesday. `scripts/pem-relay.mjs` (LaunchAgent `com.jackh.pem-relay`, every 2 hours, log `.pem-relay/relay.log`) reads his last 40 posts through OpenCLI and Chrome's X login and POSTs new cards to /api/picks/pem (`PEM_RELAY_SECRET`). Columns read with Haiku, retried with Sonnet; a week counts only if every EDGE checks. Needs Chrome logged into X. Team names: `CFB_ALIASES` in parse.ts.

## Closing lines and the Prediction Tracker
- Closing lines from ESPN game summaries (DraftKings open/close) per finished game, stored once with the final score. CLV = points better than the close.
- Prediction Tracker: not a vote (2025 walk-forward: top-5 by ATS 51.4%, below break-even). Its daily files are archived (`picks:v1:{league}:tracker:{date}`) for a later test of the all-model median.

## Next
1. After deploy, confirm in Research > Strategy review > Scheduler health that `data` and `review` show recent successes without anyone opening the page.
2. Sat Oct 10 9:30am college update, Sun Oct 11 brief block, Tue Oct 13 card: check the send response says intents "confirmed sent".
3. First Wednesday UI check (Oct 14) appears in the journal.
4. After ~3 weeks of the pregame archive, the first hypotheses can clear the bar; until then expect "no change: kept p1" with reasons.

## Dynasty (from Oct 5, unchanged)
- Keep list in `src/lib/dynasty/untouchables.ts`: Gibbs (9221) and Dart (12508). Retooling for 2027. The app prices on RosterAudit, which values veterans far below FantasyCalc.
