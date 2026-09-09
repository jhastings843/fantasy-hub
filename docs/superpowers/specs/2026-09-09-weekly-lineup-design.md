# Weekly lineup tab

2026-09-09. A per-league tab that reads his weekly rankings and the league's own
roster, and says who to start and why.

## Why this is two pieces, not one

The tab was asked for on the understanding that his weekly rankings were already
being ingested. They are not, and finding out why changed the design.

The deployed app's ingest run on 2026-09-09 reports:

```
skipped: "2026 Week 1 Fantasy Football Rankings"
reason:  "paid post, and no mailbox is configured here to read the emailed copy"
```

Everything the app holds is season-long: three copies of the Lab 300 (half PPR,
full PPR, standard), 300 rows and 14 tiers each, all posted 2026-09-05. Nothing
weekly has ever been read.

Two separate reasons, and both have to be fixed:

1. `GMAIL_ADDRESS` and `GMAIL_APP_PASSWORD` are set in `.env.local` but not in
   Vercel, so production cannot open the mailbox at all. Jack's action, not a
   code change.
2. Even with the mailbox open, the post would still be dropped. It classifies as
   `rankings`, so `ingestRankings` handles it; `detectScoring` reads the title
   plus the first 2000 characters of raw HTML, which on an emailed post is
   Substack's stylesheet, so it returns `unknown` and the function bails with
   "could not tell which scoring this list is for". He states the scoring in
   prose, several thousand characters in.

Worth saying plainly, because the first version of this document claimed
otherwise: there is no risk of the weekly list overwriting the Lab 300. The
`unknown` guard stops it before the store. The bug is silence, not damage.

And a third reason it would fail even past that guard: the existing parser
cannot read the post. `parseRankings` returns **0 rows** on the real Week 1
HTML, because the two posts are different shapes.

## What his weekly post actually is

Fetched from the mailbox and parsed on 2026-09-09. Week 1, posted 2026-09-08.

| Section | Rows | Row shape |
| --- | --- | --- |
| QB Rankings | 32 | `1: Joe Burrow \| CIN vs TB` |
| RB Rankings | 65 | same |
| WR Rankings | 80 | same |
| TE Rankings | 32 | same |
| D/ST Rankings | 24 | same |
| Kicker Rankings | 24 | same |
| Top 150 FLEX Rankings | 150 | `1: Jahmyr Gibbs \| RB \| DET vs NO` |

Section headers are `<h4><strong><span>QB Rankings</span></strong></h4>`. Rows
inside a section share one `<p>` and are separated by `<br>`, with the team
bolded, which is the same markup habit the Lab 300 parser already copes with:
`htmlToLines` splits it correctly and was verified against this post.

Five things follow from the shape, and each one is a design constraint.

**It is one list, half PPR.** He writes "Everything below is ranked for
Half-PPR", then gives written advice for other formats rather than publishing a
second list. Unlike the Lab 300, there will be no full-PPR weekly file to prefer.

**Every row carries the matchup.** `CIN vs TB`, `BAL @ IND`. Free reasoning
material, and it makes home and away readable without a schedule lookup.

**The rows have no position rank.** A Lab 300 row is `rank | positionRank |
team`; a weekly row is `rank | team vs opponent`, and the rank is the position
rank because the list is already split by position. The FLEX list adds position
back as its middle field. This is why the existing parser returns nothing.

**The FLEX 150 is RB, WR and TE only.** Counted: 49 RB, 74 WR, 27 TE, no
quarterbacks. So his lists offer no number that compares a QB to a flex option.

**The post is edited in place all week.** "Updated live throughout the week",
with `Last Updated: September 8, 2026 at 6:30pm ET` in the body. Ingestion that
marks the post seen and moves on reads it once, on Monday, and never sees
Sunday's injury news.

## The leagues this has to serve

Read from Sleeper on 2026-09-09, not assumed.

| League | Type | Starting slots | Scoring |
| --- | --- | --- | --- |
| Dah Chopped | guillotine | QB, RB, RB, WR, WR, TE, FLEX, FLEX | full PPR, 4pt pass TD |
| Sunday Scaries #2 | redraft | QB, RB, RB, WR, WR, TE, FLEX, FLEX | full PPR, 6pt pass TD |
| 2026 Half PPR | redraft | QB, RB, RB, WR, WR, TE, FLEX, FLEX, DEF | half PPR, 4pt pass TD |
| Dah Dynasty | dynasty | QB, RB, RB, WR, WR, TE, FLEX, FLEX, FLEX, SUPER_FLEX | full PPR, 6pt pass TD, TE premium 0.25 |

Three of the four are full PPR against a half-PPR list, so the scoring mismatch
is the normal case and not an edge case. One league starts a DEF, so his D/ST
list matters once. No league starts a kicker, so his Kicker list is ingested for
completeness and read by nothing.

Dah Chopped gets the tab. Jack's words: after waivers finish, he still has to set
a lineup. The FAAB advisor answers who to bid on, which is a different question.

## What already exists and is not being rebuilt

