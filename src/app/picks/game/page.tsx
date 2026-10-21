import type { Metadata } from "next";
import Link from "next/link";
import { getPicksReport } from "@/lib/picks/report";
import { GameDetail } from "../ats";
import { href } from "../ui";
import s from "../picks.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Game · Picks · Hobby Hub",
  description: "One game: the pick, the market against both models, and why it is or isn't a bet.",
};

// /picks/game?l=nfl&g=MIA@NYJ: the full breakdown behind "Why this bet".
export default async function GamePage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const q = await searchParams;
  const league = q.l === "cfb" ? "cfb" : "nfl";
  const key = typeof q.g === "string" ? q.g : "";
  const r = (await getPicksReport(league).catch(() => null))?.value ?? null;
  const g = r?.board.find((x) => `${x.away}@${x.home}` === key);
  return (
    <main className={s.page}>
      <div className={s.wrap}>
        <Link href={href(league, "ats", "week")} className={s.linkA} style={{ fontSize: 14 }}>
          {`‹ ${league === "nfl" ? "NFL" : "College"} picks`}
        </Link>
        {r && g ? <GameDetail g={g} r={r} /> : <p className={s.calm}>That game isn&apos;t on this week&apos;s board any more. Finished weeks are under Results.</p>}
      </div>
    </main>
  );
}
