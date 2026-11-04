import type { Metadata } from "next";
import Link from "next/link";
import TeamCard from "./TeamCard";
import s from "../picks/picks.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Team · Hobby Hub",
  description: "One team across every sport the site covers: this week's game, the lines, our read and tracked props.",
};

// /team?k=nfl:PHI | nba:DEN | ncaa:2579: the full page; from inside the site it opens as a pop-up (@modal).
export default async function TeamPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const q = await searchParams;
  const k = typeof q.k === "string" ? q.k : "";
  return (
    <main className={s.page}>
      <div className={s.wrap}>
        <Link href="/today" className={s.linkA} style={{ fontSize: 14 }}>
          ‹ Today
        </Link>
        <TeamCard k={k} />
      </div>
    </main>
  );
}
