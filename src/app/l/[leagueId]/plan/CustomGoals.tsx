"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Lock, Plus, Trash2 } from "lucide-react";
import type { PlanGoal } from "@/lib/dynasty/trade-plan";

// Jack's goals for this league. Saved on the server per league since
// 2026-11-07 so the trade page can follow them and they match on phone and
// Mac. Before that they sat in this browser's localStorage, one list for
// every league; that list is offered once per league as an import.
const CATEGORIES = ["roster", "trade", "draft", "standings", "other"] as const;
const DEVICE_KEYS = [
  "fantasy-hub:season-plan:custom-goals",
  // Saved before the Dynasty Hub -> Fantasy Hub rename.
  "dynasty-hub:season-plan:custom-goals",
];
const importedKey = (leagueId: string) => `fantasy-hub:season-plan:import-done:${leagueId}`;

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

function readDeviceGoals(): PlanGoal[] {
  try {
    for (const key of DEVICE_KEYS) {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const list = JSON.parse(raw) as Partial<PlanGoal>[];
      if (!Array.isArray(list)) continue;
      return list
        .filter((g) => typeof g?.text === "string" && g.text.trim())
        .slice(0, 50)
        .map((g) => ({
          id: uid(),
          text: String(g.text).trim().slice(0, 200),
          category: (CATEGORIES as readonly string[]).includes(String(g.category)) ? String(g.category) : "other",
          done: !!g.done,
        }));
    }
  } catch {
    // Private window or blocked storage: nothing to import.
  }
  return [];
}

type SaveState = { kind: "idle" } | { kind: "saving" } | { kind: "locked" } | { kind: "error"; message: string };

