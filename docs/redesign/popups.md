# Pop-up links: every team, matchup and player name (audit 2026-11-04)

Jack (2026-11-04): "every team/match/player should have a pop up box when i click the name."
Read-only audit by a Claude Explore agent; line numbers are from redesign/hobby-hub at fd71435.

## Plan (biggest reach first)
1. Builders in one place (new `src/app/picks/hrefs.ts`): footballGameHref(league, away, home),
   nbaGameHref (exists, NbaView.tsx:39), NEW cbbGameHref(id) (/picks/cbb/game?id=), NEW
   playerPropHref(league, team, name, game) (only builder today is api/search/route.ts:50; loadPlayer needs t).
2. Optional `href` on the shared rows: GameCell (picks/ui.tsx:136; used by ats 209, su-totals 354,
   NbaView 251, CbbView 241), Matchup (props/matchup.tsx:21; week.tsx 187, 341), Edge/EdgeCard
   (week.tsx 46/119; set where built: propEdges 279, first basket 708, first TD ~836).
3. Make existing links open as pop-ups: GamePreview.tsx:213 and GameProps.tsx:120 are plain <a>;
   ats.tsx:1029 and NbaView.tsx:291 lack scroll={false}.
4. Team click = that team's current game pop-up. Boards have away/home in scope. Fantasy/Survivor
   have only an abbreviation: look it up in this week's getPicksReport("nfl").board (canon map
   su-totals.tsx:18 POOL_CANON for WSH/LA/JAC). Past weeks have no pop-up (modals only search the
   current board), so leave those as text.
5. Fantasy players: PlayerLink exists (22 sites) but goes to a full page and reads the league from
   the path (PlayerLink.tsx:36). Add an intercepting modal for /l/[id]/player/[pid] and a leagueId
   prop for use outside /l. Plain names with ids: lineup 83,109,294,303,307,444,470,472; waivers
   104,119,137,144,166,284; faab 340,353,369,391; draft 727.
6. Today: staked prop rows link to boards (lib/props/staked*.ts builds href) and NBA picks to
   /picks?l=nba (staked-core.ts:525, g.id in scope at 514). Those hrefs are built in src/lib:
   change needs Jack's OK, or rebuild the href in the UI layer from the bet's fields.
7. Not linkable: names inside <button> (bracket, trade levelers, survivor "I took"), past-week
   rows (Research, Results history, settled records), dead components (ournba OurNbaWeek etc).

## Remaining per-file sites
Props: week.tsx 388/391 (prop rows), 654/675 (first basket), ~877/909 (first TD); attd.tsx 75-77, 321-322, 367-368, 395-396;
lotto.tsx 191-192 (match; Rung has no team, so no player target yet); kotc.tsx 193-195, 247-248; kotez.tsx 39-40, 63, 71-72, 103-104;
davidprops.tsx 49-50, 85, 129-130; news.tsx 69; PlayerPreview.tsx 155 (add espnId to PlayerView for NBA).
Picks: ats.tsx 209-215, 226, 237-247, 293-300, 628; su-totals.tsx 71-86, 115-127, 354-359; NbaView 251-256;
game-model.tsx 81, 94; CbbView 241; ours.tsx 80; cfb-model.tsx 119; pool.tsx 86-161 (Sleeper codes, map via POOL_CANON).
Game pop-ups: GameProps.tsx 86-87 (player props link, needs league and game passed in).
Records: page.tsx 154-155 (open rows, current week). Money: MoneyView.tsx 73-75.
Today fantasy: fantasy.tsx 163, 192-193, 214, 231 (Claim/LineupMove need player ids carried through).
Survivor: SurvivorTool.tsx 136-137, 548-551, 635-638, 1225-1227 (current week only).
Fantasy team abbreviations: RoundTargets 111, RedraftDraft 316/459/564/646, RookieList 123, league page 629/778,
Recommendations 118, TradeBuilder 115/1579, draft 941/1034, PlayerSearch 165, players 125/323, scout 315,
player/[id] 185/560, faab 373.
