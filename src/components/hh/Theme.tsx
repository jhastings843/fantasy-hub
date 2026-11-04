"use client";

import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";

// Theme: follows the system (light = C3 paper, dark = teal terminal) unless the
// toggle stored a choice. The script below runs before first paint, so the page
// never flashes the wrong theme.

export type ThemeChoice = "system" | "light" | "dark";
const KEY = "hh-theme";

/** Inlined in <head>. Kept tiny and dependency free; wrapped so blocked storage never breaks the page. */
export const THEME_SCRIPT = `(function(){try{var c=null;try{c=localStorage.getItem("${KEY}")}catch(e){}var d=c==="dark"||(c!=="light"&&window.matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d)}catch(e){}})();`;

function apply(choice: ThemeChoice, animate: boolean) {
  const root = document.documentElement;
  const dark = choice === "dark" || (choice === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  if (animate) {
    root.classList.add("hh-theme-anim");
    window.setTimeout(() => root.classList.remove("hh-theme-anim"), 260);
  }
  root.classList.toggle("dark", dark);
}

function read(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

const NEXT: Record<ThemeChoice, ThemeChoice> = { system: "light", light: "dark", dark: "system" };
const LABEL: Record<ThemeChoice, string> = { system: "Theme: follows your device", light: "Theme: light", dark: "Theme: dark" };

export function ThemeToggle() {
  const [choice, setChoice] = useState<ThemeChoice>("system");

  useEffect(() => {
    // Reading storage after mount keeps server and client markup identical.
    const c = read();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setChoice(c);
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (read() === "system") apply("system", true);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const pick = () => {
    const next = NEXT[choice];
    setChoice(next);
    try {
      if (next === "system") localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, next);
    } catch {
      // Private mode: the choice lasts this page only.
    }
    apply(next, true);
  };

  const Icon = choice === "light" ? Sun : choice === "dark" ? Moon : Monitor;
  return (
    <button
      type="button"
      onClick={pick}
      aria-label={`${LABEL[choice]}. Tap to change.`}
      title={LABEL[choice]}
      className="grid size-10 shrink-0 cursor-pointer place-items-center rounded-[6px] border border-hh-line text-hh-ink-2 transition-colors hover:border-hh-accent hover:text-hh-accent-ink"
    >
      <Icon size={17} strokeWidth={1.8} aria-hidden />
    </button>
  );
}