export function CustomGoals({ leagueId, initialGoals }: { leagueId: string; initialGoals: PlanGoal[] | null }) {
  const [goals, setGoals] = useState<PlanGoal[]>(initialGoals ?? []);
  const [text, setText] = useState("");
  const [category, setCategory] = useState<string>("trade");
  const [save, setSave] = useState<SaveState>({ kind: "idle" });
  const [deviceGoals, setDeviceGoals] = useState<PlanGoal[]>([]);
  const saved = useRef<PlanGoal[]>(initialGoals ?? []);
  const loadFailed = initialGoals === null;

  useEffect(() => {
    if (loadFailed || (initialGoals ?? []).length > 0) return;
    try {
      if (localStorage.getItem(importedKey(leagueId))) return;
    } catch {
      return;
    }
    // Reading this browser's old list on mount is the documented pattern for
    // client-only storage; this rule overfires for it.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDeviceGoals(readDeviceGoals());
  }, [leagueId, initialGoals, loadFailed]);

  async function commit(next: PlanGoal[]) {
    const before = saved.current;
    setGoals(next);
    setSave({ kind: "saving" });
    try {
      const res = await fetch("/api/plan/goals", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ league: leagueId, goals: next }),
      });
      if (res.status === 401) {
        setGoals(before);
        setSave({ kind: "locked" });
        return false;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Couldn't save goals right now.");
      }
      saved.current = next;
      setSave({ kind: "idle" });
      return true;
    } catch (err) {
      setGoals(before);
      setSave({ kind: "error", message: err instanceof Error ? err.message : "Couldn't save goals right now." });
      return false;
    }
  }

  function closeImport() {
    try {
      localStorage.setItem(importedKey(leagueId), "1");
    } catch {
      // ignore
    }
    setDeviceGoals([]);
  }

  async function importDevice() {
    if (await commit([...goals, ...deviceGoals])) closeImport();
  }

  function add() {
    const trimmed = text.trim();
    if (!trimmed) return;
    void commit([...goals, { id: uid(), text: trimmed, category, done: false }]).then((ok) => ok && setText(""));
  }

  const busy = save.kind === "saving";

  if (loadFailed) {
    return (
      <p className="py-2 text-sm text-hh-muted">
        Couldn&apos;t load your goals just now, so editing is off to keep them safe. Refresh in a minute.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {deviceGoals.length > 0 && (
        <div className="flex flex-col gap-2 rounded-[4px] border border-hh-line bg-hh-sunk p-3">
          <p className="text-sm text-hh-ink">
            This browser has {deviceGoals.length} goal{deviceGoals.length === 1 ? "" : "s"} from before goals were saved per league. Add them here?
          </p>
          <ul className="list-disc pl-5 text-sm text-hh-muted">
            {deviceGoals.map((g) => (
              <li key={g.id}>{g.text}</li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={importDevice}
              disabled={busy}
              className="min-h-11 rounded-[4px] bg-hh-accent px-4 py-2 text-sm font-semibold text-[var(--hh-on-accent)] hover:opacity-90 disabled:opacity-50"
            >
              Add to this league
            </button>
            <button
              type="button"
              onClick={closeImport}
              className="min-h-11 rounded-[4px] border border-hh-line px-4 py-2 text-sm text-hh-ink hover:bg-hh-panel"
            >
              Not for this league
            </button>
          </div>
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
        className="flex flex-wrap items-stretch gap-2"
      >
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder='e.g. "Get a WR1"'
          aria-label="New goal"
          maxLength={200}
          className="min-h-11 min-w-0 flex-1 rounded-[4px] border border-hh-line bg-hh-panel px-3 py-2 text-base text-hh-ink placeholder:text-hh-muted focus:border-hh-accent focus:outline-none sm:text-sm"
        />
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          aria-label="Goal type"
          className="min-h-11 rounded-[4px] border border-hh-line bg-hh-panel px-3 py-2 text-sm capitalize text-hh-ink focus:border-hh-accent focus:outline-none"
        >
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="inline-flex min-h-11 items-center gap-1.5 rounded-[4px] bg-hh-accent px-4 py-2 text-sm font-semibold text-[var(--hh-on-accent)] hover:opacity-90 disabled:opacity-50"
          disabled={!text.trim() || busy}
        >
          <Plus size={14} aria-hidden />
          Add
        </button>
      </form>

      {save.kind === "locked" && (
        <p className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <span className="inline-flex items-center gap-1.5 text-hh-muted">
            <Lock size={14} aria-hidden />
            Saving goals needs this device unlocked. Nothing changed.
          </span>
          <Link href="/unlock" className="font-semibold text-hh-accent-ink underline-offset-2 hover:underline">
            Unlock
          </Link>
        </p>
      )}
      {save.kind === "error" && <p className="text-sm text-hh-neg">{save.message} Nothing changed.</p>}

      {goals.length === 0 ? (
        <p className="py-2 text-sm text-hh-muted">No goals yet. Add one above.</p>
      ) : (
        <ul className="flex flex-col">
          {goals.map((g) => (
            <li key={g.id} className="flex min-h-11 items-center gap-3 border-b border-hh-line py-2.5 last:border-b-0">
              <input
                type="checkbox"
                checked={g.done}
                disabled={busy}
                onChange={() => void commit(goals.map((x) => (x.id === g.id ? { ...x, done: !x.done } : x)))}
                aria-label={`Done: ${g.text}`}
                className="size-5 shrink-0 accent-[var(--hh-accent)]"
              />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className={`text-sm ${g.done ? "text-hh-muted line-through" : "text-hh-ink"}`}>{g.text}</span>
                <span className="text-[10px] font-semibold uppercase tracking-wider text-hh-muted">{g.category}</span>
              </div>
              <button
                type="button"
                onClick={() => void commit(goals.filter((x) => x.id !== g.id))}
                disabled={busy}
                className="grid size-11 shrink-0 place-items-center rounded-[4px] text-hh-muted hover:bg-hh-sunk hover:text-hh-neg disabled:opacity-50"
                aria-label={`Remove goal: ${g.text}`}
              >
                <Trash2 size={14} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="text-[11px] text-hh-muted">
        Saved for this league on every device. The trade page reads open goals: positions you name (&quot;get a WR1&quot;),
        positions to sell (&quot;sell an RB&quot;), players to keep (&quot;keep&quot; plus a name) and, in dynasty, &quot;win now&quot; or &quot;rebuild&quot;.
      </p>
    </div>
  );
}
