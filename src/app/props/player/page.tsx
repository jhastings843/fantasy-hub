import type { Metadata } from "next";
import Link from "next/link";
import { loadPlayer } from "@/lib/search/player";
import { loadPlayerExtra } from "@/lib/search/player-extra";
import { PlayerPreview } from "../PlayerPreview";
import s from "../../picks/picks.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Player props · Hobby Hub",
  description: "One player's props: DraftKings' line, our number and chance, David's number, and the result once the game ends.",
};

const str = (x: unknown) => (typeof x === "string" ? x : "");

// /props/player?l=nba&t=BOS&n=Jaylen%20Brown[&g=401...]: the full page; from inside the site it opens as a pop-up (@modal).
export default async function PlayerPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const q = await searchParams;
  const league = q.l === "nba" ? "nba" : "nfl";
  const v = str(q.t) && str(q.n) ? await loadPlayer(league, str(q.t), str(q.n), str(q.g) || undefined).catch(() => null) : null;
  const x = v ? await loadPlayerExtra(v) : null;
  return (
    <main className={s.page}>
      <div className={s.wrap}>
        <Link href={league === "nba" ? "/props?m=nba" : "/props"} className={s.linkA} style={{ fontSize: 14 }}>
          {`‹ ${league.toUpperCase()} props`}
        </Link>
        {v ? <PlayerPreview v={v} x={x} /> : <p className={s.calm}>No props saved for that player right now.</p>}
      </div>
    </main>
  );
}
