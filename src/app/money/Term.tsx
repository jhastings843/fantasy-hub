"use client";

import { useEffect, useId, useRef, useState } from "react";
import m from "./money.module.css";

// A tag that explains itself: tap or click it and a short plain definition
// opens under it; tap again, press Escape or click elsewhere to close it.
// Definitions come from trade-bot's own rules (trends/PICKER.md, tradebot/trends.py).

export function Term({ label, def, tone }: { label: string; def: string; tone?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);
  return (
    <span ref={ref} className={m.term}>
      <button type="button" className={`${m.tag} ${m.termBtn} ${tone ?? ""}`} aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
        {label}
      </button>
      {open && (
        <span id={id} role="note" className={m.termPop}>
          {def}
        </span>
      )}
    </span>
  );
}
