# Guillotine FAAB strategy: the researched basis

Compiled 2026-09-01. Everything the recommendation engine encodes, with the
numbers and where they came from. Percentages are of the ORIGINAL budget, which
matters because published advice quotes dollars against a $1000 budget and Dah
Chopped is a $1000 league, so those figures transfer directly.

## The market

One full roster is released every week. That is the fact that makes this format
different from every other waiver wire: **missing this week's star does not mean
there will be no more stars.** There are 15 more chops coming in a 16-team
league.

Three forces run in opposite directions:

- Supply rises. Later chopped rosters are *stronger*, because the weak teams
  are gone. A Week 12 chop can release five real starters.
- Demand falls. Bidders disappear one per week.
- Your money never comes back, and it dies with you.

Fantasy Life's illustration of the price decay, historical winning bids on one
elite TE: **$486 in September, $310 in October, $222 in November, $53 in
December.** Their slogan is that a dollar in September is worth ten in
December. Overstated, but directionally the whole game.

RotoWire frames it as purchasing-power share rather than balance: $800 held is
5.56% of an opening $18,000 market in an 18-team league, but 16% of a $5,000
November market. **Track share, not dollars.**

The counterweight, and it is the one that actually eliminates people: unspent
FAAB is worth exactly zero after you are chopped. Conservation is only correct
while you are safe.

## Pacing

Synthesis. Cumulative spend from the original budget.

| Phase | Normal spend | Endangered | Elite target bid | Temporary starter | Band-aid / stash |
|---|---|---|---|---|---|
| Weeks 1-4 | 0-10% | up to 30% | 10-20% | 0.3-4% | 0-1% |
| Weeks 5-9 | 10-35% | 35-50% | 10-25% | 2-8% | 0-2.5% |
| Weeks 10-13 | toward 70-90% spent | same | 10-35%+ | 2-5% | min bid |
| Endgame | whatever improves the lineup or denies a rival | | rival max + $1 | | |

Named benchmarks:

- **Fantasy Life, monthly:** keep $900+ of $1000 after September (no more than
  $300 spent even in a dire September), ~$750 after October, ~$250 after
  November.
- **Fantasy Life, by roster strength:** top-four teams should hold 80-95%;
  middle four 65-80%; bottom four 50-65%.
- **RotoWire, after Week 2 on $1000:** up to $200 for a championship starter,
  $40 for a probable starter, $10 for a streamer. That is 20% / 4% / 1%.
- **DraftSharks:** 70-75% of the budget to roster anchors, 25-30% to depth.
- **Fantasy Life, endgame:** with 35-65% left, bid 2-5% on useful mid-tier
  players who are past their bye; with 65%+, overpower rivals for true elites.
- **Practitioner (Reddit, 10-year player):** ~80% remaining at Weeks 10-12,
  small bids until then. More conservative than Fantasy Life.

**Where sources disagree.** The capital-preservation school (Fantasy Life,
RotoWire, DraftSharks) caps early elite buys near 15-20%, on the logic that
supply is guaranteed and competition shrinks. An early-utility/barbell school
permits 30-50%, occasionally 70%, but only for a genuinely transformational
acquisition. The reconciliation the engine uses: **pay early only when your
survival risk is materially elevated AND the player is still an endgame
starter.** Otherwise bid to enforce a price and let someone else overpay.

**Pacing baseline the engine actually uses**, because calendar phases were
written for an 18-team league running to December and Dah Chopped is 16 teams
from Week 1:

```
neutral allowance = remaining FAAB / eliminations remaining
```

$1000 over 15 chops is about **$67**. It is a reference point, not a spend
target. A true anchor is worth several allowances; a band-aid a fraction of one.

## The weekly spend trigger

Assess before looking at any player names.

```
survival margin = your conservative projection - projected chop line
```

Conservative means: floor rather than median for volatile players, zero for
likely inactives, real replacements for bye starters, and correlated downside
for same-offense stacks.

| Posture | Condition | Action |
|---|---|---|
| **Green** | 15-20+ points clear of the line, several visibly weaker teams, no zero-risk starter slots | Sit out the big bidding. Minimum bids and price enforcement only. |
| **Yellow** | Within 5-15 points, one weak starter, volatile players, a bye or questionable tag | One high-floor starter, plus cheap backup chains. |
| **Red** | At or below the line, multiple byes or injuries, you beat only one or two teams | Repair the lineup now. Future purchasing power is irrelevant if you are chopped. |

Fantasy Life's champion profile: a strong team averages **20-30 points above the
chop line** and keeps a 10-20 point cushion even after an injury. A weak team
sits within ~10 points of the line or is one injury from it.

Spend above the phase allowance when: a starter is out and the replacement is
near-zero usage; two or more starters share a bye; multiple game-time decisions
with no late alternative; your eight starters would look weak in an ordinary
league of the same size; a clear-role post-bye player fixes your biggest hole
for weeks; or teams around the line are upgrading and you are not.

Hold when: you merely did not score near the top; the upgrade improves your
bench not your lineup; the player has an imminent bye, an injury, or one
unsustainable spike week; the same position will be resupplied soon; or the gain
is 2-3 projected points for 10-20% of budget.

## The inversion

The format flips from "do not finish last" to "outscore the survivors". It is
gradual, but the practical inflection is **five or six teams remaining**, and it
is absolute in the final two. Keyed to teams remaining, never to date: in a
16-team league chopping from Week 1, five teams remain around Week 11.

