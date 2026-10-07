import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import { Trophy } from "lucide-react";
import { NavLink } from "@/components/NavLink";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Fantasy Hub",
  description: "Fantasy football tools: dynasty leagues, survivor pools, and more.",
};

// Tools that belong to no single league. Per-league tools live one bar down,
// in the league layout at /l/[leagueId].
const NAV_LINKS: { href: string; label: string; exact?: boolean }[] = [
  { href: "/", label: "Leagues", exact: true },
  { href: "/strategy", label: "Strategy" },
  { href: "/survivor", label: "Survivor" },
  { href: "/picks", label: "Picks" },
  { href: "/resources", label: "Resources" },
];

function BrandMark() {
  return (
    <span
      aria-hidden
      className="grid size-7 place-items-center rounded-lg bg-gradient-to-br from-amber-400 via-amber-500 to-orange-500 text-white shadow-md shadow-amber-500/30 ring-1 ring-amber-400/20"
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
          <span className="text-base font-bold tracking-tight">
            Fantasy Hub
          </span>
        </Link>
        {/* Wrap on phones instead of a cramped horizontal scroll; stays a
            single row on sm+ where there is room. */}
        <div className="-mx-1 flex flex-wrap items-center gap-x-1 gap-y-1 sm:mx-0">
          {NAV_LINKS.map((l) => (
            <NavLink
              key={l.href}
              href={l.href}
              label={l.label}
              exact={l.exact}
            />
          ))}
        </div>
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
              Fantasy Hub
            </span>
            <span className="text-zinc-500 dark:text-zinc-400">
              Dynasty, redraft, and survivor tools
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
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="relative flex min-h-full flex-col bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-50">
        {/* Subtle ambient gradient backdrop */}
        <div
          aria-hidden
          className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
        >
          <div className="absolute -left-32 top-0 h-[600px] w-[600px] rounded-full bg-amber-200/30 blur-3xl dark:bg-amber-900/15" />
          <div className="absolute -right-32 top-96 h-[500px] w-[500px] rounded-full bg-cyan-200/25 blur-3xl dark:bg-cyan-900/10" />
          <div className="absolute bottom-0 left-1/2 h-[400px] w-[400px] -translate-x-1/2 rounded-full bg-rose-200/20 blur-3xl dark:bg-rose-900/10" />
        </div>
        <SiteHeader />
        <div className="flex-1">{children}</div>
        <SiteFooter />
      </body>
    </html>
  );
}
