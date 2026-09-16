# FAAB strategy for dynasty and redraft: the researched basis

Compiled 2026-09-15 for the non-guillotine leagues. The guillotine basis is a
separate document (`guillotine-strategy.md`) because that format is a
different game. Percentages are of the ORIGINAL budget.

The leagues this is for:

| League | Format | Teams | FAAB | Waivers |
|---|---|---|---|---|
| Dah Dynasty | dynasty, full PPR, superflex | 12 | $1000 | Wed 3:00am ET |
| 2026 Half PPR | redraft, half PPR, starts DEF | 12 | $100 | Wed 3:00am ET |
| Sunday Scaries #2 | redraft, full PPR | 12 | $100 | Wed 5:05am ET |

## The one rule that survives every source

Price the points a player adds to your STARTING lineup, not his projection.
A 12-point player behind two 14-point starters is worth a depth bid. A
9-point player replacing a 5-point bye-week starter is worth a one-week
filler bid. A handcuff projecting zero today is priced on the probability he
inherits the job, not on zero. This is the same rule the guillotine advisor
already runs on, and it transfers unchanged.

The second rule: usage moves the tier, touchdowns do not. Snaps, routes,
targets, carries and red-zone work identify a real role change. A touchdown
on the same snap count is a $0 to $3 claim in redraft and a $5 to $30 churn
bid in dynasty.

## What the market actually pays

The empirical bid distribution is far cheaper than the published tier
advice, and the tool should know both.

- FantasyPros, 340,000+ dynasty adds normalised to $1000: about 71% won for
  $25 or less, fewer than 5% cost $100 or more. 2024 weighted median about
  $12.
- 2024 redraft, normalised to $1000: average winning bid $14. Positional
  medians $21 QB and RB, $29 WR, $20 TE, $3 K, $10 DST. On a $100 scale that
  is $1 to $3 for most adds. Conviction bids occasionally reached $766.
- Sleeper is a sealed first-price auction. Highest bid wins and pays it all.
  Ties go to rolling waiver priority. $0 bids are allowed unless the
  commissioner set a minimum. Claims process by bid amount, highest first;
  you can only reorder claims that carry the same amount.
- The 1-day and 2-day "waiver clear" settings govern how long a DROPPED
  player sits on waivers, not the weekly run. So a player dropped Thursday
  in the 2-day leagues is claimable Saturday, and the tool should re-check
  the pool at that expiry.

## Dynasty pacing ($1000, 12 teams)

Cumulative spend targets. The contender and rebuilder curves differ because
the two are buying different things.

| After | Contender | Rebuilder |
|---|---|---|
| Week 2 | 10-20% | 5-12% |
| Week 4 | 20-30% | 10-20% |
| Week 8 | 45-60% | 25-40% |
| Week 12 | 75-90% | 45-65% |
| Playoffs | hold 10-15% for injuries and blocking | no reserve; 15-30% for late stashes |
| Last run | $0-20 left | $0-20 left |

FAAB does not roll over on Sleeper unless the commissioner does it by hand,
so the tool assumes a seasonal reset: a dollar unspent at the last run is
gone.

Contender versus rebuilder is not "rebuilders save". A rebuilder should
OUTBID contenders for durable youth and pay almost nothing for veterans
whose role ends before next season. A contender does the opposite when a
temporary starter moves title odds.

| Team state | Buy | Discount | Multiplier |
|---|---|---|---|
| Strong contender | multiweek RB/WR starters, injury fills, own elite-RB handcuffs | developmental players with no 2026 role | 1.1-1.3x |
| Fringe contender | players who start now AND keep 2027 value | one-week veterans | 1.0-1.2x |
| Rebuilder | rookies, year 2-3 players, injured youth, backup QBs in superflex | aging fills, streamers | 1.1-1.35x youth, 0.25-0.6x veterans |
| Eliminated | anything with offseason trade value | streamers, expiring roles | 0x current-only, up to 1.35x future |

Dynasty tiers, share of original budget:

| Tier | Profile | Standard | Aggressive |
|---|---|---|---|
| League winner, young | young player into an every-down or high-target role, multi-year value | 30-50% | 50-80% |
| League winner, veteran | season-long starting job, little future value (contenders only) | 15-30% | 30-45% |
| Multiweek starter | in the lineup 3-6 weeks | 6-15% | 15-25% |
| Handcuff | clear RB2 behind a valuable starter | 2-6% | 6-10% protecting your own starter |
| Rookie waiver darling | rising routes/carries, draft capital, clear opening | 3-10% | 10-25% |
| Developmental stash | young reserve, no lineup path | 0.5-3% | 3-5% |
| Streamer | one-week QB/TE/DEF | 0-1% | 1-2% emergency |

