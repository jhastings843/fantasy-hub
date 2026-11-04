# /pickem pick log

Every pick the `/pickem` skill makes, one JSON object per line, so a later session can grade the record and split it without reading prose. Not shown anywhere in the app.

Started clean on 2026-11-04. Nothing earlier was recoverable: the repo had no saved /pickem slates, picks or results (the only number on file is the aggregate `pem_breaks_tie 40-50-3` in HANDOFF.md, with no game list behind it).

## Where it lives

- `data/pickem/<league>-<season>-w<NN>.jsonl`, for example `cfb-2026-w11.jsonl`. Bowls and playoff go to `cfb-2026-post01.jsonl` (ESPN season type 3).
- Code: `scripts/pickem-log.mts` (the command), `src/lib/pickem-log/log.ts` (fields, grading, splits; tests beside it).
- The repo is public, so this file is too. Keep pool names generic if they shouldn't be public.

## Commands

Run from `~/Projects/fantasy-hub`. No keys, no paid calls (ESPN's public feed).

| Do | Command |
|---|---|
| Log picks | `npm run -s pickem -- log --file picks.json` (or pipe JSON on stdin) |
| Check picks without writing | add `--dry` |
| Grade every week with ungraded picks | `npm run -s pickem -- grade` |
| Grade one week | `npm run -s pickem -- grade --league cfb --season 2026 --week 11` |
| Regrade (overwrite results) | add `--regrade` |
| Record splits | `npm run -s pickem -- stats --league cfb` (add `--json` for machine output) |

**Grade within the season.** ESPN keeps the DraftKings open/close on a game's summary only for a while: 2026 games have it, 2025 games no longer do. A pick graded late still gets its score and W/L, but `close` and `clv_points` come back null. Grading Sunday or Monday after each slate is ideal; the skill also runs `grade` at the start of every run.

A game that isn't final, or whose names don't match ESPN's, is listed as "waiting" and left ungraded; rerun later. Name mismatches are fixed by adding the spelling to `CFB_ALIASES` in `src/lib/picks/parse.ts`.

## One record

`log` takes the fields marked **in**; the rest are filled.

| Field | | Meaning |
|---|---|---|
| `v` | | Schema version (1). |
| `id` | | `league-season-wWEEK-pool-market-away@home`. Same game in the same pool and market = same id. |
| `run_id` | | One per skill run. If a slate is rerun, the **latest** `logged_at` per `id` is the pick that counts; earlier ones stay for history. |
| `logged_at` | | When it was written (UTC). |
| `date` | in | Slate date, `YYYY-MM-DD`. |
| `league` | in | `cfb` or `nfl`. |
| `season`, `week` | in | ESPN's season and week (the grader looks the game up there). |
| `seasontype` | in, optional | 2 regular season (default), 3 bowls/playoff. |
| `pool` | in, optional | Pool name, if Jack runs more than one. |
| `market` | in | `ats` (against the spread) or `su` (straight up). |
| `home`, `away` | in | `{ name, rank }`. `rank` is the AP or CFP number at pick time, null if unranked or unknown. |
| `rank_source` | in, optional | `AP` or `CFP`. |
| `neutral` | in, optional | True for a neutral site. |
| `line` | in (ATS) | The number the pick was made against, **home side** (`-6.5` = home gives 6.5): `{ home, source, as_of }`. `source` says where it came from: `pool`, `DraftKings via ESPN`, and so on. Null on an SU pool with no line. |
| `market_line` | in, optional | The live market number at pick time when `line` is the pool's posted line. Same shape. |
| `total` | in, optional | `{ value, source }` if a total was used. |
| `pick` | in | `{ team, side }`, side `home` or `away`. |
| `favorite` | | `home` / `away` by `line` (else `market_line`); null on a pick'em line. |
| `confidence` | in, optional | Pool confidence points. |
| `tier` | in, optional | Tier or rule label the skill gave (`t1`, `t2`, `near-vegas`, ...). |
| `edge` | in, optional | Points of edge vs the line, if computed. |
| `reason` | in | Why this side: `agree` (Sam and David same side), `pem_tiebreak`, `david_tiebreak`, `market_move` (pool line stale vs market), `vegas_favorite` (SU default), `other`. |
| `models` | in, optional | Home-side lines at pick time: `{ sam, david, pem, ours }`, null where missing. |
| `summary` | in, optional | One or two sentences on what the skill said. |
| `result` | | Null until graded, then: |
| `result.final` | | Final score `{ home, away }`. |
| `result.su` | | W/L/P for the picked team, straight up. |
| `result.ats` | | W/L/P against **`line`** (the number we picked at). Null without a line. |
| `result.graded` | | The one that counts: `ats` for ATS picks, `su` for SU picks. |
| `result.close` | | DraftKings `{ open, spread, total_open, total }` via ESPN, home side. Null if ESPN had none. |
| `result.clv_points` | | Points better (+) or worse (-) than the close for our side at `line`. |
| `result.ranks_espn` | | ESPN's scoreboard rank that week (AP, then CFP once out). Used for ranked splits when the skill logged no rank. |
| `result.source` | | ESPN event id. |

## Splits `stats` prints

All on the latest pick per `id`, graded picks only: `all`, `market` (ATS vs SU), `league`, `ranked` (both / one / neither team top 25), `picked_ranked`, `fav_dog`, `home_away` (neutral apart), `tier`, `reason`. Each row is W-L-P, win % of decided games, and average CLV.

## Section for the skill (`~/.claude/skills/pickem/SKILL.md`)

Paste this in as the skill's last section. It was not added on 2026-11-04 because that session couldn't open files outside this repo.

````markdown
## Log every pick (always, silently)

The picks are logged to Hobby Hub's repo so the record can be graded. Do this on every run, after giving Jack his picks, without mentioning it unless it fails. Field guide: ~/Projects/fantasy-hub/data/pickem/README.md.

1. Before picking, grade anything old: `cd ~/Projects/fantasy-hub && npm run -s pickem -- grade`. Ignore "waiting" lines.
2. After the picks, write one object per game to a temp file and log it:
   `npm run -s pickem -- log --file /tmp/pickem-<league>-w<week>.json`
   Lines are HOME side (-6.5 = home gives 6.5). Use null for anything you don't have; never guess a rank, line or model number.
3. If it prints problems, fix the JSON and rerun. Then commit only the log: `git add data/pickem && git commit -m "pickem log: <league> week <n>" -- data/pickem`.

Example 1. Jack pastes "Ole Miss +6.5 at Georgia", ATS pool, CFB week 11; Sam -4, David -5 (home side), both say Ole Miss; you take Ole Miss, tier t1, edge 2.0; DraftKings had Georgia -7 at 10:15am:
```json
[{"date":"2026-11-07","league":"cfb","season":2026,"week":11,"market":"ats",
  "home":{"name":"Georgia","rank":3},"away":{"name":"Ole Miss","rank":12},"rank_source":"AP",
  "line":{"home":-6.5,"source":"pool","as_of":null},
  "market_line":{"home":-7,"source":"DraftKings via ESPN","as_of":"2026-11-04T15:15:00Z"},
  "pick":{"team":"Ole Miss","side":"away"},"tier":"t1","edge":2.0,"reason":"agree",
  "models":{"sam":-4,"david":-5,"pem":null,"ours":null},
  "summary":"Both models have Georgia by 4-5, so the 6.5 is too many."}]
```
Example 2. Straight-up pool, no line posted, Texas A&M (no. 3) hosting Missouri, you take the Vegas favorite with 14 confidence points:
```json
[{"date":"2026-11-07","league":"cfb","season":2026,"week":11,"market":"su",
  "home":{"name":"Texas A&M","rank":3},"away":{"name":"Missouri","rank":null},"rank_source":"AP",
  "line":null,"market_line":{"home":-9.5,"source":"DraftKings via ESPN","as_of":null},
  "pick":{"team":"Texas A&M","side":"home"},"confidence":14,"reason":"vegas_favorite",
  "summary":"Vegas favorite by 9.5; straight-up default."}]
```
Example 3. Sam and David split on Iowa -3 vs Purdue at home, PEM breaks it to Purdue:
```json
[{"date":"2026-11-07","league":"cfb","season":2026,"week":11,"market":"ats",
  "home":{"name":"Iowa","rank":null},"away":{"name":"Purdue","rank":null},
  "line":{"home":-3,"source":"pool"},"pick":{"team":"Purdue","side":"away"},
  "reason":"pem_tiebreak","models":{"sam":-5,"david":-1.5,"pem":-1},
  "summary":"Split; PEM has Iowa by 1, so Purdue +3."}]
```
````

(The example games and numbers above are made up to show the format. They are not logged picks.)
