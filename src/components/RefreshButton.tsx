"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";

// Manually busts the league cache (rosters, users, draft, players)
// then re-renders the page. Use after a draft completes, a trade
// processes on Sleeper, or any other moment we know league state
// has changed and we want immediate fresh data.
//
// Pass leagueId so the refresh lands on the league being viewed. Without it the
// route falls back to SLEEPER_LEAGUE_ID, which is the dynasty league and almost
// never what the button is sitting next to. Pass all to refresh every league
// on the account at once, which is what the home page wants.
export function RefreshButton({
  label = "Refresh league",
  leagueId,
  all = false,
}: {
  label?: string;
  leagueId?: string;
  all?: boolean;
}) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">(
    "idle",
  );

  async function trigger() {
    setState("loading");
    try {
      const res = await fetch("/api/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          all ? { all: true } : leagueId ? { leagueId } : {},
        ),
      });
      if (!res.ok) throw new Error(await res.text());
      router.refresh();
      setState("done");
      setTimeout(() => setState("idle"), 1500);
    } catch {
      setState("error");
      setTimeout(() => setState("idle"), 2500);
    }
  }

  const text =
    state === "loading"
      ? "Refreshing..."
      : state === "done"
        ? "Updated"
        : state === "error"
          ? "Failed"
          : label;

  return (
    <button
      type="button"
      onClick={trigger}
      disabled={state === "loading"}
      className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm font-medium hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:bg-zinc-800"
    >
      <RefreshCw
        size={14}
        aria-hidden
        className={state === "loading" ? "animate-spin" : ""}
      />
      {text}
    </button>
  );
}