A rookie earns the premium when at least three hold: real draft capital;
routes, targets or carries rising, not just touchdowns; an injury or
promotion opened the role; young enough to keep trade value if it stalls;
the role could persist into 2027.

## Redraft pacing ($100, 12 teams)

| After | Cumulative spend | Remaining |
|---|---|---|
| Week 2 | 20-35% | $65-80 |
| Week 4 | 40-50% | $50-60 |
| Week 8 | 65-75% | $25-35 |
| Week 12 | 85-90% | $10-15 |
| Playoffs start | 90-100% | $0-10 |
| Final week | 100% | $0 |

Sources disagree here more than anywhere: one school spends half by Week 4
because early starters deliver the most usable weeks, another holds 30-40%
for late emergencies. The table is the compromise and the principle beneath
it is sound: a $100 budget that ends the season unspent produced nothing.

Redraft tiers, dollars on $100:

| Tier | Profile | Standard | Bid to win |
|---|---|---|---|
| League-winning RB | clear lead role, starter out for the season, receiving and goal-line work | $45-65 | $66-100 |
| New every-week starter | stable high-volume role for most of the season | $20-35 | $36-50 |
| Multiweek injury fill | starter for 3-6 weeks | $10-20 | $21-30 |
| Top QB/TE streamer | best one-week option or plausible rest-of-season starter at a weak slot | $3-7 | $8-12 |
| Unattached handcuff | clear backup behind a heavily used RB | $3-7 | $8-12 |
| Bye-week filler | enters the lineup this week only | $1-3 | $4-6 |
| Speculative bench add | needs another event first | $0-3 | $4-6 |
| K or DEF | one-week matchup streamer | $0-1 | $2 |

Format multipliers, applied to the value part of the bid only:

| Profile | Full PPR | Half PPR |
|---|---|---|
| Receiving RB | 1.1-1.2x | 0.95-1.0x |
| Slot WR, possession TE | 1.05-1.15x | 0.9-1.0x |
| Early-down or goal-line RB | 0.95-1.0x | 1.05-1.15x |
| Deep-threat WR | 0.95-1.0x | 1.0-1.1x |

Record and playoff odds:

| Situation | Multiplier |
|---|---|
| 0-2, low points, obvious hole | 1.2-1.35x |
| 0-2 but strong usage, unlucky | 1.05-1.15x |
| 1-1 | 0.95-1.1x, lineup gain decides |
| 2-0 with thin depth | 0.95-1.1x |
| 2-0, strong lineup and bench | 0.8-0.95x |
| Must-win late | 1.25-1.5x |
| Clinched | 0.8-1.0x now; shift to playoff schedule, handcuffs, blocking |

Continuous form: `urgency = clip(0.8, 1.35, 1 + 0.6 * (0.5 - P(playoffs)))`,
plus up to 0.1 for an immediate starting hole.

## Bidding to win

- Odd numbers. Rooms bid in fives and tens: $11 not $10, $23 not $20.
- Estimate the 70th percentile rival bid from league history, add an edge
  ($1-2 on $100, $3-11 on $1000), and bid that ONLY if it is under your
  value ceiling. If the market price exceeds what the player is worth to
  your lineup, sit out. Do not bid "$1 over expected" on a player you do not
  need.
- Either/or claims: same drop player on each, so the second is voided when
  the first lands. Want both: different drops or an open spot.
- Sit out when: two or more available players project within a point of the
  headline name; the production was touchdowns without usage; the role lasts
  one game; the player cannot crack your lineup and has no contingent or
  dynasty value; a committee blocks any majority role; the drop has equal or
  greater future value.

## Signals, in order of weight

| Signal | Strong | Warning | Weight |
|---|---|---|---|
| Injury or depth chart change | starter on IR, traded, benched, out multiple weeks | vague day-to-day | 20% |
| Snap share | RB over 60%, WR/TE over 70%, or +15 points week over week | under 35% | 12% |
| Route participation | WR/TE 75%+ of dropbacks, RB 45-50%+ | high snaps, no routes | 12% |
| Targets | WR/TE 18-20%+ share, RB 3-5 targets | one or two catches on low routes | 12% |
| Carries and opportunity | RB 55%+ of backfield, 15+ expected touches | three-way split | 10% |
| Red zone | majority of carries inside the 10, repeated end-zone targets | touchdowns without red-zone work | 8% |
| Role persistence | multiweek injury, coach confirmation, earned promotion | one-game suspension, game script | 10% |
| Efficiency behind the volume | yards after contact, targets per route run | huge output on tiny volume | 4% |
| Offense and schedule | good offense, usable matchups | bad offense, unclear role | 4% |
| Add velocity | Sleeper adds backed by usage | hype only | 3% |
| Fits my lineup | replaces my weakest starter | bench only | 5% |

