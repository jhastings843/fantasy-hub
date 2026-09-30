# Handoff (2026-09-30)

Last session: Chopped league FAAB work after the week 4 waiver run.

## What changed
- `src/lib/guillotine/room-claims.ts`: plays the rivals' waiver claims forward (best wire player to the rival he helps most, one per team, rivals with FAAB only). `report.ts` now draws the chop line and posture against that projected field; `roomOutlook` on the report carries the claims and the as-is rank. Tuesday FAAB email shows "What the room buys tonight". `/api/faab` returns it as `room`.
- `src/lib/guillotine/waiver-review.ts` (+ `waiver-review-build.ts`): Wednesday grading of the run. Wired into the Wednesday lineup email (`lib/thursday/run.ts`, `email.ts`) as one card per guillotine league.
- Lineup page (`app/l/[leagueId]/lineup/page.tsx`): "Free agents to grab", same scan as the email, top 3, hidden when empty.

## Open decisions for Jack
- Posture: last in projection at 1.52x average risk is still yellow (red needs 1.6x).
- Bid sizing: room pays 2 to 5x the card two weeks running.

## Next
See `.dashboard.json` next_steps. First scheduled run of the review card is next Wednesday.
