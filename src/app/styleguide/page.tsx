import type { Metadata } from "next";
import { Call, Chip, Disclosure, Empty, Num, PageHead, Row, Section, Spotlight, Stat } from "@/components/hh/ui";
import { EdgeBar, Meter, Sparkline } from "@/components/hh/charts";
import { TeamEdge, TeamTag } from "@/components/hh/team";
import { LiveScore } from "@/components/hh/LiveScore";

// Every Hobby Hub component, in light (C3) and dark (teal terminal) side by side.
// The numbers here are sample values to show the layout, not real records.

export const metadata: Metadata = {
  title: "Styleguide · Hobby Hub",
  description: "Every Hobby Hub component in both themes.",
  robots: { index: false },
};

const SWATCHES: { name: string; v: string; use: string }[] = [
  { name: "Paper", v: "--hh-bg", use: "Page" },
  { name: "Panel", v: "--hh-panel", use: "Spotlight, menus" },
  { name: "Sunk", v: "--hh-sunk", use: "Market cell, hover" },
  { name: "Ink", v: "--hh-ink", use: "Text, rules" },
  { name: "Muted", v: "--hh-muted", use: "Labels, meta" },
  { name: "Line", v: "--hh-line", use: "Row hairlines" },
  { name: "Accent", v: "--hh-accent", use: "The one thing to act on" },
  { name: "Win", v: "--hh-pos", use: "Wins, plus units" },
  { name: "Loss", v: "--hh-neg", use: "Losses, live" },
  { name: "Gold", v: "--hh-gold", use: "Caution, not sent" },
  { name: "David", v: "--hh-david", use: "David's numbers (Sam uses the accent)" },
];

// Sample curve for the sparkline demo (illustrative).
const CURVE = [0, -1.1, -0.4, 0.9, 0.3, 1.8, 2.6, 2.1, 3.4, 4.1];

