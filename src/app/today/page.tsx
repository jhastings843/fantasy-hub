import type { Metadata } from "next";
import Link from "next/link";
import { getPicksReport, type PicksReport } from "@/lib/picks/report";
import { getNbaBoard } from "@/lib/picks/nba-store";
import { getNbaPicksView } from "@/lib/picks/nba-track-store";
import { readGame } from "../picks/nba/NbaView";
import { loadProducts } from "../props/top";
import { ModelGrid, PageHead, SecHead, Stats, statusChip, type ModelRow } from "../picks/board";
import { LEAGUE_NAME, kickoffEt, line, price, rec } from "../picks/ui";
import s from "../picks/picks.module.css";

// Today (the Ledger redesign, 2026-10-22): the first screen for "what are we
// betting or tracking right now". Real stakes first, then tracked sides, then
// which model drives each section, then the record. Every stake shown here is
// one the picks emails issued (or the allocator has ready to issue), never a
// tracked edge.

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Today · Hobby Hub",
  description: "Stakes in play, what is next, which model drives each section, and the record.",
};

const seasonOf = (d: Date) => (d.getMonth() < 7 ? d.getFullYear() - 1 : d.getFullYear());
const u = (x: number) => `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(x).toFixed(2)}u`;

interface Slip {
  key: string;
  league: string;
  pick: string;
  game: string;
  when: string;
  kickoff: string;
  state: "live" | "next";
  kind: "issued" | "ready" | "tracked";
  tier: string;
  stake?: number;
  price?: number;
  note?: string;
}

/** Issued and ready-to-issue football bets this week that are not final. */
function footballSlips(r: PicksReport): Slip[] {
  const n = (k: string) => r.names[k] ?? k;
  const out: Slip[] = [];
  for (const g of r.board) {
    if (g.final) continue;
    const kick = g.ref?.kickoff ?? "";
    const state = g.basis === "started" ? "live" : "next";
    const game = `${n(g.away)} at ${n(g.home)}`;
    if (g.issued) {
      const side = g.issued.side;
      out.push({ key: `${r.league}-${g.home}`, league: LEAGUE_NAME[r.league], pick: side === "home" ? `${n(g.home)} ${line(g.issued.homeLine)}` : `${n(g.away)} ${line(-g.issued.homeLine)}`, game, when: kickoffEt(kick), kickoff: kick, state, kind: "issued", tier: g.tier === "t1" ? "Tier 1" : g.tier === "t2" ? "Tier 2" : "Issued", stake: g.issued.units, price: g.issued.price });
    } else if (g.stake && g.side && g.homeLine !== undefined && state === "next") {
      out.push({ key: `${r.league}-${g.home}`, league: LEAGUE_NAME[r.league], pick: g.side === "home" ? `${n(g.home)} ${line(g.homeLine)}` : `${n(g.away)} ${line(-g.homeLine)}`, game, when: kickoffEt(kick), kickoff: kick, state, kind: "ready", tier: g.tier === "t1" ? "Tier 1" : "Tier 2", stake: g.stake, price: g.price, note: g.held ? `Early look: it locks ${kickoffEt(g.held)} at that morning's price.` : "Sized, not sent yet: it goes out with the next picks email." });
    }
  }
  for (const t of r.totals.board) {
    const g = r.board.find((x) => x.home === t.home && x.away === t.away);
    if (!g || g.final || !t.issued) continue;
    const kick = g.ref?.kickoff ?? "";
    out.push({ key: `${r.league}-${t.home}-ou`, league: LEAGUE_NAME[r.league], pick: `${t.issued.side === "over" ? "Over" : "Under"} ${t.issued.line}`, game: `${n(t.away)} at ${n(t.home)}`, when: kickoffEt(kick), kickoff: kick, state: g.basis === "started" ? "live" : "next", kind: "issued", tier: "Totals rule", stake: t.issued.units, price: t.issued.price });
  }
  return out;
}

