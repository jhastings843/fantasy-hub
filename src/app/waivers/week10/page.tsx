import type { Metadata } from "next";
import { WEEK10_EMAIL } from "./content";

// Public read-only page so Jack can read the week 10 waiver preview on his phone.
// Every line of the email renders exactly as written; styling only picks a tag per line.

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Week 10 waivers preview | Hobby Hub",
  robots: { index: false, follow: false },
};

const LEAGUE = /^[A-Z0-9#' ]+\(.*\)\s\|/;

function Line({ text, first }: { text: string; first: boolean }) {
  if (first) return <h1 className="ledger-brand text-[26px] font-bold leading-tight text-hh-ink">{text}</h1>;
  if (text === "SOURCES" || LEAGUE.test(text))
    return <h2 className="mt-8 border-b-[1.5px] border-hh-rule pb-1.5 text-[15px] font-semibold uppercase tracking-wide text-hh-ink">{text}</h2>;
  if (/^\d+\.\s/.test(text)) return <p className="mt-3 font-semibold text-hh-ink">{text}</p>;
  if (/^\s+/.test(text)) return <p className="pl-5 text-hh-muted">{text.trimStart()}</p>;
  return <p className="mt-2">{text}</p>;
}

export default function Week10WaiversPage() {
  const lines = WEEK10_EMAIL.replace(/\n$/, "").split("\n");
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-6 text-[15px] leading-relaxed sm:px-6">
      <p className="mb-5 rounded-[6px] border border-hh-rule bg-hh-panel px-3 py-2.5 text-[13px] leading-snug">
        Sources: redraft used the redraft web research plus Sleeper most-added; dynasty used its own dynasty web research
        plus Sleeper most-added. The Jingles and Flock week 10 lists were not available when this was built (latest
        Jingles on file is week 7).
      </p>
      <article className="break-words">
        {lines.map((text, i) => (text.trim() === "" ? <div key={i} className="h-2" aria-hidden /> : <Line key={i} text={text} first={i === 0} />))}
      </article>
    </main>
  );
}
