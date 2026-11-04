import Modal from "@/components/Modal";
import PlayerPage from "@/app/l/[leagueId]/player/[id]/page";

// A fantasy player opened from inside the site (Jack, 2026-11-04: "every
// team/match/player should have a pop up box"): the same profile as
// /l/[leagueId]/player/[id], as a pop-up over the current page. Typed or
// shared, the URL still opens the full page.
export default function FantasyPlayerModal({ params }: { params: Promise<{ leagueId: string; id: string }> }) {
  return (
    <Modal label="Player">
      <PlayerPage params={params} />
    </Modal>
  );
}
