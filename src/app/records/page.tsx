import type { Metadata } from "next";
import Link from "next/link";
import { getPicksReport, type PicksReport } from "@/lib/picks/report";
import type { BetRow } from "@/lib/picks/units";
import { getOurNbaView } from "@/lib/models/nba/store";
import { getOurNflView } from "@/lib/models/nfl/store";
import { getOurFtdView } from "@/lib/models/nfl/ftd-store";
import { getNbaPicksView } from "@/lib/picks/nba-track-store";
import { ourSliceBets, record } from "@/lib/models/learn";
import { ftdKalshiRecord } from "../props/week";
import { Hero, Stats } from "../picks/board";
import { LEAGUE_NAME, line } from "../picks/ui";
import RecordsTable, { type IssuedRow } from "./RecordsTable";
import s from "../picks/picks.module.css";

// Records (the Ledger redesign, 2026-10-22). Two books that never mix:
// recommendations the picks emails issued with a saved price and stake, and
// shadow records of what a model would have done with no stake. "Issued" is
// not "placed": nothing here confirms a person made the wager.

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Records · Hobby Hub",
  description: "Every issued pick graded at its saved price, with the tracked-only shadow records kept apart.",
};

const seasonOf = (d: Date) => (d.getMonth() < 7 ? d.getFullYear() - 1 : d.getFullYear());
const u = (x: number) => `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(x).toFixed(2)}u`;

/** One bet in words: "BUF −2.5 at NYJ", "Over 44.5 · NE at CHI", or a parlay's legs. */
function position(b: BetRow, names: PicksReport["names"]): string {
  const n = (k: string) => names[k] ?? k;
  const leg = (l: BetRow["legs"][number]) =>
    l.side === "over" || l.side === "under"
      ? `${l.side === "over" ? "Over" : "Under"} ${l.line} · ${n(l.away)} at ${n(l.home)}`
      : l.side === "home"
        ? `${n(l.home)} ${line(l.line)} vs ${n(l.away)}`
        : `${n(l.away)} ${line(-l.line)} at ${n(l.home)}`;
  return b.legs.map(leg).join(" + ");
}

