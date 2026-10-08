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
  const action = !slot.recommended
    ? `No eligible replacement${slot.current ? ` for ${slot.current.name}` : ""}`
    : slot.current
      ? `Start ${slot.recommended.name} instead of ${slot.current.name}`
      : `Fill ${slot.slot}: ${slot.recommended.name}`;
  return `<div style="padding:14px 0;border-top:1px solid ${PALETTE.hairline}">
<div style="font-size:14px;font-weight:600;color:${PALETTE.ink}">${escapeHtml(slot.slot)} · ${escapeHtml(action)}</div>
${slot.recommended ? small(playerContext(slot.recommended), PALETTE.body) : ""}
${slot.current ? small(`Currently set: ${slot.current.name} · ${playerContext(slot.current)}`) : ""}
${small(`Why: ${slot.reason}`, PALETTE.body)}
${slot.alternative && slot.alternative.playerId !== slot.current?.playerId && slot.alternative.playerId !== slot.recommended?.playerId
    ? small(`Next option: ${slot.alternative.name} · ${playerContext(slot.alternative)}`) : ""}
</div>`;
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