- `src/lib/guillotine/lineup.ts` has `bestLineup()`, which solves an arbitrary
  Sleeper `roster_positions` array, including `SUPER_FLEX`, `REC_FLEX` and
  `WRRB_WRT`. It fills the most restrictive slots first, which its own comment
  correctly argues is optimal for a nested eligibility family. Tested.
- `src/lib/guillotine/scoring.ts` has `scoreStatLine()`, a dot product of a
  Sleeper projection against the league's real scoring settings, so TE premium
  and bonuses fall out without special cases. `scoringSkewNotes()` already
  writes the sentence naming a list/league scoring mismatch and its direction.
- `src/lib/jingles/resolve.ts` maps his names to Sleeper ids, and reports
  unresolved and ambiguous rather than dropping them.
- `src/lib/league/types.ts` `LeagueProfile` already carries `ppr`, `passTd`,
  `tePremium`, `bonuses`, `superflex` and `rosterPositions`.

The lineup solver is general and only lives under `guillotine/` for historical
reasons. It moves to `src/lib/lineup/`, with `src/lib/guillotine/lineup.ts`
re-exporting so nothing in the FAAB advisor changes.

## Part A: weekly ingestion

### Parsing

New module `src/lib/jingles/weekly.ts`, pure, no network, no `server-only`.

```ts
export interface WeeklyRow {
  rank: number;          // rank within its own section
  name: string;
  position: string;      // from the section, or the row's middle field in FLEX
  team: string;
  opponent: string;
  home: boolean;         // "vs" true, "@" false
}

export interface ParsedWeekly {
  week: number;
  season: string;
  scoring: Scoring;      // read from the prose, defaulting to half_ppr
  updatedAt: string | null;   // from the "Last Updated" line
  positional: Record<string, WeeklyRow[]>;  // QB, RB, WR, TE, DEF, K
  flex: WeeklyRow[];
  missingRanks: Record<string, number[]>;
  duplicateRanks: Record<string, number[]>;
}
```

`parseWeekly(html, title)` walks `htmlToLines` output, switches section on a
header line matching `^(QB|RB|WR|TE|D/ST|Kicker) Rankings$` or
`^Top \d+ FLEX Rankings$`, and reads rows with two regexes, one per shape. It
keeps the Lab 300 parser's honesty contract: gaps and duplicates are reported per
section rather than quietly returning a short list.

Week and season come from the title (`2026 Week 1 Fantasy Football Rankings`).
Scoring is read from the body prose (`ranked for Half-PPR`), defaulting to
`half_ppr` rather than `unknown`, because he has one weekly list and a default
that stops the pipeline is worse than a default that is right.

### Classifying

`classifyPost` gains a `weekly_rankings` kind, tested **before** the existing
`rankings` branch, matching a title with both a week number and "rankings". The
Lab 300 path is untouched.

### Storing

New keys, never overlapping the season list:

```
jingles:v1:weekly:<season>:<week>   the parsed week
jingles:v1:weekly:latest            { season, week } pointer
```

`readWeekly(season, week)` and `latestWeekly()` mirror `readRankings`.

### Re-reading a post that changes

A `weekly_rankings` post is exempt from the `seen` set and is re-fetched on every
ingest run. It is written only when the parsed `updatedAt` differs from what is
stored, so an unchanged post costs one comparison. This is the whole reason his
"updated live throughout the week" line matters: without it the app would be
advising off Monday's ranks on Sunday morning.

### The mailbox in production

`GMAIL_ADDRESS` and `GMAIL_APP_PASSWORD` need setting in Vercel. Until they are,
`inboxConfigured()` is false and the weekly tab has no data. The tab must say so
in as many words rather than rendering an empty or invented lineup.

## Part B: the lineup tab

Route `src/app/l/[leagueId]/lineup/page.tsx`, joining the existing eight tabs.

### Ordering

His rank is the sort key. That is the point of the tab.

`bestLineup` compares players with a single number each, so every player needs
one score, not one per slot he might fill. The FLEX 150 is what makes that
possible: it is his own cross-position ordering of exactly the positions that
compete for more than one slot.

Each player gets one score, from the first of these that applies:

1. **In the FLEX 150** (RB, WR, TE): score from his FLEX rank. This orders him
   against every other flex-eligible player and, because his FLEX list agrees
   with his positional lists, it preserves his within-position order too, so an
   RB slot filled from this score still gets his best available back.
2. **Ranked in his positional list but outside the FLEX 150**, or a QB, DEF or K,
   who never appear in it: score from the positional rank, placed as a block
   below every flex-ranked player of the same position. A QB, DEF or K only ever
   competes inside his own slot, so his block position never matters; a
   deep RB or WR is genuinely behind the 150 he ranked.
3. **Unranked**: below both, ordered arbitrarily among themselves and never
   presented as a recommendation. See the unranked section below.

Concretely, `score = BASE - rank`, with a `BASE` per band chosen so the bands do
not interleave. No points are invented: the score expresses his order to a solver
that was written for points, and it is never shown anywhere in the UI.

The one place this single-score rule is deliberately overridden is SUPER_FLEX,
below, because Jack's rule for that slot is not "best available".

### SUPER_FLEX

