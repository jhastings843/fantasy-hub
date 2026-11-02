import Modal from "@/components/Modal";
import { getCbbBoard } from "@/lib/models/cbb/store";
import { CbbGamePreview, findCbbRow } from "@/app/picks/cbb/CbbGame";

// /picks/cbb/game opened from inside the site: the game as a pop-up over the current page.
export default async function CbbGameModal({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const q = await searchParams;
  const id = typeof q.id === "string" ? q.id : "";
  const b = id ? await getCbbBoard(new Date(), 3, id).catch(() => null) : null;
  const x = b ? findCbbRow(b.days, id) : undefined;
  return (
    <Modal label={x ? `${x.g.away.short} at ${x.g.home.short}` : "Game"}>
      {x ? <CbbGamePreview x={x} /> : <p className="p-8 text-sm text-zinc-400">That game isn&apos;t on the CBB board any more. Finished games are under Results.</p>}
    </Modal>
  );
}
