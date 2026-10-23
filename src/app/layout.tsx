import type { Metadata } from "next";
import Link from "next/link";
import { Barlow_Condensed, IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import { Trophy } from "lucide-react";
import { FantasyTabs, HobbyTabs, SectionTabs } from "@/components/SiteNav";
import "./globals.css";

// The Picks ledger faces, site wide since 2026-10-19 (see ledger-look.css).
const barlow = Barlow_Condensed({ subsets: ["latin"], weight: ["600", "700", "800"], variable: "--font-barlow" });
const plex = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-plex" });
const plexMono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-plex-mono" });

export const metadata: Metadata = {
  title: "Hobby Hub",
  description: "Fantasy football, model picks and props, and the paper trading books, in one place.",
};

// Sections and Fantasy's own tabs live in components/SiteNav.tsx.

function BrandMark() {
  return (
    <span
      aria-hidden
      className="grid size-7 place-items-center rounded-lg bg-zinc-900 text-zinc-50 dark:bg-zinc-50 dark:text-zinc-900"
    >
      <Trophy size={14} strokeWidth={2.5} />
    </span>
  );
}

function SiteHeader() {
  return (
    <header className="sticky top-0 z-50 border-b border-zinc-200/60 bg-white/80 backdrop-blur-xl dark:border-zinc-800/60 dark:bg-zinc-950/80">
      <nav className="mx-auto flex min-h-16 w-full max-w-6xl flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:px-6 sm:py-0 lg:px-8">
        <Link
          href="/"
          className="flex items-center gap-2.5 transition-opacity hover:opacity-80"
        >
          <BrandMark />
          <span className="ledger-brand text-xl font-extrabold uppercase">
            Hobby Hub
          </span>
        </Link>
        {/* Wrap on phones instead of a cramped horizontal scroll; stays a
            single row on sm+ where there is room. */}
        <SectionTabs />
      </nav>
    </header>
  );
}

function SiteFooter() {
  return (
    <footer className="border-t border-zinc-200/60 px-4 py-8 sm:px-6 lg:px-8 dark:border-zinc-800/60">
      <div className="mx-auto flex w-full max-w-6xl flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <div className="flex items-center gap-2.5 text-xs">
          <BrandMark />
          <div className="flex flex-col gap-0.5">
            <span className="font-semibold text-zinc-900 dark:text-zinc-50">
              Hobby Hub
            </span>
            <span className="text-zinc-500 dark:text-zinc-400">
              Fantasy, picks, props and the paper books
            </span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400">
          <span>
            Values via{" "}
            <a
              href="https://rosteraudit.com"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-amber-700 hover:underline dark:text-amber-400"
            >
              RosterAudit
            </a>{" "}
            and{" "}
            <a
              href="https://fantasycalc.com"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-amber-700 hover:underline dark:text-amber-400"
            >
              FantasyCalc
            </a>
          </span>
          <span aria-hidden>·</span>
          <span>
            League data via{" "}
            <a
              href="https://sleeper.com"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-amber-700 hover:underline dark:text-amber-400"
            >
              Sleeper
            </a>
          </span>
        </div>
      </div>
    </footer>
  );
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`dark ${barlow.variable} ${plex.variable} ${plexMono.variable} h-full antialiased`}
    >
      <body className="relative flex min-h-full flex-col bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-50">
        <SiteHeader />
        <FantasyTabs />
        <HobbyTabs />
        <div className="flex-1">{children}</div>
        <SiteFooter />
      </body>
    </html>
  );
}
