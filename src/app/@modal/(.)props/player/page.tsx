import Modal from "@/components/Modal";
import { loadPlayer } from "@/lib/search/player";
import { PlayerPreview } from "@/app/props/PlayerPreview";

const str = (x: unknown) => (typeof x === "string" ? x : "");

// /props/player opened from inside the site: the player as a pop-up over the current page.
export default async function PlayerModal({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const q = await searchParams;
  const league = q.l === "nba" ? "nba" : "nfl";
  const v = str(q.t) && str(q.n) ? await loadPlayer(league, str(q.t), str(q.n), str(q.g) || undefined).catch(() => null) : null;
  return <Modal label={v ? v.name : "Player"}>{v ? <PlayerPreview v={v} /> : <p className="p-8 text-sm text-zinc-400">No props saved for that player right now.</p>}</Modal>;
}