function SlipCard({ x }: { x: Slip }) {
  const chip =
    x.kind === "issued" ? (
      <span className={`${s.readChip} ${s.readBet}`}>{`${x.tier} · ${x.stake}u`}</span>
    ) : x.kind === "ready" ? (
      <span className={`${s.readChip} ${s.readPend}`}>{`${x.tier} · not sent`}</span>
    ) : (
      <span className={`${s.readChip} ${s.readTrack}`}>{`${x.tier} · no stake`}</span>
    );
  return (
    <article className={`${s.slip} ${x.kind === "issued" ? s.slipReal : x.kind === "ready" ? s.slipReady : s.slipDash}`}>
      <div className={s.slipTop}>
        {chip}
        <span className={s.muted}>{x.state === "live" ? <span className={`${s.readChip} ${s.readLive}`}>Live</span> : `${x.league} · ${x.when}`}</span>
      </div>
      <div>
        <div className={s.slipPick}>{x.pick}</div>
        <div className={`${s.num} ${s.muted}`} style={{ fontSize: 13 }}>{`${x.league} · ${x.game}`}</div>
      </div>
      {x.note && <p className={s.slipNote}>{x.note}</p>}
      <div className={s.slipStub}>
        {x.kind === "tracked" ? (
          <span>Tracked at the saved price. No stake.</span>
        ) : (
          <>
            <span>
              Price <b className={s.num}>{price(x.price)}</b>
            </span>
            <span>
              Stake <b className={s.num}>{`${x.stake}u`}</b>
            </span>
          </>
        )}
      </div>
    </article>
  );
}