export default async function RecordsPage() {
  const season = seasonOf(new Date());
  const [nfl, cfb, nbaProps, nflProps, ftd, nbaPicks] = await Promise.all([
    getPicksReport("nfl").catch(() => null),
    getPicksReport("cfb").catch(() => null),
    getOurNbaView(season).catch(() => null),
    getOurNflView(season).catch(() => null),
    getOurFtdView(season).catch(() => null),
    getNbaPicksView().catch(() => null),
  ]);
  const reports = [nfl?.value, cfb?.value].filter((r): r is PicksReport => !!r);

  const settled: IssuedRow[] = [];
  const open: { key: string; league: string; week: number; position: string; tier: string; stake: number; price: number | null }[] = [];
  let unstaked = 0;
  for (const r of reports) {
    unstaked += r.units.unstaked;
    for (const wk of r.units.byWeek)
      wk.bets.forEach((b, i) => {
        const row = {
          key: `${r.league}-${wk.week}-${i}`,
          league: LEAGUE_NAME[r.league],
          week: wk.week,
          position: position(b, r.names),
          kind: b.kind === "spread" ? "Spread" : b.kind === "total" ? "Total" : "Parlay",
          tier: b.kind === "spread" ? (b.tier === "t1" ? "Tier 1" : "Tier 2") : b.kind === "total" ? "Totals rule" : "Parlay",
          stake: b.units,
          price: b.price ?? null,
        };
        if (b.unstaked) return;
        if (b.result === undefined) open.push(row);
        else settled.push({ ...row, result: b.result, net: b.net ?? 0 });
      });
  }
  const net = settled.reduce((a, b) => a + b.net, 0);
  // A bet's units are what it risked (units.ts); a push risks nothing in the end.
  const risked = settled.reduce((a, b) => a + (b.result === "P" ? 0 : b.stake), 0);
  const w = settled.filter((b) => b.result === "W").length;
  const l = settled.filter((b) => b.result === "L").length;
  const p = settled.filter((b) => b.result === "P").length;

  // Shadow records: graded at the saved price with no stake. Each comes from the same function its own page uses.
  const shadow: { what: string; href: string; w: number; l: number; p: number; units: number; basis: string }[] = [];
  if (nbaProps) {
    const x = record(ourSliceBets(nbaProps.graded, "edge:all"));
    shadow.push({ what: "NBA props, every tracked edge", href: "/props?m=nba", w: x.w, l: x.l, p: x.p, units: x.units, basis: "1u at each saved DraftKings price" });
    const fb = nbaProps.fb.graded.flatMap((g) => g.bets);
    shadow.push({ what: "NBA First Basket, tracked edges", href: "/props?m=fb", w: fb.filter((b) => b.net > 0).length, l: fb.filter((b) => b.net <= 0).length, p: 0, units: fb.reduce((a, b) => a + b.net, 0), basis: "1u at each saved DraftKings price" });
  }
  if (nflProps) {
    const x = record(ourSliceBets(nflProps.graded, "edge:all"));
    shadow.push({ what: "NFL props, every tracked edge", href: "/props", w: x.w, l: x.l, p: x.p, units: x.units, basis: "1u at each saved price" });
  }
  if (ftd) {
    const x = ftdKalshiRecord(ftd.graded);
    shadow.push({ what: "NFL First TD, edges at Kalshi's cost", href: "/props?m=ftd", ...x, basis: "1u at Kalshi's cost, fee in" });
  }
  const sam = nbaPicks?.cuts.find((c) => c.id === "ats:all");
  if (sam) shadow.push({ what: "NBA picks, every Sam side", href: "/picks/nba", w: sam.w, l: sam.l, p: sam.p, units: sam.units, basis: "1u at the saved DraftKings price" });

  return (
    <main className={s.page}>
      <div className={s.wrap}>
        <header className={s.header}>
          <Hero
            eyebrow={`Records · ${season} season`}
            title="Issued, graded at the saved price"
            sub="Every pick the emails issued with a saved price and stake. Tracked-only records sit below and never add to these totals."
          />
          <p className={s.issuedNote}>
            <b>Issued is not placed.</b> An issued recommendation was sent with a saved price and stake. Nothing here confirms a person placed a real-money wager on it.
          </p>
          <Stats
            label="Issued record"
            items={[
              { k: "Net, settled", v: settled.length ? u(net) : "0-0", sub: settled.length ? `${(risked ? (net / risked) * 100 : 0).toFixed(1)}% on ${risked.toFixed(1)}u risked` : "nothing settled", tone: settled.length ? (net >= 0 ? "up" : "down") : undefined },
              { k: "Record", v: `${w}-${l}${p ? `-${p}` : ""}`, sub: `${settled.length} settled`, small: true },
              { k: "Open", v: `${open.length}`, sub: open.length ? `${open.reduce((a, b) => a + b.stake, 0)}u not final yet` : "nothing open", small: true },
              { k: "Leagues", v: reports.map((r) => LEAGUE_NAME[r.league]).join(" + ") || "None loaded", sub: "NBA has no issued picks yet", small: true },
            ]}
          />
        </header>

        <section className={s.section} aria-labelledby="rec-settled">
          <h2 className={s.h2} id="rec-settled">Settled</h2>
          <RecordsTable rows={settled} />
          {unstaked > 0 && <p className={s.p}>{`${unstaked} early pick${unstaked === 1 ? " was" : "s were"} sent before stakes existed: in the win-loss record on each Picks page, not here.`}</p>}
        </section>

        <section className={s.section} aria-labelledby="rec-open">
          <h2 className={s.h2} id="rec-open">Open</h2>
          {open.length ? (
            <div className={s.tw}>
              <table className={s.table}>
                <thead>
                  <tr>
                    <th>Week</th>
                    <th>League</th>
                    <th>Position</th>
                    <th>Tier</th>
                    <th className={s.thNum}>Stake</th>
                    <th className={s.thNum}>Price</th>
                  </tr>
                </thead>
                <tbody>
                  {open.map((r) => (
                    <tr key={r.key}>
                      <td className={s.num}>{r.week}</td>
                      <td>{r.league}</td>
                      <td>
                        <b>{r.position}</b>
                      </td>
                      <td>{r.tier}</td>
                      <td className={`${s.num} ${s.tdNum}`}>{`${r.stake}u`}</td>
                      <td className={`${s.num} ${s.tdNum}`}>{r.price === null ? "parlay" : r.price > 0 ? `+${r.price}` : `−${Math.abs(r.price)}`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className={s.calm}>Nothing issued is waiting on a result.</p>
          )}
        </section>

        <section className={s.section} aria-labelledby="rec-shadow">
          <details className={s.details}>
            <summary id="rec-shadow">{`Shadow records: tracked, never staked · ${shadow.length} records`}</summary>
            <div className={s.detailsBody}>
              <div className={s.tw}>
                <table className={s.table}>
                  <thead>
                    <tr>
                      <th>What was tracked</th>
                      <th className={s.thNum}>W-L</th>
                      <th className={s.thNum}>Units</th>
                      <th>Basis</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shadow.map((x) => (
                      <tr key={x.what}>
                        <td>
                          <Link href={x.href}>{x.what}</Link>
                        </td>
                        <td className={`${s.num} ${s.tdNum}`}>{x.w + x.l + x.p ? `${x.w}-${x.l}${x.p ? `-${x.p}` : ""}` : "none graded"}</td>
                        <td className={`${s.num} ${s.tdNum} ${x.units > 0 ? s.pos : x.units < 0 ? s.neg : ""}`}>{x.w + x.l + x.p ? u(x.units) : "·"}</td>
                        <td className={s.muted}>{x.basis}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className={s.p} style={{ marginTop: 10 }}>
                Shadow results show how a model would have done. They never add to the issued record, even when the same game appears in both.
              </p>
            </div>
          </details>
        </section>
      </div>
    </main>
  );
}