Jack's ruling: superflex is always a QB unless injuries prevent it. So the slot
takes the best remaining QB by his QB ranking, and falls through to the best
remaining flex-eligible player only when no rostered QB is startable: none left,
out on bye, or carrying a Sleeper injury status that rules him out. The screen
says which of the two happened. No projection bridge, no invented conversion
between a QB rank and a flex rank.

This cannot be expressed through the scoring bands, and getting it wrong is easy.
`bestLineup` fills the most restrictive slot first, so `SUPER_FLEX` is filled
last, and quarterbacks sit in a band below every flex-ranked player. Left to the
solver, the slot would take a running back every time.

So SUPER_FLEX is resolved before the solve, not by it:

1. Take the best startable QB by his QB rank for the `QB` slot, then the next
   best for `SUPER_FLEX`.
2. Remove both players and both slots.
3. Run `bestLineup` on what is left.

If step 1 finds no second startable QB, `SUPER_FLEX` goes back into the slot list
and the solver fills it normally, and the screen says that is what happened and
why. This keeps `bestLineup` untouched, which matters because the FAAB advisor
depends on it.

### The half-PPR adjustment

Jack's ruling: show his rank and an adjusted rank.

The adjustment is only ever applied to leagues whose scoring differs from the
list, and both numbers are always on screen, labelled so it is obvious which one
is his.

Method, for each ranked player:

1. Pull the Sleeper weekly projection.
2. `halfPts = scoreStatLine(projection, halfPprSettings)` and
   `leaguePts = scoreStatLine(projection, thisLeaguesSettings)`. The difference
   is what the format is actually worth to that player: half a point per
   reception in full PPR, the TE premium in Dah Dynasty, and so on.
3. Build a points curve from his own order. Take the `halfPts` of every player in
   the list, sort descending, and read off the value at his rank. This gives rank
   *r* a point value with realistic spacing, without asserting that the player at
   rank *r* will score it.
4. `adjustedScore = curveAt(hisRank) + (leaguePts - halfPts)`.
5. Re-rank by `adjustedScore`. That is the adjusted rank.

A player with no Sleeper projection gets a zero delta, so his adjusted rank
equals his rank. Honest, and visibly so.

The adjustment is mine and not his, and the UI says that in one line, next to his
own written advice from the post ("bump up players who get a lot of their value
through receptions").

### Saying why

Every filled slot shows:

- the starter, his rank in the list that decided the slot, and his matchup
- the next best alternative and its rank, so the decision has a visible margin
- the adjusted rank alongside his rank whenever the league is not half PPR

Every unfilled or contested slot says which it is.

### Being honest about unranked players

He ranks 32 QB, 65 RB, 80 WR, 32 TE, 24 DEF and 150 FLEX. A rostered player
outside those is genuinely unranked, and there are three different reasons, which
the tab distinguishes rather than blurring:

- **Not in his list.** Sorted below every ranked player, badged "not in his Week
  N list", never silently last.
- **On bye.** Read from the Sleeper schedule, not inferred from absence.
- **Injured or out.** Read from Sleeper's injury status.

A lineup containing an unranked starter says so at the top, because that is the
slot Jack most needs to look at himself.

### The header band

Which list, which week, when he last updated it, whether it came from the feed or
the mailbox, and `scoringSkewNotes` when the league is not half PPR. If the
mailbox is unconfigured or the week has not been ingested, the band is the whole
page and there is no lineup.

## Testing

Fixtures follow the convention in `parse.test.ts`: a short verbatim excerpt that
preserves the real markup shape, plus synthetic full-size lists for integrity
checks. **The repository is public, so his paid post is not committed in full.**
The excerpt is a handful of rows per section, enough to prove the parser handles
the bolded team, the `<br>`-separated rows and both row shapes.

- `weekly.test.ts`: both row shapes, section switching, `vs` and `@`, the
  `Last Updated` line, week and season from the title, scoring from prose, and
  gap and duplicate reporting.
- `classifyPost`: a weekly title is `weekly_rankings` and a Lab 300 title is
  still `rankings`.
- Lineup tests, one per league slot configuration taken from the real table
  above, including Dah Dynasty's SUPER_FLEX with and without a second startable
  QB.
- Adjustment tests: a high-reception back rises in full PPR, a touchdown-
  dependent back does not, a player with no projection keeps his rank.
- An unranked starter is badged, not sorted silently last.

## Order of work

1. `weekly.ts` parser and its tests.
2. `classifyPost` branch, weekly store, exemption from `seen`.
3. Jack sets `GMAIL_ADDRESS` and `GMAIL_APP_PASSWORD` in Vercel, then a forced
   ingest run confirms Week N lands.
4. Move the solver to `src/lib/lineup/`, re-export from guillotine.
5. The tab.

Steps 1 and 2 are worth shipping alone: they end the silent skip whether or not
the tab follows immediately.

## Out of scope

- A second weekly list for full PPR. He does not publish one.
- Kicker recommendations. No league starts one.
- Projecting anything ourselves. Sleeper's projections are used only to measure
  the size of a scoring difference, never to rank a player.
- Automatic lineup submission to Sleeper. This tab advises; Jack sets the lineup.