Tier score from those weights: 85+ league winner, 70-84 every-week or strong
multiweek starter, 55-69 handcuff or premium stash, 35-54 ordinary stash or
filler, under 35 streamer or pass. Override downward when the player cannot
enter the lineup and has no contingent or dynasty value.

## Sources worth ingesting

| Source | Shape | Use |
|---|---|---|
| FantasyPros waiver article | positions, then stashes, fool's gold, drops; three bid levels per player (True Value, Desperate, Budget) on $100 | the three-level frame maps straight onto standard / aggressive / walk-away |
| RotoBaller FAAB bidding | positional writeups with a FAAB percentage range | easy to parse |
| RotoWire waiver wire | per-player percentage-of-budget suggestion | scales to any budget |
| FTN waiver wire tool | ranked table, final Tuesday, rank plus FAAB percentage | machine friendly |
| Fantasy Life waiver tool | sortable table, weekly and ROS projections and ranks | best for weekly plus rest-of-season together |
| Fantasy Life utilization report | snaps, routes, route participation | a signal feed, not a bid feed |
| PFF usage and production report | snaps, routes, TPRR, carry share, red zone, aDOT | role confirmation; may be paywalled |
| Dynasty Nerds waiver wire | dynasty table with rostership and FAAB percentage | the dynasty editorial source |
| Dynasty Daddy waiver tool | bid estimator on observed winning bids from millions of leagues | market price feed |
| Sleeper transactions | every winning and losing bid after processing, every team's balance | the league-specific market, and the only one that matters most |

A tool should dedupe players across sources, convert every number to percent
of original budget, label the source's format assumptions, and keep median
and maximum rather than averaging away the disagreement.

## The bid model the tool should run

Inputs: league (format, scoring, starters, week, playoff weeks, original and
remaining FAAB, minimum bid), team (record, points, playoff odds, contender
or rebuilder, weakest starters, drop candidate), player (projection weekly
and rest-of-season, dynasty value, usage signals, depth chart, injury-created
opening), market (rostership, add velocity, analyst ranges, league winning
bids, rival balances, tiebreak priority), timing (role duration, weeks left,
byes, playoff schedule, drop-waiver expiry).

```
value ceiling = original budget
              x tier midpoint
              x lineup need        (0.75 / 1.0 / 1.25)
              x urgency            (record and playoff odds, above)
              x format             (PPR table, above)
              x role confidence    (0.7 / 0.95 / 1.2)
              x dynasty timeline   (contender 0.6-1.2, rebuilder 0.3-1.3)
              x season timing      (redraft: 1.15 weeks 2-4, 1.0 mid, 0.75 late)

market bid   = 70th percentile rival bid + edge

bid          = market bid <= value ceiling ? min(remaining - reserve, market bid)
                                           : fallback or pass
```

## Where dynasty and redraft part ways

| | Dynasty | Redraft |
|---|---|---|
| Value horizon | this season plus future years | remaining 2026 games |
| Ordinary bid | $5-30 of $1000 | $0-5 of $100 |
| Breakout premium | young players with durable roles | immediate season-long starters |
| Streamers | almost always $0-10 | $0-5 |
| Contender or rebuilder | essential | not applicable, use record and odds |
| Bench value | future trade and contingent value count | near zero unless handcuff or near-term starter |
| Playoff reserve | $100-150 for contenders | $10-15 if safely in |
| End of season | spend everything, buy offseason value | spend everything on the matchup and on blocking |

## Sources

Researched 2026-09-15 via Perplexity. Sleeper support (FAAB and waivers,
invalid claims, waiver clear days); FantasyPros (FAAB study of 340,000+
dynasty adds, 2024 redraft bid distribution, waiver wire article structure,
FAAB strategy guides); Dynasty Trade Generator dynasty FAAB guide; Dynasty
Nerds weekly waiver wire; Dynasty Daddy waiver tool; RotoBaller FAAB bidding;
RotoWire waiver wire; FTN waiver wire tool; Fantasy Life waiver tool and
utilization report; PFF usage and production report; 4for4 FAAB strategy;
Pro Football Network on FAAB timing; FantasySP on record-based FAAB;
r/DynastyFF and r/fantasyfootball practitioner threads.
