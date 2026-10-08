import type { Metadata } from "next";
import PicksView from "../PicksView";
import { parseMarket, parseView } from "../ui";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "College Picks · Fantasy Hub",
  description: "College spreads, totals and straight-up picks where Sam's, David Sasser's and PEM's models agree at the current line.",
};

export default async function CfbPicksPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const q = await searchParams;
  return <PicksView league="cfb" market={parseMarket(q.m)} view={parseView(q.v)} />;
}
