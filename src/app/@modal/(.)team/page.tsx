import Modal from "@/components/Modal";
import TeamCard, { teamLabel } from "@/app/team/TeamCard";

// /team opened from inside the site (the header search): the team as a pop-up over the current page.
export default async function TeamModal({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const q = await searchParams;
  const k = typeof q.k === "string" ? q.k : "";
  return (
    <Modal label={teamLabel(k)}>
      <TeamCard k={k} />
    </Modal>
  );
}
