import type { Metadata } from "next";
import NbaView from "./NbaView";
import { parseView } from "../ui";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "NBA Picks · Hobby Hub",
  description: "NBA spreads and totals from DraftKings with Sam's model line beside each game, tracked, graded and researched like football.",
};

export default async function NbaPicksPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const q = await searchParams;
  return <NbaView view={parseView(q.v)} />;
}
