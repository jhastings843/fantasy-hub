# Scheduled updates: the pulse

2026-09-14

## The problem

Every number in this app is pull-on-view. A page fetches, caches into Upstash
behind a TTL, and nothing refreshes until somebody opens that page again. The
TTLs are honest (odds 15 min, Yahoo pick percentages 15 min, injuries 30 min,
movers and grades 1 hr, values 6-12 hr) but they only describe how stale an
answer is allowed to be when it is asked for. Nobody asks at 11:40 on a Sunday.

Vercel Hobby allows two cron jobs and both are taken: `/api/snapshot` at 08:00
ET and `/api/faab-email` at 09:00 ET. Hobby crons fire once a day, which is why
the Thursday email and the Jingles ingest are already piggybacked on the
snapshot behind their own day gates. There is no room left for anything faster.

## The shape

One endpoint, one external heartbeat, all tempo logic in code.

`GET /api/pulse` reads the clock in America/New_York, decides which tier of work
is due, does it, and returns a receipt. GitHub Actions calls it every 15 minutes.
The repo is public, so Actions minutes are free. Putting the tempo in code
rather than in cron expressions means DST cannot break it and the decision is
testable without a network.

### Tiers

| Tier | Window (ET) | Work |
| --- | --- | --- |
| `live` | Sun 11:00-20:00, Thu and Mon 18:30-23:30 | Odds, Yahoo pick percentages, injuries, Jingles feed, both survivor pools, lineup legality. Keys are dropped before the fetch, so this is a real refresh rather than a top-up |
| `hourly` | 07:00-23:00 otherwise, at most once an hour | Jingles ingest, survivor rebuild, lineups, waiver rebuild |
| `overnight` | the 04:00 hour, at most once every 12 | Values (FantasyCalc), traded picks, movers, the player list |
| `idle` | everything else | Nothing but the send check |

Every run also evaluates the send gates, so a missed run is never a missed
email: the next pulse catches it.

"Once an hour" is a Redis debounce on what last ran, not a minute window in
the schedule. GitHub's scheduler can deliver a run late, and a window would
drop that hour entirely when it did.

### The two Vercel crons stay

`/api/snapshot` and `/api/faab-email` keep their schedules and their internal
day gates. They stop being the only way an email can go out and become the
backstop for a GitHub Actions outage. Both paths share one send log per email,
so a double run cannot double send.

## The email week

Four scheduled sends and one exception send, all through the same shell, each
able to render an all-clear.

| When (ET) | Email | New? |
| --- | --- | --- |
| Tue 08:00 | FAAB and waivers | Exists, gains the season view |
| Wed 08:00 | Midweek: rankings moves, roster and waiver follow-ups | New |
| Thu 08:00 | Survivor and lineups | Exists |
| Sun 09:00 | Final check across every league and both pools | New |
| Sun 11:45 | Exception only | New |

The Sunday 11:45 send stays silent unless at least one of these is true:

- a starting slot holds a player who is OUT, inactive or on bye
- a starting slot is empty
- a survivor pool has no pick logged for the current week
- a logged survivor pick's win probability has fallen more than 5 points since
  the Thursday email

Silence is the normal outcome and is the point of it.

## FAAB season view

`planBudget` already paces the season: a hold curve anchored to the share of
eliminations completed, a 25% single-bid cap in the first half, weekly ceilings
of 2/8/30% by posture, and the phase flip at six teams alive. None of that is
visible unless you read the source.

A `seasonOutlook` function projects one chop per week forward and returns, for
the next three weeks, the hold floor and weekly ceiling, plus the week the field
is projected to reach six teams and pacing switches off. The `/faab` page and
the Tuesday email get a section showing spent against the curve, that
trajectory, and every rival's remaining FAAB ranked against yours.

## Failure handling

The pulse returns `{ tier, ran, skipped, errors }` and never fails the run for
one dead source: a Yahoo outage must not stop the odds refresh. The receipt is
written to Upstash under `pulse:last` and surfaced by `/api/health`, so a
heartbeat that quietly died is visible rather than inferred from stale numbers.

## Testing

`tempo.ts` (clock to tier and due sends) and the Sunday alarm predicate are
pure functions with no network, and get vitest coverage directly. The refresh
orchestration is thin enough to read.

## Cost

About 96 runs a day. Roughly 3k Upstash commands a day against a 500k monthly
free tier, and the live tier only touches upstream sources inside game windows.
GitHub Actions is free on a public repo. If the run count ever becomes a
problem the same endpoint can be driven by Upstash QStash without changing any
of the code above.

## Running it by hand

| Want | Call |
| --- | --- |
| What would the pulse do right now | `GET /api/pulse?peek=1` (no auth) |
| Is the heartbeat alive | `GET /api/health` (no auth; reports the last receipt) |
| Force a tier out of its window | `GET /api/pulse?tier=live` (auth) |
| Refresh without sending anything | `GET /api/pulse?sends=0` (auth) |
| Look at an email without sending | `GET /api/<midweek-email\|sunday-email\|lock-alarm\|thursday-email\|faab-email>?dry=1` |
| Send one again | add `?resend=1` |
| Run the whole thing from Actions | the `pulse` workflow, Run workflow, optional tier input |

## What this needs before it runs

`CRON_SECRET` has to be the same value in two places: the Vercel environment
variable (already set) and a GitHub Actions repository secret (not set). Vercel
will not hand back a stored secret, so matching them means rotating the value in
both. Until that is done every Actions run gets a 401 and the app keeps
behaving exactly as it did before, which is the right way for this to fail.

Optionally set the `APP_URL` repository variable if the deployment URL ever
changes; the workflow defaults to the current production URL.

## What the review changed

Astra reviewed this before it was committed and found ten things worth fixing.
The ones that would have bitten:

- **The alarm could not see an inactive.** A starter's status comes from the
  Sleeper projections feed, cached six hours, because `getAllPlayers` is
  slimmed and drops `injury_status` entirely. A player ruled out at 11:30 would
  have still read as questionable at kickoff, so the live tier now drops the
  projection caches before rebuilding lineups.
- **The pulse could burn the FAAB send on an apology.** Passing `force` to skip
  the day gate also skipped the "this report has something to say" gate, so a
  `no_projections` Tuesday would have emailed and recorded an apology, locking
  out the real guide. Split into `ignoreDayGate`.
- **Sunday could run past 60 seconds.** Two sends due at once, 25 seconds
  apiece, on top of the refresh. There is a 50 second budget now, a cheap
  "has this already gone" check before any report is built, and anything that
  does not fit waits for the next run.
- **Pacing does not switch off at six teams, it switches off at four.** Six is
  where the format inverts. The projection reports both, and the page and email
  say which is which.
- **A different pick on Sunday read as a line move.** The baseline is only a
  baseline for the team it was recorded against.
- **A failed overnight run blocked its own retries** for twelve hours, because
  the debounce recorded the attempt rather than the completion. Now an atomic
  lease claims the tier and only a finished run records it.
- **The all-clear was not earned.** "Nothing needs doing" keyed off the change
  count alone, which is also zero when a league could not be read or a pool has
  no pick.
- **IMAP once a day became IMAP dozens of times a day**, because a paid post
  sitting in the feed makes the inbox fallback fire on every ingest. Capped at
  twice an hour.
- Plus a Resend idempotency key per email, season and week, for the case where
  the send succeeds and the receipt write fails, and a projection stop once the
  league is down to a winner.
