import type { AdvicePlayer, SlotAdvice } from "@/lib/lineup/weekly-advice";
import { escapeHtml, small, PALETTE } from "./shell";

/** Recorded facts only: no new rankings, projections or injury inference. */
export function playerContext(player: AdvicePlayer | null): string {
  if (!player) return "Empty slot";
  const bits = [player.position + (player.team ? ` · ${player.team}` : "")];
  if (player.onBye) bits.push("BYE");
  else if (player.opponent) bits.push(`${player.home === false ? "at" : player.home === true ? "vs" : "opponent"} ${player.opponent}`);
  if (player.positionalRank != null) bits.push(`${player.position}${player.positionalRank} this week`);
  if (player.flexRank != null) bits.push(`FLEX ${player.flexRank}`);
  if (player.adjustedFlexRank != null && player.adjustedFlexRank !== player.flexRank) {
    bits.push(`league-adjusted FLEX ${player.adjustedFlexRank}`);
  }
  if (player.unranked) bits.push("not ranked this week");
  if (player.injuryStatus) bits.push(player.injuryStatus);
  if (player.locked) bits.push("game locked");
  return bits.join(" · ");
}

export function changeDetail(slot: SlotAdvice): string {
  const benched = slot.benched ?? slot.current;
  const action = !slot.recommended
    ? `No eligible replacement${slot.current ? ` for ${slot.current.name}` : ""}`
    : benched
      ? `Start ${slot.recommended.name}, bench ${benched.name}`
      : `Fill ${slot.slot}: ${slot.recommended.name}`;
  // Who sits down is the line that matters. When the slot's own occupant is
  // staying in and only changing slot, say that separately so his name is not
  // read as the one coming out.
  const shuffle = slot.current && slot.currentMovesTo && slot.current.playerId !== benched?.playerId
    ? small(`${slot.current.name} stays in, moving from ${slot.slot} to ${slot.currentMovesTo}.`, PALETTE.body)
    : "";
  return `<div style="padding:14px 0;border-top:1px solid ${PALETTE.hairline}">
<div style="font-size:14px;font-weight:600;color:${PALETTE.ink}">${escapeHtml(slot.slot)} · ${escapeHtml(action)}</div>
${slot.recommended ? small(`In: ${slot.recommended.name} · ${playerContext(slot.recommended)}`, PALETTE.body) : ""}
${benched ? small(`Out: ${benched.name} · ${playerContext(benched)}`) : ""}
${shuffle}
${nextOption(slot, benched)}
</div>`;
}

/** Skipped when it is the player just benched, or a non-QB for a superflex he fills with a QB. */
function nextOption(slot: SlotAdvice, benched: SlotAdvice["current"]): string {
  const alt = slot.alternative;
  if (!alt) return "";
  if ([slot.current?.playerId, slot.recommended?.playerId, benched?.playerId].includes(alt.playerId)) return "";
  if (slot.slot === "SUPER_FLEX" && alt.position !== "QB") return "";
  return small(`Next option: ${alt.name} · ${playerContext(alt)}`);
}

export function confirmedDetails(slots: SlotAdvice[]): string {
  const confirmed = slots.filter(s => !s.changed && s.current);
  if (!confirmed.length) return "";
  const starters = confirmed.map(s => `${s.slot}: ${s.current!.name}`).join(" · ");
  const watches = confirmed.filter(s => s.current?.injuryStatus || s.current?.onBye).map(s =>
    `${s.current!.name}: ${s.current!.onBye ? "bye" : s.current!.injuryStatus}`);
  return small(`Keeping in: ${starters}`, PALETTE.body)
    + (watches.length ? small(`Keep an eye on: ${watches.join("; ")}`, PALETTE.warn) : "");
}
