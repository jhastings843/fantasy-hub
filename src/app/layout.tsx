import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { Barlow_Condensed, Geist, Geist_Mono, JetBrains_Mono } from "next/font/google";
import HeaderSearch from "@/components/HeaderSearch";
import { BottomTabs, HubTabs, SubTabs } from "@/components/hh/HubNav";
import { THEME_SCRIPT, ThemeToggle } from "@/components/hh/Theme";
import "./globals.css";

// Hobby Hub shell (redesign, 2026-11-03): brand, five hubs, search and the theme
// toggle on one bar; the hub's own tabs one row down; on phones the hubs move to
// a bottom tab bar. Hub ownership lives in components/hh/hubs.ts.
// (components/SiteNav.tsx is the old three-section nav, no longer mounted.)

const display = Barlow_Condensed({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--ff-display", display: "swap" });
const sans = Geist({ subsets: ["latin"], variable: "--ff-sans", display: "swap" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--ff-mono", display: "swap" });
const monoDark = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--ff-mono-dark", display: "swap" });

export const metadata: Metadata = {
  title: "Hobby Hub",
  description: "Today's bets, claims and lineup calls, the model picks and props, and the paper books, in one place.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f2e9" },
    { media: "(prefers-color-scheme: dark)", color: "#0e1116" },
  ],
};

function Brand() {
  return (
    <Link href="/today" className="flex shrink-0 items-center gap-2 transition-opacity hover:opacity-80" aria-label="Hobby Hub, Today">
      <svg aria-hidden viewBox="0 0 24 24" className="size-6">
        <rect x="1" y="1" width="22" height="22" rx="5" fill="var(--hh-ink)" />
        <path d="M7 6v12M17 6v12M7 12h10" stroke="var(--hh-bg)" strokeWidth="2.6" strokeLinecap="square" />
        <rect x="15" y="15" width="6" height="6" rx="1.5" fill="var(--hh-accent)" />
      </svg>
      <span className="ledger-brand text-[24px] font-bold text-hh-ink">Hobby Hub</span>
    </Link>
  );
}

function SiteHeader() {
  return (
    <header className="sticky top-0 z-50 border-b-2 border-hh-ink bg-hh-bg/95 pt-[env(safe-area-inset-top)] backdrop-blur-md dark:border-b dark:border-hh-line dark:bg-[#0a0d11]/95">
      <div className="mx-auto flex h-[var(--hh-nav-h)] w-full max-w-6xl items-center gap-3 px-4 sm:gap-5 sm:px-6 lg:px-8">
        <Brand />
        <div className="h-full min-w-0 flex-1">
          <HubTabs />
        </div>
        <div className="flex min-w-0 items-center justify-end gap-2">
          <div className="hidden min-[420px]:block">
            <HeaderSearch />
          </div>
          <ThemeToggle />
        </div>
      </div>
      {/* Very narrow phones: search gets its own row so it never squeezes the brand. */}
      <div className="px-4 pb-2.5 min-[420px]:hidden">
        <HeaderSearch />
      </div>
    </header>
  );
}

function SiteFooter() {
  return (
    <footer className="mt-8 border-t-[1.5px] border-hh-rule px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 text-xs text-hh-muted sm:flex-row sm:items-center sm:justify-between">
        <span className="ledger-brand text-base font-bold text-hh-ink">Hobby Hub</span>
        <span>
          Values via{" "}
          <a href="https://rosteraudit.com" target="_blank" rel="noopener noreferrer" className="font-medium text-hh-accent-ink hover:underline">
            RosterAudit
          </a>{" "}
          and{" "}
          <a href="https://fantasycalc.com" target="_blank" rel="noopener noreferrer" className="font-medium text-hh-accent-ink hover:underline">
            FantasyCalc
          </a>
          . League data via{" "}
          <a href="https://sleeper.com" target="_blank" rel="noopener noreferrer" className="font-medium text-hh-accent-ink hover:underline">
            Sleeper
          </a>
          .
        </span>
      </div>
    </footer>
  );
}

export default function RootLayout({
  children,
  modal,
}: Readonly<{
  children: React.ReactNode;
  /** The game pop-up from the header search (app/@modal). */
  modal: React.ReactNode;
}>) {
  return (
    // The theme script sets .dark before paint, so the class differs from the server's on purpose.
    <html lang="en" suppressHydrationWarning className={`${display.variable} ${sans.variable} ${mono.variable} ${monoDark.variable} h-full antialiased`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="relative flex min-h-full flex-col bg-hh-bg text-hh-ink">
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[70] focus:rounded-[6px] focus:bg-hh-panel focus:px-3 focus:py-2 focus:text-sm">
          Skip to content
        </a>
        <SiteHeader />
        <SubTabs />
        <div id="main" className="flex-1">
          {children}
        </div>
        <SiteFooter />
        <BottomTabs />
        {modal}
      </body>
    </html>
  );
}
