"use client";

import { useState } from "react";

// A live score that flashes once when it changes (after an auto refresh), so the
// eye finds what moved. Reduced motion turns the flash off (globals.css).
export function LiveScore({ text, className = "" }: { text: string; className?: string }) {
  const [shown, setShown] = useState(text);
  const [ticks, setTicks] = useState(0);
  if (text !== shown) {
    setShown(text);
    setTicks((t) => t + 1);
  }
  return (
    <span key={ticks} className={`hh-num rounded-[3px] px-0.5 ${ticks ? "hh-tick" : ""} ${className}`} aria-live="polite">
      {text}
    </span>
  );
}
