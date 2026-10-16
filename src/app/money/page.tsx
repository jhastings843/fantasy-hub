import type { Metadata } from "next";
import MoneyView, { parseMoneyTab } from "./MoneyView";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Money · Hobby Hub",
  description: "Jack's bets in units, Phil's Polymarket paper bankroll and the four paper stock books, graphed against their yardsticks.",
};

export default async function MoneyPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const q = await searchParams;
  return <MoneyView tab={parseMoneyTab(q.v)} />;
}
