import type { Metadata } from "next";
import { redirect } from "next/navigation";
import MoneyView, { parseMoneyTab } from "./MoneyView";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Money · Hobby Hub",
  description: "Jack's bets in units, Phil's Polymarket paper bankroll and the four paper stock books, graphed against their yardsticks.",
};

export default async function MoneyPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const q = await searchParams;
  const tab = parseMoneyTab(q.v);
  if (tab === "portfolio") redirect("/portfolio");
  return <MoneyView tab={tab} />;
}
