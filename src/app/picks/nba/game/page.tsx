import type { Metadata } from "next";
import Link from "next/link";
import { getNbaBoard } from "@/lib/picks/nba-store";
import { getNbaPicksView } from "@/lib/picks/nba-track-store";
import { findNbaGame, NbaGamePreview } from "../NbaGame";
import s from "../../picks.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "NBA game · Picks · Hobby Hub",
  description: "One NBA game: Sam's side in every market, the edge, cover chance and edge per unit.",
};

// /picks/nba/game?id=401...: the full page; from inside the site it opens as a pop-up (@modal).
export default async function NbaGamePage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const q = await searchParams;
  const id = typeof q.id === "string" ? q.id : "";
  const [b, v] = await Promise.all([getNbaBoard().catch(() => null), getNbaPicksView().catch(() => null)]);
  const g = b ? findNbaGame([...b.days, ...(b.yesterday ? [b.yesterday] : [])], id) : undefined;
  return (
    <main className={s.page}>
      <div className={s.wrap}>
        <Link href="/picks/nba" className={s.linkA} style={{ fontSize: 14 }}>
          ‹ NBA picks
        </Link>
        {g ? <NbaGamePreview raw={g} v={v} /> : <p className={s.calm}>That game isn&apos;t on the NBA board any more. Finished games are under Results.</p>}
      </div>
    </main>
  );
}