function Board() {
  return (
    <div className="flex flex-col gap-10">
      <PageHead title="Sunday, Nov 8" sub="2 stakes in play, 3 more issued and not started, 1 ready to send." aside="Sample screen" />

      <section className="flex flex-col gap-3">
        <h2 className="hh-label">Type scale</h2>
        <div className="flex flex-col gap-2">
          <p className="hh-title">Page title</p>
          <p className="font-display text-[30px] font-bold uppercase leading-none">JAX −7.5 (spotlight pick)</p>
          <p className="font-display text-[22px] font-semibold">Card title, Barlow mixed case</p>
          <p className="text-[15px] text-hh-ink-2">Body, Geist 15px. Plain words, written from your side of the screen.</p>
          <p className="text-xs text-hh-muted">Meta, Geist 12px muted</p>
          <p>
            <Num className="text-[26px] font-semibold">+4.12u</Num> <Num className="text-sm text-hh-muted">34-27-1 · $22 · 58%</Num>
          </p>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="hh-label">Colour tokens</h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {SWATCHES.map((s) => (
            <div key={s.v} className="flex flex-col gap-1">
              <span className="h-10 rounded-[4px] border border-hh-line" style={{ background: `var(${s.v})` }} />
              <span className="text-xs font-semibold">{s.name}</span>
              <span className="text-[11px] leading-tight text-hh-muted">{s.use}</span>
            </div>
          ))}
        </div>
      </section>

      <Spotlight label="Spotlight · the one box per screen" aside="NFL · Sun 1:00pm">
        <div className="flex items-center gap-3">
          <TeamTag league="nfl" team="JAX" name="Jaguars" size={36} />
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2">
          {[
            ["Market", "−7.5", false],
            ["Sam", "−9.4", true],
            ["David", "−8.8", true],
          ].map(([k, v, us]) => (
            <div key={k as string} className={`rounded-[4px] px-2.5 py-2 ${us ? "bg-hh-accent-soft" : "bg-hh-sunk"}`}>
              <span className="block text-[11px] text-hh-muted">{k}</span>
              <Num className={`text-[17px] font-semibold ${us ? "text-hh-accent-ink" : ""}`}>{v}</Num>
            </div>
          ))}
        </div>
        <div className="mt-4">
          <Meter value={0.58} label="Cover chance (estimate)" />
        </div>
        <div className="mt-4">
          <Call verb="Bet JAX −7.5, 1u at −110." reason="Sam and David average 1.6 points past the market." />
        </div>
        <Disclosure summary="Why this bet" className="mt-1">
          Tier 1, flat stake. The rule is 22-14 since Week 2 and passed its forward check. Price checked 9:00am.
        </Disclosure>
      </Spotlight>

      <Section label="Section on a rule · bet rows with team edges" aside={<Num>3u issued, not started</Num>}>
        {[
          { t: "KC", lg: "nfl" as const, pick: "KC −3", chip: <Chip tone="accent">Tier 1 · 1u</Chip>, game: "NFL · Buffalo at Kansas City · 4:25pm", u: "1u", p: "−110" },
          { t: "LV", lg: "nfl" as const, pick: "LV +6.5", chip: <Chip tone="gold">Tier 2 · not sent</Chip>, game: "NFL · Las Vegas at Denver · 4:05pm", u: "0.5u", p: "−105" },
          { t: "BOS", lg: "nba" as const, pick: "Tatum over 27.5 pts", chip: <Chip tone="live">Live · NBA props · 1u</Chip>, game: "NBA · Celtics at Knicks", u: "1u", p: "−115" },
        ].map((r) => (
          <div key={r.pick} className="border-b border-hh-line last:border-b-0">
            <TeamEdge league={r.lg} team={r.t}>
              <div className="flex min-h-14 items-center gap-3 py-2.5">
                <TeamTag league={r.lg} team={r.t} name="" size={28} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <Num className="text-[16px] font-semibold">{r.pick}</Num>
                    {r.chip}
                  </div>
                  <p className="mt-0.5 truncate text-[13px] text-hh-muted">{r.game}</p>
                  {r.chip.props.tone === "live" && <LiveScore text="BOS 88, NY 84 · Q4 6:12" className="text-[13px]" />}
                </div>
                <div className="flex flex-col items-end">
                  <Num className="text-[16px] font-semibold">{r.u}</Num>
                  <Num className="text-xs text-hh-muted">{r.p}</Num>
                </div>
              </div>
              <Disclosure summary="Why" className="-mt-1">
                Staking note, slice and price check live here, never on the default view.
              </Disclosure>
            </TeamEdge>
          </div>
        ))}
      </Section>

      <Section label="Stats, sparkline, edge bars">
        <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3">
          <Stat label="Settled" value="+4.12u" sub="34-27-1 at each saved price" tone="pos" />
          <Stat label="Open" value="3u" sub="4 bets not final" />
          <Stat label="Week" value="−1.05u" sub="2-3" tone="neg" />
        </div>
        <div className="mt-5 flex items-center justify-between gap-4 border-t border-hh-line pt-3">
          <div>
            <p className="text-sm font-semibold">NFL spreads and totals</p>
            <Num className="text-xs text-hh-muted">34-27-1 · </Num>
            <Num className="text-xs" tone="pos">
              +4.10u
            </Num>
          </div>
          <Sparkline values={CURVE} labels={CURVE.map((_, i) => `Week ${i + 1}`)} label="Sample units, running total" format={(v) => `${v.toFixed(2)}u`} width={132} height={40} />
        </div>
        <div className="mt-4 flex flex-col">
          {[
            ["Jonah Coleman rush yds over 62.5", 8.1],
            ["Malik Willis pass yds under 214.5", 5.4],
            ["Bijan Robinson rec over 3.5", -2.2],
          ].map(([k, v]) => (
            <Row key={k as string}>
              <span className="min-w-0 truncate text-sm">{k}</span>
              <EdgeBar value={v as number} max={10} label="Edge, percent" format={(x) => `${x > 0 ? "+" : "−"}${Math.abs(x).toFixed(1)}%`} />
            </Row>
          ))}
        </div>
      </Section>

      <Section label="Chips and states">
        <div className="flex flex-wrap gap-2">
          <Chip tone="accent">Sets real stakes</Chip>
          <Chip>Collecting evidence</Chip>
          <Chip tone="gold">Projections only</Chip>
          <Chip tone="pos">W</Chip>
          <Chip tone="neg">L</Chip>
          <Chip tone="live">Live</Chip>
        </div>
        <div className="mt-3">
          <Empty>Nothing is in play right now.</Empty>
        </div>
        <div className="mt-2 flex flex-col gap-3" aria-busy="true">
          <div className="h-3 w-28 animate-pulse rounded bg-[var(--hh-track)]" />
          <div className="h-11 animate-pulse rounded bg-[var(--hh-track)] opacity-70" />
        </div>
      </Section>

      <Section label="Claim row">
        <div className="flex min-h-11 items-start justify-between gap-3 py-1">
          <div>
            <div className="flex items-baseline gap-2">
              <span className="font-semibold">Tyler Allgeier</span>
              <Num className="text-xs text-hh-muted">RB · ARI</Num>
            </div>
            <p className="mt-0.5 text-sm text-hh-ink-2">Open roster spot, no drop needed.</p>
            <p className="mt-0.5 text-xs text-hh-muted">2026 Half PPR · season upgrade</p>
          </div>
          <div className="flex flex-col items-end">
            <Num className="text-[22px] font-semibold leading-none text-hh-accent-ink">$22</Num>
            <Num className="text-xs text-hh-muted">stop at $30</Num>
          </div>
        </div>
      </Section>
    </div>
  );
}

export default function StyleguidePage() {
  return (
    <main className="mx-auto flex w-full max-w-[1400px] flex-col gap-6 px-4 pb-16 pt-6 sm:px-6 sm:pt-10 lg:px-8">
      <PageHead
        title="Styleguide"
        sub="Every component in both themes. Light is C3 paper and rust; dark is the teal terminal. The site follows your device until you pick one with the toggle."
      />
      <div className="grid gap-6 xl:grid-cols-2">
        {(["light", "dark"] as const).map((t) => (
          <div
            key={t}
            className={`${t === "dark" ? "hh-dark dark" : "hh-light"} min-w-0 rounded-[8px] border border-hh-line bg-hh-bg p-4 text-hh-ink sm:p-6`}
            style={{ colorScheme: t }}
          >
            <p className="mb-6 font-display text-sm font-semibold uppercase tracking-[0.08em] text-hh-muted">{t === "light" ? "Light · C3" : "Dark · teal terminal"}</p>
            <Board />
          </div>
        ))}
      </div>
    </main>
  );
}