Before it: floor, volume, health, consistency. Boom/bust players are how you get
chopped.

After it: ceiling and touchdown equity matter more; bench depth loses value
unless it protects an irreplaceable starter; **denial becomes legitimate**,
buying a star purely to keep a rival from having him. Fantasy Life's ideal end
state is eight of the top 32 fantasy players in an eight-starter format, which
is exactly Dah Chopped's format.

Final two: leftover FAAB is worth zero. Map the opponent's exact needs and
maximum bid, and bid their max + $1 on anything you must have.

## Bidding tactics

- **Non-round numbers.** $187, not $200. If a rival has exactly $84, bid $85,
  not $91. The ideal win is $1 over second place, not $100 over.
- **Bid on everything worth having at a price you would be happy to pay**, and
  expect to lose most. Small bids on stars set a price floor and occasionally
  catch a sleeping room.
- **Fallback chains, not independent claims.** Order claims that drop the SAME
  player, so alternatives are mutually exclusive. Independent claims with
  different drops can win all at once: a $180 RB, $140 WR, $70 TE and $35 RB
  each look fine alone and total $425.
- **Always compute max possible spend** as the sum of the highest
  simultaneously-winnable claims, assuming every bargain bid wins.
- **Not always the famous name.** The best value is usually the chopped
  roster's second or third starter, a clear-role player with a boring name,
  someone already past his bye, or a player cut by a surviving team to make room
  for the star everyone chased.

Tiers, and what they are worth:

| Tier | Definition | Early bid |
|---|---|---|
| Championship starter | Would start for you in the final four | 15-20%, more only under emergency |
| Multiweek starter | Clear role now, likely replaced by November | 1-5% |
| Band-aid | One matchup, injury fill-in, bye cover | 0-0.5% |
| Upside stash | Needs an injury or role change | 0-0.5%, prefer minimum |

## Byes

Chart every starter's bye four weeks ahead. Buy coverage *before* the week of
desperation. Break close valuation ties toward later byes early in the year, and
inflate anyone already past his bye. Do not pay a premium for bench-only bye
cover; buy a cheap clear-role body. Weeks 5-6 byes are the dangerous ones,
because the pool is still thin.

## How people get eliminated

Ranked by how often they show up in the sources:

1. Spending 50-100% on the first chopped superstar, leaving nothing for the
   seven other starting spots.
2. Saving dogmatically while projected last. FAAB has no value after
   elimination.
3. Death by a thousand cuts: repeated 5-15% bids on marginal upgrades, never
   acquiring an anchor.
4. Bidding on reputation instead of role, health, matchup and usage.
5. Chasing last week's points, which are mostly touchdown variance.
6. Ignoring byes until the week arrives.
7. Starting a questionable or inactive player. One zero ends a season here.
8. Overstacking one NFL offense, so one bad real game sinks several starters.
9. Uncontrolled multiple claims blowing the budget in a single run.
10. Holding too much in the final four, where there may be no later chance.

## League size and budget

| | 18 teams | 16 teams (Dah Chopped) | 12 teams |
|---|---|---|---|
| Eliminations | 17 | **15** | 11 |
| Your opening share of league FAAB | 5.6% | **6.25%** | 8.3% |
| Neutral allowance per chop, $1000 | $59 | **$67** | $91 |
| Inversion (5-6 left) | Weeks 12-14 | **~Week 11** | Weeks 6-8 |

Smaller leagues mean stronger opening rosters, less tolerance for an obvious
hole, and a faster clock: pace on eliminations remaining, never on the date.

Budget size changes resolution, not economics. $1 is 0.1% of $1000 but a full
1% of $100, so convert every published dollar figure to a percentage before
applying it. Dah Chopped is $1000, so RotoWire's figures apply as written.

## What last week's score is worth

Researched 2026-09-15, after a week where this team scored 59.7 against a
109 projection, finished second to last, and the report called it safe.

The instinct is to shrink the projection toward the scoreboard. The evidence
says not to, or barely:

- Weekly projections already update on snaps, targets, carries, injuries and
  inactives (RotoWire, which is Sleeper's source). Adding the raw score on top
  double counts what was real about the week.
- A trailing five-game fantasy average predicted the next week worse than a
  current projection did (MAE 5.54 vs 4.96 over 6,953 player-weeks). If five
  games lose to the projection, one game gets almost no weight.
- Week 1 regresses hard: players who opened with 25+ points averaged 16 the
  rest of the way. Direction is informative, magnitude is not.
- The only fitted blend in the literature (Footballguys) gave four games of
  production about 21% against projection and ADP. A shrinkage that gives one
  game 25% is several times too aggressive.
- Fantasy Life's guillotine guidance: do not panic on normal September
  weakness; judge the roster forward against the field.

So the engine shows last week's finish and does not model it. What does move
the posture is forward-looking lineup quality, which every source endorses
and none of the raw-score methods capture:

- A starter left in the submitted lineup who will not play, or an empty slot.
  Free to fix, so it is a caveat, not a posture change.
- The one-absence floor: the best lineup with its most important starter
  removed. If that lands inside the range where the low score falls, a green
  week becomes yellow: buy cover before the week you need it.
- Two or more starters with a questionable or doubtful tag. Doubtful is
  simulated as a zero, per the "zero for likely inactives" rule above.
- Thin slots: where the bench replacement gives up six or more points.

Points left on the bench in hindsight are not used as a predictor; the
sources are explicit that a surprise bench eruption is another noisy outcome.
