"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";

interface CustomGoal {
  id: string;
  text: string;
  category: string;
  done: boolean;
}

const STORAGE_KEY = "fantasy-hub:season-plan:custom-goals";
// Goals saved before the Dynasty Hub -> Fantasy Hub rename live under the old
// key; read it as a fallback so nothing is lost. The next save writes the new key.
const LEGACY_STORAGE_KEY = "dynasty-hub:season-plan:custom-goals";
const CATEGORIES = ["roster", "trade", "draft", "standings", "other"] as const;

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function CustomGoals() {
  const [goals, setGoals] = useState<CustomGoal[]>([]);
  const [text, setText] = useState("");
  const [category, setCategory] = useState<string>("other");
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw =
        localStorage.getItem(STORAGE_KEY) ??
        localStorage.getItem(LEGACY_STORAGE_KEY);
      if (raw) {
        // Hydrating from localStorage on client mount is the documented
        // pattern; this rule overfires for it.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setGoals(JSON.parse(raw));
      }
    } catch {
      // ignore
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(goals));
    } catch {
      // ignore
    }
  }, [goals, hydrated]);

  function add() {
    const trimmed = text.trim();
    if (!trimmed) return;
    setGoals((g) => [
      ...g,
      { id: uid(), text: trimmed, category, done: false },
    ]);
    setText("");
  }

  function toggle(id: string) {
    setGoals((g) =>
      g.map((x) => (x.id === id ? { ...x, done: !x.done } : x)),
    );
  }

  function remove(id: string) {
    setGoals((g) => g.filter((x) => x.id !== id));
  }

  if (!hydrated) {
    return (
      <div className="py-2">
        <span className="text-sm text-hh-muted">
          Loading goals...
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
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
          placeholder="Add a goal..."
          className="min-h-11 min-w-0 flex-1 rounded-[4px] border border-hh-line bg-hh-panel px-3 py-2 text-base text-hh-ink placeholder:text-hh-muted focus:border-hh-accent focus:outline-none sm:text-sm"
        />
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
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
          disabled={!text.trim()}
        >
          <Plus size={14} aria-hidden />
          Add
        </button>
      </form>

      {goals.length === 0 ? (
        <p className="py-2 text-sm text-hh-muted">
          No custom goals yet. Add one above; saved locally to this browser.
        </p>
      ) : (
        <ul className="flex flex-col">
          {goals.map((g) => (
            <li key={g.id} className="flex min-h-11 items-center gap-3 border-b border-hh-line py-2.5 last:border-b-0">
              <input
                type="checkbox"
                checked={g.done}
                onChange={() => toggle(g.id)}
                className="size-5 shrink-0 accent-[var(--hh-accent)]"
              />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span
                  className={`text-sm ${
                    g.done
                      ? "text-hh-muted line-through"
                      : "text-hh-ink"
                  }`}
                >
                  {g.text}
                </span>
                <span className="text-[10px] font-semibold uppercase tracking-wider text-hh-muted">
                  {g.category}
                </span>
              </div>
              <button
                type="button"
                onClick={() => remove(g.id)}
                className="grid size-11 shrink-0 place-items-center rounded-[4px] text-hh-muted hover:bg-hh-sunk hover:text-hh-neg"
                aria-label="Remove goal"
              >
                <Trash2 size={14} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="text-[11px] text-hh-muted">
        Custom goals are saved to this browser only. Clear browser data and
        they reset.
      </p>
    </div>
  );
}
