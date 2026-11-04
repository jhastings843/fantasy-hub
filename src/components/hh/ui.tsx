import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";

// Hobby Hub primitives (C3 / teal terminal). Server-safe, no state.
// The rules: data sits on thin ink rules (Section), never in boxes; one Spotlight
// per screen for the single action that matters now; detail hides behind a
// Disclosure; every number goes through Num so it is mono and tabular.

export type Tone = "accent" | "pos" | "neg" | "gold" | "muted" | "live";

const TONE_TEXT: Record<Tone, string> = {
  accent: "text-hh-accent-ink",
  pos: "text-hh-pos",
  neg: "text-hh-neg",
  gold: "text-hh-gold",
  muted: "text-hh-muted",
  live: "text-hh-neg",
};

const CHIP: Record<Tone, string> = {
  accent: "bg-hh-accent-soft text-hh-accent-ink",
  pos: "bg-[var(--hh-pos-soft)] text-hh-pos",
  neg: "bg-[var(--hh-neg-soft)] text-hh-neg",
  gold: "bg-[var(--hh-gold-soft)] text-hh-gold",
  muted: "border border-hh-line text-hh-muted",
  live: "bg-[var(--hh-neg-soft)] text-hh-neg",
};

/** Page title in Barlow caps, one plain line under it, an optional aside (as-of, refresh). */
export function PageHead({ title, sub, aside }: { title: ReactNode; sub?: ReactNode; aside?: ReactNode }) {
  return (
    <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between sm:gap-6">
      <div className="flex min-w-0 flex-col gap-2">
        <h1 className="hh-title">{title}</h1>
        {sub && <p className="max-w-[60ch] text-[15px] leading-snug text-hh-ink-2">{sub}</p>}
      </div>
      {aside && <div className="shrink-0 text-xs text-hh-muted sm:text-right">{aside}</div>}
    </header>
  );
}

/** A block of data: a small label, then a 1.5px ink rule, then the content. No box. */
export function Section({
  label,
  aside,
  id,
  children,
  className = "",
}: {
  label: ReactNode;
  aside?: ReactNode;
  id?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section aria-labelledby={id} className={`flex min-w-0 flex-col ${className}`}>
      <div className="hh-ruled flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id={id} className="hh-label">
          {label}
        </h2>
        {aside && <div className="text-xs text-hh-muted">{aside}</div>}
      </div>
      <div className="mt-3 min-w-0">{children}</div>
    </section>
  );
}

/** The one box per screen: the single action that matters right now. */
export function Spotlight({ label, aside, children, className = "" }: { label: ReactNode; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`hh-spot min-w-0 p-4 sm:p-5 ${className}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="hh-label !text-hh-accent-ink">{label}</h2>
        {aside && <div className="text-xs text-hh-muted">{aside}</div>}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

/** Answer first, depth on tap. Native details, so it works without JavaScript and with the keyboard. */
export function Disclosure({ summary = "Why", children, className = "" }: { summary?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <details className={`hh-more ${className}`}>
      <summary>
        <ChevronRight size={15} strokeWidth={2.2} className="hh-chev" aria-hidden />
        {summary}
      </summary>
      <div className="hh-more-body pb-1 text-sm leading-relaxed text-hh-ink-2">{children}</div>
    </details>
  );
}

/** Every number: mono, tabular. */
export function Num({ children, tone, className = "" }: { children: ReactNode; tone?: Tone; className?: string }) {
  return <span className={`hh-num ${tone ? TONE_TEXT[tone] : ""} ${className}`}>{children}</span>;
}

export function Chip({ tone = "muted", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={`inline-flex max-w-full items-center gap-1.5 rounded-[4px] px-1.5 py-0.5 text-[11px] font-semibold leading-4 ${CHIP[tone]}`}>
      {tone === "live" && <span className="hh-live-dot !size-1.5" aria-hidden />}
      {children}
    </span>
  );
}

/** A big number with a small label: records, units, counts. */
export function Stat({ label, value, sub, tone }: { label: ReactNode; value: ReactNode; sub?: ReactNode; tone?: Tone }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-xs text-hh-muted">{label}</span>
      <span className={`hh-num text-[26px] font-semibold leading-none ${tone ? TONE_TEXT[tone] : "text-hh-ink"}`}>{value}</span>
      {sub && <span className="text-xs leading-snug text-hh-muted">{sub}</span>}
    </div>
  );
}

/** The call, in words: the verb carries the weight, one plain reason follows. */
export function Call({ verb, reason }: { verb: ReactNode; reason?: ReactNode }) {
  return (
    <p className="text-[15px] leading-snug text-hh-ink-2">
      <b className="font-semibold text-hh-ink">{verb}</b>
      {reason && <> {reason}</>}
    </p>
  );
}

/** A row of data on a hairline: left content, right number. Rows stack with no boxes. */
export function Row({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`flex min-h-11 items-center justify-between gap-3 border-b border-hh-line py-2.5 last:border-b-0 ${className}`}>{children}</div>;
}

/** Calm empty state: say what is true and where to look next. */
export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-2 text-sm text-hh-muted">{children}</p>;
}
