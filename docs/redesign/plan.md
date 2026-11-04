# Hobby Hub redesign plan

Branch `redesign/hobby-hub`. Look: C3 (light) and teal terminal (dark). Inventory of every route: `inventory.md`.

## Hub map (final)

Ownership lives in one file, `src/components/hh/hubs.ts`. The top bar, the phone tab bar and the sub-tabs all read it.

| Hub | Opens at | Owns | Sub-tabs |
|---|---|---|---|
| Today | `/today` (and `/`) | `/`, `/today` | none |
| Bets | `/picks` | `/picks/*` except `/picks/model`, `/props/*`, the game and player pop-ups | Picks, Props |
| Fantasy | `/fantasy` | `/fantasy`, `/l/*`, `/survivor`, `/strategy`, `/resources` | Leagues, Survivor, Strategy, Resources |
| Money | `/money` | `/money/*` | none |
| Results | `/records` | `/records`, `/learning/*`, `/picks/model` | Records, Learning, Model record |

Changes from the draft mapping, and why:

- `/` now renders Today. The league list that lived there moved to the new `/fantasy` route, unchanged. The seven "‹ Leagues" back links in league pages now point at `/fantasy`. No URL was deleted; emails link to `/l/...`, `/picks`, `/survivor` and the app root, all still valid (root now lands on Today, which is the intent).
- `/picks/model` belongs to Results (it is method and track record, not a board). Its URL is unchanged; Results claims it before Bets does.
- Survivor stays under Fantasy as a sub-tab (Jack confirmed).
- `/picks/cbb/bracket` stays in Bets.
- `/picks?l=nba` (built by `lib/notify/golive.ts:115` and `lib/props/staked-core.ts:525`) rendered the NFL board. `/picks` now redirects `l=nba` to `/picks/nba`, keeping `v`. The lib code is unchanged.

## Decisions from Jack (2026-11-03, after the phase 1 preview)

1. `/` stays Today; the league list stays at `/fantasy`.
2. Survivor stays under Fantasy.
3. Spotlight: from Tuesday until 3am Wednesday ET (when the waiver leagues process claims), the top claim takes the box when one exists; every bet then stays in Next up. Otherwise the biggest issued bet not started, then a ready-to-send bet, then the top claim. Built in `today/page.tsx` (`waiverWindow`).
4. David gets a cooler second colour in the Bets pass (Sam stays rust).
5. Previews keep sharing the live Redis and Sleeper settings.

## Design system (done this session)

- Tokens: `src/app/globals.css` (`--hh-*`, light on `:root`/`.hh-light`, dark on `:root.dark`/`.hh-dark`) and `src/app/ledger-look.css`, which now repoints every Tailwind colour family per theme instead of forcing dark. Families: neutrals = paper/ink or slate; amber, orange = the accent (rust or teal); yellow and the old blue families = gold; emerald, green, lime = wins; rose, red = losses.
- CSS modules (`picks.module.css`, `bracket.module.css`) keep their local names; the values point at the shared tokens. Their forced-dark blocks are gone.
- Faces via next/font: Barlow Condensed (brand, nav, titles), Geist (body), Geist Mono (numbers, light), JetBrains Mono (numbers, dark).
- Contrast checked in code: muted text #6f685b (4.9:1 on paper; the mockup's #7a7262 was 4.25 and failed AA); small rust text uses #9a4520 (5.8:1); #b5562b is for fills, borders and large type.
- Components, `src/components/hh/`: `ui.tsx` (PageHead, Section, Spotlight, Disclosure, Num, Chip, Stat, Call, Row, Empty), `charts.tsx` (Sparkline, Meter, EdgeBar), `team.tsx` (team colours, TeamEdge, TeamTag), `LiveScore.tsx`, `Theme.tsx` (pre-paint script and toggle), `HubNav.tsx`.
- `/styleguide` shows all of it, light and dark side by side.

## Rules for every hub

1. Lead with the call (bet, start, claim, sit) and one plain reason.
2. One `Spotlight` per screen, for the single action that matters now. Nothing else gets a box.
3. Data sits in `Section`s on a 1.5px ink rule. Rows are hairlines.
4. Every number goes through `Num` (mono, tabular).
5. Learner logs, research cuts, slice tables, staking notes: behind a `Disclosure`. Never on the default view. A note that repeats on every row is said once under the section.
6. Team colour on the left edge of game and player rows (`TeamEdge`).
7. No em dashes in UI copy.
8. 375px and 1440px in both themes, no page-level horizontal scroll; tables scroll in their own container.

## Order for later sessions

Each ends with a preview link and a stop.

1. **Bets**: PicksView board (game rows: model vs market, cover meter, edge bars), sport/market/view tabs into one shared control, game pop-ups, props board. Results, Research and Log tabs move behind Details or link to Results. Fix: Sam (rust) and David (gold) read too close in light; pick a clearer second colour for David.
2. **Fantasy**: `/fantasy` league list, league home, Lineup, Waivers, FAAB, Plan, Draft, Trade, Players, Survivor (reuse TeamLogo, fix its duplicate `pool-size` React key).
3. **Money**: desks overview, book detail; bankroll curve on the shared Sparkline.
4. **Results**: Records, Learning, Forecast, Model record. Fix the link mismatches Astra found (Learning NBA totals research link misses `m=ou`; First Basket links use `m=nba` instead of `m=fb`).

Astra does the mechanical moves per hub (two or three jobs at once) and an independent review of each hub diff; Claude reads every diff and runs the checks.
