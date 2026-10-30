import Modal from "@/components/Modal";
import { getPicksReport } from "@/lib/picks/report";
import { GamePreview } from "@/app/picks/game/GamePreview";

// /picks/game opened from inside the site (the header search): the game as a
// pop-up over the current page. A reload or shared link gets the full page.
export default async function GameModal({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const q = await searchParams;
  const league = q.l === "cfb" ? "cfb" : "nfl";
  const key = typeof q.g === "string" ? q.g : "";
  const r = (await getPicksReport(league).catch(() => null))?.value ?? null;
  const g = r?.board.find((x) => `${x.away}@${x.home}` === key);
  return (
    <Modal label={g && r ? `${r.names[g.away] ?? g.away} at ${r.names[g.home] ?? g.home}` : "Game"}>
      {r && g ? <GamePreview g={g} r={r} /> : <p className="p-8 text-sm text-zinc-400">That game isn&apos;t on this week&apos;s board any more. Finished weeks are under Results.</p>}
    </Modal>
  );
}
