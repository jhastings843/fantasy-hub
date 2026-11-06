"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";

// Manual refresh (Jack, 2026-11-06). Tapping it asks Jack's Mac, which checks
// once a minute, to re-run the price script on the newest Fidelity export in
// ~/Downloads and post a new snapshot. The page re-renders every 10 seconds
// until the snapshot's asOf changes, then says when. Gives up after 3 minutes
// (the Mac is probably asleep).
const POLL_MS = 10_000;
const GIVE_UP_MS = 180_000;

type State = "idle" | "sending" | "waiting" | "done" | "error";

export function PortfolioRefresh({ asOf }: { asOf: string }) {
  const router = useRouter();
  const [state, setState] = useState<State>("idle");
  const [note, setNote] = useState<string | null>(null);
  const start = useRef<{ asOf: string; at: number } | null>(null);

  // The new snapshot arrived: asOf moved past the one on screen when tapped.
  useEffect(() => {
    if (state === "waiting" && start.current && asOf !== start.current.asOf) {
      start.current = null;
      setState("done");
      setNote(null);
      const t = setTimeout(() => setState("idle"), 4000);
      return () => clearTimeout(t);
    }
  }, [asOf, state]);

  useEffect(() => {
    if (state !== "waiting") return;
    const id = setInterval(() => {
      if (start.current && Date.now() - start.current.at > GIVE_UP_MS) {
        start.current = null;
        setState("error");
        setNote("No answer from your Mac. Is it awake? Try again once it is.");
        return;
      }
      router.refresh();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [state, router]);

  async function trigger() {
    setState("sending");
    setNote(null);
    try {
      const res = await fetch("/api/portfolio/refresh", { method: "POST" });
      if (res.status === 401) {
        router.push("/unlock");
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      start.current = { asOf, at: Date.now() };
      setState("waiting");
      setNote("Your Mac picks this up within a minute, using the newest Fidelity export in Downloads.");
    } catch {
      setState("error");
      setNote("Couldn't send the request. Try again in a moment.");
    }
  }

  const busy = state === "sending" || state === "waiting";
  const label = state === "sending" ? "Sending" : state === "waiting" ? "Waiting on your Mac" : state === "done" ? "Updated" : "Refresh";

  return (
    <div className="flex flex-col gap-1 sm:items-end">
      <button
        type="button"
        onClick={trigger}
        disabled={busy}
        aria-live="polite"
        className="inline-flex h-11 items-center gap-2 self-start rounded-[6px] border border-hh-line bg-hh-panel px-3.5 text-sm font-semibold text-hh-ink transition-colors hover:border-hh-ink-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hh-accent disabled:cursor-wait disabled:opacity-70 sm:self-end"
      >
        <RefreshCw size={15} strokeWidth={2.2} aria-hidden className={busy ? "animate-spin" : ""} />
        {label}
      </button>
      {note && <span className={`max-w-[34ch] text-xs leading-snug ${state === "error" ? "text-hh-neg" : "text-hh-muted"}`}>{note}</span>}
    </div>
  );
}
