"use client";

import { useState, type ReactNode } from "react";

// A <details> whose body is fetched the first time it opens (UX pass item 4,
// 2026-11-06). `load` is a server function that returns the body as React, so
// links and pop-ups inside it work as if it had been on the page all along.
//
//   <LazyDetails summary={<summary>…</summary>} load={loadPropGame.bind(null, "nfl", slug)} />

export function LazyDetails({
  summary,
  load,
  className,
  loadingClass,
  wrapClass,
}: {
  summary: ReactNode;
  load: () => Promise<ReactNode>;
  className?: string;
  loadingClass?: string;
  /** Wraps the loaded body in a div with this class, when given. */
  wrapClass?: string;
}) {
  const [body, setBody] = useState<ReactNode>(null);
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");

  function fetchBody() {
    setState("loading");
    load()
      .then((b) => {
        setBody(b);
        setState("done");
      })
      .catch(() => setState("error"));
  }

  return (
    <details
      className={className}
      onToggle={(e) => {
        if (e.currentTarget.open && (state === "idle" || state === "error")) fetchBody();
      }}
    >
      {summary}
      {state === "done" ? (
        wrapClass ? <div className={wrapClass}>{body}</div> : body
      ) : state === "error" ? (
        <p className={loadingClass} role="alert">
          Couldn&apos;t load this game.{" "}
          <button type="button" onClick={fetchBody} className="font-semibold underline underline-offset-2">
            Try again
          </button>
        </p>
      ) : (
        <p className={loadingClass} aria-live="polite">
          Loading…
        </p>
      )}
    </details>
  );
}
