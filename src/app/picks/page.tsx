import type { Metadata } from "next";
import PicksView from "./PicksView";
import { parseMarket, parseView } from "./ui";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Picks · Fantasy Hub",
  description: "NFL spreads, totals and straight-up picks where Sam's and David Sasser's models agree at the current line.",
};

export default async function NflPicksPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const q = await searchParams;
  return <PicksView league="nfl" market={parseMarket(q.m)} view={parseView(q.v)} />;
}
