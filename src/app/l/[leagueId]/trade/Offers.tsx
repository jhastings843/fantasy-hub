"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import type { TradeOffer } from "@/lib/dynasty/trade-offers";
import type { BestTradeIdea } from "@/lib/dynasty/trade-recommender";
import { PlayerLink } from "@/components/PlayerLink";
import { Chip, Num, Section, Spotlight, type Tone } from "@/components/hh/ui";

// One pitch per manager: who to send it to, the deal, why both sides take
// it, and a note ready to paste into Sleeper (lib/dynasty/trade-offers.ts).
// The strongest offer takes the page's one Spotlight; the rest sit on hairlines.

const CHANCE_TONE: Record<TradeOffer["chance"]["tone"], Tone> = {
  good: "pos",
  ok: "gold",
  even: "muted",
};

const SECONDARY_BTN =
  "inline-flex h-11 items-center gap-1.5 rounded-[6px] border border-hh-line bg-hh-panel px-3 text-xs font-semibold text-hh-ink transition-colors hover:border-hh-accent hover:text-hh-accent-ink focus:border-hh-accent focus:outline-none sm:h-9";
const PRIMARY_BTN =
  "inline-flex h-11 items-center gap-1.5 rounded-[6px] bg-hh-accent px-4 text-sm font-semibold text-[var(--hh-on-accent)] transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-hh-accent sm:h-9";

function Side({ label, players, accent }: { label: string; players: TradeOffer["send"]; accent?: boolean }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <span className={`hh-label ${accent ? "!text-hh-accent-ink" : ""}`}>{label}</span>
      {players.map((p) => (
        <div key={p.id} className="flex items-baseline justify-between gap-2">
          <span className="min-w-0 truncate text-sm font-medium text-hh-ink">
            <PlayerLink id={p.id} name={p.name} />
            <span className="ml-1.5 text-xs font-normal text-hh-muted">{p.position}</span>
          </span>
          <Num className="shrink-0 text-xs text-hh-muted">{p.value.toLocaleString()}</Num>
        </div>
      ))}
    </div>
  );
}

function CopyButton({ text, primary }: { text: string; primary?: boolean }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        }).catch(() => {});
      }}
      className={primary ? PRIMARY_BTN : SECONDARY_BTN}
    >
      {done ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {done ? "Copied" : "Copy message"}
    </button>
  );
}

function OfferBody({ o, i, onApply, top }: { o: TradeOffer; i: number; onApply: (idea: BestTradeIdea) => void; top?: boolean }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-baseline gap-2">
          <Num tone="accent" className="text-xs font-semibold">{i + 1}</Num>
          <span className={`truncate font-semibold text-hh-ink ${top ? "text-lg" : "text-base"}`}>Offer {o.partnerName}</span>
        </div>
        <Chip tone={CHANCE_TONE[o.chance.tone]}>{o.chance.label}</Chip>
      </div>
      <div className="flex items-start gap-3 border-y border-hh-line py-3">
        <Side label="You send" players={o.send} />
        <span aria-hidden className="self-center text-hh-muted">↔</span>
        <Side label="You get" players={o.receive} accent />
      </div>
      <ul className="flex flex-col gap-1">
        {o.why.map((w) => (
          <li key={w} className="flex gap-2 text-sm leading-snug text-hh-ink-2">
            <span aria-hidden className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-hh-accent" />
            <span>{w}</span>
          </li>
        ))}
      </ul>
      <p className="border-l-2 border-hh-accent py-1 pl-3 text-sm italic text-hh-ink-2">{o.message}</p>
      <div className="flex flex-wrap gap-2">
        <CopyButton text={o.message} primary={top} />
        <button type="button" onClick={() => onApply(o.idea)} className={SECONDARY_BTN}>
          Load in the builder
        </button>
      </div>
    </div>
  );
}

export default function Offers({ offers, onApply }: { offers: TradeOffer[]; onApply: (idea: BestTradeIdea) => void }) {
  if (offers.length === 0) return null;
  const [first, ...rest] = offers;
  return (
    <div className="flex flex-col gap-6">
      <Spotlight label="Offer to send now" aside={`${offers.length} manager${offers.length === 1 ? "" : "s"} with a deal`}>
        <OfferBody o={first} i={0} onApply={onApply} top />
      </Spotlight>
      {rest.length > 0 && (
        <Section label="Offers to send">
          <p className="max-w-[70ch] text-sm text-hh-ink-2">
            The best deal with each manager who has one, strongest first. Each fixes one of your rooms from their surplus and still scores as a win for them.
          </p>
          <ol className="mt-1 grid gap-x-8 lg:grid-cols-2">
            {rest.map((o, j) => (
              <li key={o.partnerRosterId} className="border-b border-hh-line py-4">
                <OfferBody o={o} i={j + 1} onApply={onApply} />
              </li>
            ))}
          </ol>
        </Section>
      )}
      <p className="text-xs text-hh-muted">
        The chance reads their side of the analyzer&apos;s score (value to them plus what it does to their rooms), not a fitted rate: there is no accept or decline history to fit one on.
      </p>
    </div>
  );
}
