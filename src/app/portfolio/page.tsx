import type { Metadata } from "next";
import Link from "next/link";
import { readFile } from "node:fs/promises";
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { canSeePortfolio } from "@/lib/portfolio/lock";
import { getPortfolio } from "@/lib/portfolio/store";
import { isPortfolioSnapshot, type PortfolioSnapshot } from "@/lib/portfolio/types";
import { Empty, PageHead } from "@/components/hh/ui";
import { PortfolioView } from "./PortfolioView";
import { MoneyChips } from "../money/MoneyView";

// Jack's real balances. Every other Hobby Hub read is public, so this page
// checks the signed hh_session cookie on the server before it touches the
// snapshot. Locked: a short note and a link to /unlock, nothing else is read
// or sent. Fails closed when HH_SESSION_SECRET is unset (see lib/portfolio/lock).

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Portfolio · Hobby Hub",
  robots: { index: false, follow: false },
};

async function load(): Promise<PortfolioSnapshot | null> {
  // Local checks only: PORTFOLIO_SNAPSHOT_FILE points at a snapshot JSON and the
  // page renders from it with no Redis read. Ignored in production.
  const file = process.env.NODE_ENV !== "production" ? process.env.PORTFOLIO_SNAPSHOT_FILE : undefined;
  if (file) {
    const s: unknown = JSON.parse(await readFile(file, "utf8"));
    return isPortfolioSnapshot(s) ? s : null;
  }
  return getPortfolio();
}

export default async function PortfolioPage() {
  const open = await canSeePortfolio({
    secret: process.env.HH_SESSION_SECRET,
    token: (await cookies()).get(SESSION_COOKIE)?.value,
    nodeEnv: process.env.NODE_ENV,
  });

  if (!open) {
    return (
      <main className="mx-auto flex w-full max-w-md flex-col gap-5 px-4 pb-16 pt-10">
        <PageHead title="Portfolio" />
        <MoneyChips tab="portfolio" />
        <div className="hh-spot flex flex-col gap-3 p-4">
          <p className="text-[15px] text-hh-ink">This page is private. Unlock this device to see it.</p>
          <Link
            href="/unlock"
            className="inline-flex h-11 items-center justify-center rounded-[6px] bg-hh-accent px-4 font-semibold text-[var(--hh-on-accent)] transition-opacity hover:opacity-90"
          >
            Unlock this device
          </Link>
        </div>
      </main>
    );
  }

  let snap: PortfolioSnapshot | null = null;
  let failed = false;
  try {
    snap = await load();
  } catch (e) {
    console.error("portfolio: could not read the snapshot", e instanceof Error ? e.message : e);
    failed = true;
  }
  return (
    <main className="hh-page-in mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 pb-16 pt-8 sm:px-6 lg:px-8">
      <MoneyChips tab="portfolio" />
      {snap ? (
        <PortfolioView s={snap} />
      ) : (
        <>
          <PageHead title="Portfolio" />
          <Empty>
            {failed
              ? "Couldn't read the latest snapshot just now. Reload in a minute."
              : "No snapshot yet. It shows up here after the daily run on your Mac posts one."}
          </Empty>
        </>
      )}
    </main>
  );
}
