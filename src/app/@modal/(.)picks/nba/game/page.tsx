import Modal from "@/components/Modal";
import { getNbaBoard } from "@/lib/picks/nba-store";
import { getNbaPicksView } from "@/lib/picks/nba-track-store";
import { findNbaGame, NbaGamePreview } from "@/app/picks/nba/NbaGame";

// /picks/nba/game opened from inside the site: the game as a pop-up over the current page.
export default async function NbaGameModal({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const q = await searchParams;
  const id = typeof q.id === "string" ? q.id : "";
  const [b, v] = await Promise.all([getNbaBoard().catch(() => null), getNbaPicksView().catch(() => null)]);
  const g = b ? findNbaGame([...b.days, ...(b.yesterday ? [b.yesterday] : [])], id) : undefined;
  return (
    <Modal label={g ? `${g.away.short} at ${g.home.short}` : "Game"}>
      {g ? <NbaGamePreview raw={g} v={v} /> : <p className="p-8 text-sm text-zinc-400">That game isn&apos;t on the NBA board any more. Finished games are under Results.</p>}
    </Modal>
  );
}
