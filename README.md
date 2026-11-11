# Fantasy Hub

Fantasy football tools built on Sleeper league data plus RosterAudit, FantasyCalc,
and KeepTradeCut player values.

## Waiver email rule

Claims go in Tuesday night, so the midweek waiver email never waits on a
source. Jingles and Flock lead redraft when posted; other sources fill in only
when they have not. Dynasty and redraft are researched and recommended
separately. Full rule and examples: `docs/faab-strategy.md` ("Standing rule").

## Sections

| Route | What it does |
| --- | --- |
| `/dynasty` | Roster with live values, league standings, team-value rankings |
| `/dynasty/plan` | Season trajectory, auto goals from league data, custom goals, key dates |
| `/dynasty/draft` | Live rookie board, draft slot and picks, weakest-position fits |
| `/dynasty/trade` | Trade analyzer with positional fit and 2026-2029 pick values |
| `/dynasty/players` | League search, waiver scouting, risers and fallers |
| `/survivor` | NFL survivor pool strategy tools |
| `/resources` | Curated calculators, ranking sites, draft prep, writers |

## Stack

Next.js 16 (App Router), React 19, Tailwind CSS 4, TypeScript, Upstash Redis for
caching external API responses.

## Local development

```bash
pnpm install
cp .env.local.example .env.local   # then fill in the values
pnpm dev
```

Open http://localhost:3000.

### Environment variables

| Variable | Purpose |
| --- | --- |
| `UPSTASH_REDIS_REST_URL` | Upstash Redis endpoint for the response cache |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis token |
| `SLEEPER_LEAGUE_ID` | Sleeper league to load |
| `SLEEPER_USERNAME` | Sleeper user whose roster is treated as "yours" |
| `ROSTERAUDIT_API_KEY` | RosterAudit API key for player values |

## Deploy

Deployed on Vercel. `pnpm build` runs the production build locally.
