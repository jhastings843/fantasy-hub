// Strategy articles surfaced as expandable cards on the survivor page.
//
// These describe what the engine on this page is actually doing, so the numbers
// on screen and the reasoning here cannot drift apart. Sources: Bergman &
// Imbrogno (Operations Research 65(5), the sequential-assignment treatment of
// survivor pools), PoolGenius/TeamRankings on expected value and pool size, and
// the standard de-vig and spread-to-margin conversions.

export interface StrategyArticle {
  id: string;
  title: string;
  hook: string; // one-line summary shown collapsed
  body: string; // full text shown expanded
  takeaway: string; // single rule of thumb
}

export const STRATEGY_ARTICLES: StrategyArticle[] = [
  {
    id: "win-vs-finish",
    title: "Surviving is not the goal. Finishing first is.",
    hook: "The board is ranked on equity, which is win probability divided by how much of the field survives with you.",
    body: "A survivor pool pays the last entry standing, so the number that matters is not your chance of surviving the week, it is your chance of outlasting everyone else. Those two come apart constantly. The engine scores every pick with an equity multiplier: your win probability divided by the fraction of rivals expected to survive if your pick hits, adjusted for the fact that a 500-entry pool is finite. A multiplier of 1.00 means you neither gain nor lose ground on the field. Above 1.00 you gained ground even in the worlds where you both survived. A 95% favourite that 60% of the pool is also on can score below 1.00, because surviving alongside almost everybody is not progress, it is a stay of execution.",
    takeaway: "Read the equity number, not the win percentage. 1.00 is treading water.",
  },
  {
    id: "the-threshold",
    title: "The only ownership threshold worth memorising.",
    hook: "If a favourite is picked more often than it wins, the other side has the better equity.",
    body: "There is no universal rule like 'fade anything above 30%'. What is true, and provable, is the two-sided case: if the whole field were split across one game, the favourite is the better play exactly when its ownership is below its win probability. A 78% favourite on 55% of entries is fine. A 78% favourite on 85% of entries is not, and no amount of it being the safest game on the board changes that. Real slates are messier because entries on every other game also survive, which is why the engine computes the full conditional survival rate rather than the shortcut of win probability divided by your own ownership. That shortcut is only correct in the artificial one-game case, and it overstates leverage badly on a normal Sunday.",
    takeaway: "Ownership above win probability is the fade signal. Below it, chalk is fine.",
  },
  {
    id: "pool-size",
    title: "Pool size does not change the pick. It changes what you are playing for.",
    hook: "Thirty entries and five hundred entries produced identical boards. What differs is how the season ends.",
    body: "The intuition is that a small pool should play chalk and a big one should get clever, and the equity formula flatly refuses to agree: run the same real slate at 30 entries and at 500 and the boards come back identical to five decimals. The finite-pool correction in the equity multiplier only bites when very little of the field survives a week, and at a normal 80% field survival rate the correction has already vanished at 30 entries, never mind 500. The published work is still right, it is just about something else. Bergman and Imbrogno find that a longer planning horizon wins in larger pools because you have to assume you will need to last longer, and the practitioner guides make the same point in reverse: a pool that resolves by Thanksgiving does not need to hoard elite teams. So the quantity that separates two pools is how many entries are expected to be alive when the season runs out. Below about one, surviving is winning and ties on the board go to the safer team. Well above one, the prize gets split and ties go to the team fewer rivals can follow you onto. That is the only place pool size is allowed to move a pick, because anywhere else the equity number has already priced it and moving it again would be counting the same effect twice.",
    takeaway: "Ask how many entries survive to week 18, not how many started. Under one, take the safe team. Over one, take the lonely one.",
  },
  {
    id: "future-value",
    title: "Every pick costs you the weeks you could have used that team.",
    hook: "Burn cost is the survival you give up later by spending a team now.",
    body: "Eighteen weeks need eighteen different teams out of thirty-two, so the constraint really binds, and the good teams are worth different amounts in different weeks. The engine solves the whole remaining season as an assignment problem: one team per week, no team twice, maximising the total log probability of surviving the path. Burn cost is then the shadow price, meaning how much that best path gets worse if you take a team off the board today. It is never negative, and it is often zero for a team nothing later needs. Future weeks are discounted at roughly the weekly survival rate, so a Week 16 slot is worth a fraction of a Week 2 slot: hoarding elite teams for weeks you will probably never reach is its own way of losing.",
    takeaway: "A high burn cost means the team is load-bearing later. Spend something else.",
  },
  {
    id: "pool-size",
    title: "Pool size decides how much safety you can sell.",
    hook: "At 500 entries, leverage is real. At 20 it mostly is not.",
    body: "In a 20-entry pool the season usually ends before anyone runs out of teams, so survival is almost the whole game and giving up more than about three points of win probability is a bad trade. At 500 entries, entries survive the season often enough that pure survival finishes you mid-pack, and giving up five to eight points for genuine leverage becomes correct. Two things change as the pool thins: leverage is measured against the entries still alive, not the ones that started, and public pick percentages get less reliable as the field shrinks toward a handful of people whose habits you actually know. Keep the 'still alive' number current, because it is an input, not decoration.",
    takeaway: "Update entries alive every week. It changes the maths, not just the display.",
  },
  {
    id: "vegas-not-public",
    title: "Use no-vig moneylines, never raw odds.",
    hook: "A -185 favourite is 64%, not 65%, and the gap compounds over eighteen weeks.",
    body: "Raw implied odds always sum to more than 100%, because the overround is the book's margin and belongs to neither side. Taking -185 at face value reads as 64.9% when the fair price is 64.3%. That is small once and material across a season of compounding. The engine normalises both sides of every moneyline before using it. A spread is a worse input and is only a fallback: the -110 attached to a spread prices the cover, not the outright win, so converting it means modelling the margin as a normal distribution around the spread, which smooths over the fact that NFL games land on exactly 3 and exactly 7 far more often than on 4 or 6. When a game has no moneyline the board says so rather than quoting a soft number as if it were firm.",
    takeaway: "Moneyline beats spread. De-vigged beats raw. The page marks it when neither is available.",
  },
  {
    id: "concentration",
    title: "Watch for a plan that beats the same team every week.",
    hook: "One bad team carrying six weeks of your path is a single point of failure.",
    body: "The solver finds the highest-probability path, and in most seasons that means repeatedly playing whoever the market has written off. That is the market's honest view and not a bug, but it concentrates your risk in one place: if that team turns out to be a few points better than projected, every week of the plan degrades at once rather than one week of it. The same logic applies to the calendar. December games involve teams resting starters and locked into seeds, weather swings outdoor games by several points, and Thanksgiving compresses ownership across only three games. If you are alive in December the job shifts from squeezing out equity to surviving variance.",
    takeaway: "If the plan leans on one opponent, ration those weeks rather than spending them early.",
  },
];
