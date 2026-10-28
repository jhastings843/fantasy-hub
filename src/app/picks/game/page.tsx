import type { Metadata } from "next";
import Link from "next/link";
import { getPicksReport } from "@/lib/picks/report";
import type { BoardGame } from "@/lib/picks/engine";
import { GameDetail } from "../ats";
import { href } from "../ui";
import s from "../picks.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Game · Picks · Hobby Hub",
  description: "One game: the pick, the market against both models, and why it is or isn't a bet.",
};

// Our own model's projected score for the game, from its latest saved read. Tracked only:
// the strategy review judges its totals side and straight-up winner like any source.
function OurScore({ g, name, league }: { g: BoardGame; name: (k: string) => string; league: "nfl" | "cfb" }) {
  const o = g.ours;
  if (!o) return null;
  const margin = -o.spread;
  const total = o.total;
  const at = g.ref ?? g.lastRef;
  const r1 = (x: number) => x.toFixed(1);
  return (
    <section className={s.section} aria-labelledby="our-score">
      <h2 id="our-score" className={s.h3}>Our model&apos;s projected score</h2>
      <dl className={s.kv}>
        {total !== undefined && (
          <>
            <dt>Score</dt>
            <dd className={s.num}>{`${name(g.away)} ${r1((total - margin) / 2)}, ${name(g.home)} ${r1((total + margin) / 2)}`}</dd>
          </>
        )}
        <dt>Spread</dt>
        <dd className={s.num}>{`${name(g.home)} ${o.spread > 0 ? `+${r1(o.spread)}` : o.spread === 0 ? "PK" : r1(o.spread)}${at ? ` (market ${at.line > 0 ? `+${at.line}` : at.line})` : ""}`}</dd>
        {total !== undefined && (
          <>
            <dt>Total</dt>
            <dd className={s.num}>{`${r1(total)}${at?.total !== undefined ? ` (market ${at.total}, ours says ${total > at.total ? "over" : total < at.total ? "under" : "on the number"})` : ""}`}</dd>
          </>
        )}
        {o.homeWin !== undefined && (
          <>
            <dt>Win chance</dt>
            <dd className={s.num}>{`${name(g.home)} ${Math.round(o.homeWin * 100)}%, ${name(g.away)} ${Math.round((1 - o.homeWin) * 100)}%`}</dd>
          </>
        )}
      </dl>
      <p className={s.thin}>
        {league === "nfl"
          ? "Spread from our NFL model (the line moved by where lines have been wrong before), total from team points ratings. Backtests found no edge against the closing number for either, so both are tracked and judged as sources; nothing is staked unless the strategy review promotes one."
          : "From our college model (results and points ratings). Its backtest found no edge against the line on its own, so it is tracked and judged as a source; nothing is staked unless the strategy review promotes it."}
      </p>
    </section>
  );
}

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
        {r && g ? (
          <>
            <GameDetail g={g} r={r} />
            <OurScore g={g} name={(k) => r.names[k] ?? k} league={league} />
          </>
        ) : (
          <p className={s.calm}>That game isn&apos;t on this week&apos;s board any more. Finished weeks are under Results.</p>
        )}
      </div>
    </main>
  );
}