export default async function TodayPage() {
  const season = seasonOf(new Date());
  const [nfl, cfb, board, nbaView, nflProducts, nbaProducts] = await Promise.all([
    getPicksReport("nfl").catch(() => null),
    getPicksReport("cfb").catch(() => null),
    getNbaBoard().catch(() => null),
    getNbaPicksView().catch(() => null),
    loadProducts("nfl", season).catch(() => null),
    loadProducts("nba", season).catch(() => null),
  ]);
  const reports = [nfl?.value, cfb?.value].filter((r): r is PicksReport => !!r);
  const football = reports.flatMap(footballSlips).sort((a, b) => a.kickoff.localeCompare(b.kickoff));

  // NBA: tonight's started games. Staked only once NBA's go-live gate clears; until then Sam's side is tracked.
  const nbaLive: Slip[] = (board?.days[0]?.games ?? [])
    .filter((g) => g.state === "in")
    .map((raw) => {
      const x = readGame(raw, nbaView);
      return {
        key: `nba-${raw.id}`,
        league: "NBA",
        pick: x.r ? x.pick : `${raw.away.short} at ${raw.home.short}`,
        game: `${raw.away.short} at ${raw.home.short} · ${raw.away.abbr} ${raw.score?.away ?? 0}, ${raw.home.abbr} ${raw.score?.home ?? 0}`,
        when: "",
        kickoff: raw.tip,
        state: "live" as const,
        kind: x.stake ? ("issued" as const) : ("tracked" as const),
        tier: x.stake ? `Tier ${x.tier}` : "Sam's side",
        stake: x.stake ?? undefined,
        price: x.pickPrice,
      };
    })
    .filter((x) => x.pick);

  const live = [...football.filter((x) => x.state === "live"), ...nbaLive];
  const next = football.filter((x) => x.state === "next");
  const liveStakes = live.filter((x) => x.kind === "issued");
  const issuedNext = next.filter((x) => x.kind === "issued");

  // Which model drives each section, from the same data each page reads.
  const products = [...(nflProducts ?? []), ...(nbaProducts ?? [])].filter((p) => p.name !== "Sam's props");
  const propsLive = products.flatMap((p) => p.learning.entries.filter((e) => e.status === "active").map((e) => `${p.name}: ${e.label}`));
  const drivers: ModelRow[] = [
    ...reports.map((r): ModelRow => {
      const rule = r.strategies.rule;
      return rule
        ? { name: `${LEAGUE_NAME[r.league]} spreads`, role: `Rule: ${rule.label}`, status: "active", note: `Issues Tier 1 and Tier 2 with a saved price and a stake. ${rec(rule.record)} since tracking. Sam and David feed it; neither stakes alone.` }
        : { name: `${LEAGUE_NAME[r.league]} spreads`, role: "No rule clears the bar", status: "collecting", note: "Nothing issues until a cut clears the bar. Every game is tracked." };
    }),
    ...reports.map((r): ModelRow => {
      const t = r.totals.backtest.rule;
      return t
        ? { name: `${LEAGUE_NAME[r.league]} totals`, role: `Rule: ${t.label}`, status: "active", note: "Issues totals bets with a saved price and a stake." }
        : { name: `${LEAGUE_NAME[r.league]} totals`, role: "Both models agree", status: "collecting", note: "Tracked with no stake until a totals cut clears the bar." };
    }),
    nbaView
      ? { name: "NBA picks", role: "Sam's NBA reads", status: nbaView.gate.live ? "active" : "collecting", note: nbaView.gate.live ? "Tier bets carry stakes under NBA's own limits." : `Tracked, no stakes, until the go-live gate clears (${nbaView.gate.checks.filter((c) => c.ok).length} of ${nbaView.gate.checks.length} checks met).` }
      : { name: "NBA picks", role: "Sam's NBA reads", status: "unavailable", note: "Couldn't read the NBA record just now." },
    {
      name: "Props, all four markets",
      role: "Hobby Hub's own prop models",
      status: propsLive.length ? "active" : products.length ? "collecting" : "unavailable",
      note: propsLive.length ? `Live slices with real stakes: ${propsLive.join("; ")}. Everything else is tracked.` : products.length ? "Projecting every prop. No slice is live, so nothing in Props carries a stake." : "Couldn't read the Props learning just now.",
    },
    { name: "King of the Court", role: "Slate simulation", status: "projections", note: "Chance to lead tonight's slate in PRA. Never staked." },
  ];

  const settled = reports.reduce((a, r) => ({ w: a.w + r.units.total.w, l: a.l + r.units.total.l, p: a.p + r.units.total.p, units: a.units + r.units.total.units }), { w: 0, l: 0, p: 0, units: 0 });
  const today = new Date().toLocaleDateString("en-US", { timeZone: "America/New_York", weekday: "long", month: "long", day: "numeric" });
  const headline = `${liveStakes.length} stake${liveStakes.length === 1 ? "" : "s"} in play, ${issuedNext.length} more issued and not started.${propsLive.length ? "" : " Nothing in Props carries a stake."}`;

  return (
    <main className={s.page}>
      <div className={s.wrap}>
        <header className={s.pageFrame}>
          <PageHead title={today} sub={headline} />
        </header>

        <section className={s.section} aria-labelledby="t-live">
          <SecHead id="t-live" title="In play now" aside={"Real stakes first, then sides we only track"} />
          {live.length ? (
            <div className={s.slips}>
              {[...live.filter((x) => x.kind === "issued"), ...live.filter((x) => x.kind !== "issued")].map((x) => (
                <SlipCard key={x.key} x={x} />
              ))}
            </div>
          ) : (
            <p className={s.calm}>Nothing is in play right now.</p>
          )}
        </section>

        <section className={s.section} aria-labelledby="t-next">
          <SecHead id="t-next" title="Next up" aside={<>{`${next.reduce((a, x) => a + (x.kind === "issued" ? (x.stake ?? 0) : 0), 0)}u issued and not started`}</>} />
          {next.length ? (
            <div className={s.slips}>
              {next.map((x) => (
                <SlipCard key={x.key} x={x} />
              ))}
            </div>
          ) : (
            <p className={s.calm}>No issued bets are waiting to start.</p>
          )}
        </section>

        <section className={s.section} aria-labelledby="t-drivers">
          <SecHead id="t-drivers" title="What drives each section" aside={<><Link href="/picks">Picks</Link> · <Link href="/props">Props</Link> for the full lineups</>} />
          <ModelGrid models={drivers} />
          <div className={s.legendRow}>
            <span>{statusChip("active")} its picks get real stakes</span>
            <span>{statusChip("collecting")} tracked, no stakes, until it clears its gate</span>
            <span>{statusChip("projections")} numbers only, never staked</span>
          </div>
        </section>

        <section className={s.section} aria-labelledby="t-record">
          <SecHead id="t-record" title="How we are doing" aside={<><Link href="/records">All records</Link></>} />
          <Stats
            label="Issued record"
            items={[
              { k: "Issued, settled", v: settled.w + settled.l + settled.p ? u(settled.units) : "0-0", sub: `${settled.w}-${settled.l}${settled.p ? `-${settled.p}` : ""} at each saved price`, tone: settled.w + settled.l ? (settled.units >= 0 ? "up" : "down") : undefined },
              { k: "Issued, open", v: `${[...live, ...next].filter((x) => x.kind === "issued").reduce((a, x) => a + (x.stake ?? 0), 0)}u`, sub: `${[...live, ...next].filter((x) => x.kind === "issued").length} bets not final`, small: true },
              { k: "Ready to send", v: `${next.filter((x) => x.kind === "ready").length}`, sub: "sized, not issued yet", small: true },
              { k: "Shadow records", v: "Kept apart", sub: <Link href="/records">Tracked, never staked</Link>, small: true },
            ]}
          />
        </section>
      </div>
    </main>
  );
}
