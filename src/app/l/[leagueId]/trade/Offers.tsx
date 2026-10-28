"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import type { TradeOffer } from "@/lib/dynasty/trade-offers";
import type { BestTradeIdea } from "@/lib/dynasty/trade-recommender";
import { PlayerLink } from "@/components/PlayerLink";

// One pitch per manager: who to send it to, the deal, why both sides take
// it, and a note ready to paste into Sleeper (lib/dynasty/trade-offers.ts).

const CHANCE_TINT: Record<TradeOffer["chance"]["tone"], string> = {
  good: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300",
  ok: "bg-cyan-100 text-cyan-800 dark:bg-cyan-950/50 dark:text-cyan-300",
  even: "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
};

function Side({ label, players, accent }: { label: string; players: TradeOffer["send"]; accent?: boolean }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <span className={`text-[10px] font-semibold uppercase tracking-wider ${accent ? "text-amber-700 dark:text-amber-400" : "text-zinc-500 dark:text-zinc-400"}`}>{label}</span>
      {players.map((p) => (
        <div key={p.id} className="flex items-baseline justify-between gap-2">
          <span className="min-w-0 truncate text-sm font-medium">
            <PlayerLink id={p.id} name={p.name} />
            <span className="ml-1.5 text-xs font-normal text-zinc-500 dark:text-zinc-400">{p.position}</span>
          </span>
          <span className="shrink-0 text-xs tabular-nums text-zinc-500 dark:text-zinc-400">{p.value.toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
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
      className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-zinc-200 px-3 text-xs font-semibold transition-colors hover:border-amber-400 hover:text-amber-700 focus:outline-none focus:ring-2 focus:ring-amber-500 dark:border-zinc-700 dark:hover:border-amber-700 dark:hover:text-amber-400"
    >
      {done ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {done ? "Copied" : "Copy message"}
    </button>
  );
}

export default function Offers({ offers, onApply }: { offers: TradeOffer[]; onApply: (idea: BestTradeIdea) => void }) {
  if (offers.length === 0) return null;
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 className="text-xl font-semibold tracking-tight">Offers to send</h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          The best deal with each manager who has one, strongest first. Each fixes one of your rooms from their surplus and still scores as a win for them.
        </p>
      </div>
      <ol className="grid gap-3 lg:grid-cols-2">
        {offers.map((o, i) => (
          <li key={o.partnerRosterId} className="flex flex-col gap-3 rounded-2xl border border-zinc-200 bg-white p-4 transition-colors hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700">
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-baseline gap-2">
                <span className="text-xs font-semibold tabular-nums text-amber-600 dark:text-amber-400">{i + 1}</span>
                <span className="truncate text-base font-semibold">Offer {o.partnerName}</span>
              </div>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${CHANCE_TINT[o.chance.tone]}`}>{o.chance.label}</span>
            </div>
            <div className="flex items-start gap-3 rounded-xl bg-zinc-50 p-3 dark:bg-zinc-950/40">
              <Side label="You send" players={o.send} />
              <span aria-hidden className="self-center text-zinc-400">↔</span>
              <Side label="You get" players={o.receive} accent />
            </div>
            <ul className="flex flex-col gap-1">
              {o.why.map((w) => (
                <li key={w} className="flex gap-2 text-sm leading-snug text-zinc-700 dark:text-zinc-300">
                  <span aria-hidden className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-amber-500" />
                  <span>{w}</span>
                </li>
              ))}
            </ul>
            <p className="rounded-lg border-l-2 border-amber-400 bg-amber-50/60 px-3 py-2 text-sm italic text-zinc-700 dark:border-amber-700 dark:bg-amber-950/20 dark:text-zinc-300">{o.message}</p>
            <div className="flex flex-wrap gap-2">
              <CopyButton text={o.message} />
              <button
                type="button"
                onClick={() => onApply(o.idea)}
                className="inline-flex min-h-9 items-center rounded-lg bg-amber-500 px-3 text-xs font-semibold text-white transition-colors hover:bg-amber-600 focus:outline-none focus:ring-2 focus:ring-amber-500"
              >
                Load in the builder
              </button>
            </div>
          </li>
        ))}
      </ol>
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        The chance reads their side of the analyzer&apos;s score (value to them plus what it does to their rooms), not a fitted rate: there is no accept or decline history to fit one on.
      </p>
    </section>
  );
}
