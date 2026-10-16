import type { Metadata } from "next";
import { redirect } from "next/navigation";
import PicksView from "./PicksView";
import { parseMarket, parseView } from "./ui";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Picks · Hobby Hub",
  description: "NFL spreads, totals and straight-up picks where Sam's and David Sasser's models agree at the current line.",
};

export default async function NflPicksPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const q = await searchParams;
  // First TD moved to the Props page; old links land there.
  if (q.m === "ftd") redirect(`/props?m=ftd${typeof q.v === "string" && q.v !== "week" ? `&v=${q.v}` : ""}`);
  return <PicksView league="nfl" market={parseMarket(q.m)} view={parseView(q.v)} />;
}
