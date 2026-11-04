# /pickem on college football: bad luck or broken?

Written 2026-11-04 from a phone session. Short answer: **the repo can't settle it, because the /pickem picks and their results were never saved anywhere this session could read.** What can be checked points to "mostly variance on top of a near-zero edge", plus one real structural lever (stale pool lines) and two process fixes.

## 1. What I could and couldn't read

| Thing | Status |
|---|---|
| The skill itself (`~/.claude/skills/pickem/SKILL.md`) | **Not read.** It lives outside this repo and the session had no permission to open it. Everything below about how it decides comes from the app code it leans on, not the skill text. |
| Past /pickem CFB slates, picks, results | **Not in the repo.** No log, no saved slate, no picks file. `git log` has no /pickem CFB entries. The Sleeper pool the app tracks is NFL, straight up. |
| Hobby Hub's graded CFB games (Redis `picks:v2:cfb:core`) | Exists in production Redis. Running the read-only script to pull it needed approval this session didn't have, so **not read.** |
| One recorded number | HANDOFF.md line 169: `pem_breaks_tie 40-50-3`, an unanswered offer to have /pickem follow David instead of PEM on CFB splits. |
| CFB line history 2014-2025 | Local cache (`.cache/cfb`), used for section 4. |

So there is **no reconstruction of the last several weeks** and no top-25 vs rest split of Jack's actual picks. I did not estimate one.

## 2. How the CFB picks are made (from the app code)

- **Against the spread:** Sam and David (two outside models) each give a line. When both sit on the same side of Vegas, that's a pick (`engine.ts` `read`). When they split, PEM (@FansOfCFB's model, college only) breaks the tie (`pemSplit` cut). The tie-break is the `pem_breaks_tie` record.
- **Which agreement games count:** about 24 "cuts" (dog, favorite, edge 3+, within 4 of Vegas, PEM agrees, and so on) are graded each week. The one with the best low end of its 90% range becomes the rule, with as few as **10 graded games** allowed (`MIN_SAMPLE = 10`). College is grandfathered on `near-vegas` for 2026 (`chosen-store.ts`).
- **Straight up:** the Vegas favorite (`policy.ts` `SU_DEFAULT.cfb = "vegas"`).
- **Our own CFB ratings model** is tracked but has no ATS edge in its own backtest: 2024-25 at the close, 902-886 (50.4%); edge 3+ 479-482 (49.8%) (`.cache/fit-cfb-spread.txt`).

## 3. Is a bad stretch inside normal variance?

In a pool there's no juice, so a coin flip is 50%. Computed in code (binomial):

| Picks in the stretch | Normal range at a true 50% (90%) | Chance of 40% or worse with **zero** edge |
|---|---|---|
| 20 | 6 to 14 wins | 25% |
| 30 | 11 to 19 | 18% |
| 40 | 15 to 25 | 13% |
| 50 | 19 to 31 | 10% |

At about 10 top-25 games a week, four weeks is 40 picks. **Going 16-24 (40%) over that stretch would happen about 1 time in 8 with no edge at all**, and about 1 in 15 even with a real 53% edge.

The one real number: `pem_breaks_tie` 40-50 (44.4%) on 90 picks. That's z = -1.05 against 50%. A 50% picker does that badly or worse 17% of the time. **Not proof PEM is broken, but there's no evidence it helps either.**

To tell a true 55% picker from a coin flip takes about 620 picks; 53% takes about 1,700. No CFB pick'em sample this season comes close.

## 4. Are ranked games harder? (2019-2025 history, 4,286 FBS games)

"Top-25 matchup" here means both teams in that week's top 25 by pregame Elo. The cache has no AP poll, so this is a stand-in. Script: `research/pickem-cfb-ats.py`.

| | Both top 25 | One top 25 | Neither |
|---|---|---|---|
| Games | 425 | 1,355 | 2,506 |
| Favorite ATS at close | 50.8% | 49.7% | 48.9% |
| Home team ATS | 53.2% | 50.7% | 49.4% |
| Avg line move, open to close | **2.09 pts** | 1.64 | 1.52 |
| Side the line moved to, **at the opener** | **56.1%** (152-119) | 54.1% | 53.5% |
| Same side, at the close | 48.9% | 50.2% | 50.2% |
| Close's miss (SD) | 15.2 pts | 15.2 | 15.5 |

What this says:
- **Ranked games are not measurably sharper at the close.** The closing line misses by about the same amount everywhere, and no simple side (favorite, home) is far off 50%.
- **They move the most.** Ranked matchups move about 2 points open to close, a third more than other games. Whoever gets the early number wins about 54-56%; anyone picking at the closing number is back at 50%. **In big games, the timing of the line is worth more than the model.**
- Ignore the "Elo edge 7+" row in the script output (47-29 in ranked games): it's 76 games and one of nine tests, so I'm not treating it as a finding.

## 5. Possible structural causes, ranked

1. **Pool line vs current line (likely the biggest lever, not checked).** If the pool posts its spreads early in the week, they go stale fastest on exactly the games it picks. The models are scored against the *current* market, so a model "edge" in a ranked game is often just the move that already happened. When the pool's number is still the old one, that's the 54-56% side above. I can't see whether /pickem compares the pool's line with the current one, because I couldn't read the skill.
2. **Small-sample rule picking.** About 24 cuts are tried and the best low-end is chosen once it has 10 games. The best of 24 at 10-30 games will look better than it really is, then regress. That pattern shows up as "looked good, then went cold."
3. **PEM as tie-breaker:** 40-50-3, no sign it helps. Splits are the games where two models disagree, which are close to coin flips anyway.
4. **College inputs are thinner than NFL.** No injury data for college (HANDOFF 11-02), and our own ratings model has no ATS edge. Sam and David are the whole signal.
5. **Home team in ranked games** ran 53.2% (z +1.2) over seven seasons. Too weak to use.

## 6. Recommendations

**Honest answer: a cold month on ~40 top-25 picks is normal variance for a near-coin-flip edge, and there isn't enough data to call the model broken.** Don't retune weights off this stretch. Three changes are still worth making because they cost nothing and make this answerable next time:

1. **Start logging every /pickem CFB slate** (needs a desk session, since the skill lives outside the repo). One row per game: date, week, pool name, ATS or straight up, home, away, both AP ranks, pool line, current DraftKings line when picked, Sam, David, PEM lines, the pick, the reason (agree / PEM tie-break / other), the tier if any, final score, result. Save it to Redis or a repo file, then grade it weekly. After about 8 weeks this report can be rerun on real picks.
2. **Check the pool line against the market before each pick.** When the pool's number is 1.5+ points off the current line, take the side the market moved toward, whatever the models say. That's the 54-56% edge in section 4, and it's biggest in ranked games. Log it as its own reason so it's graded separately.
3. **On splits, stop letting PEM decide.** Either follow David (the open offer in HANDOFF) or use the pool-vs-market check from item 2. PEM can stay as a logged third opinion with no say until its tie-break record is clearly above 50% on 100+ picks.

Not recommended yet: separate model weights for ranked games, fading favorites, or dropping Sam or David. None of it clears the noise.

## Reproduce

```
python3 -I research/pickem-cfb-ats.py
```

Reads only `.cache/cfb` (local, git-ignored). The variance table came from a binomial calculation in this session.
