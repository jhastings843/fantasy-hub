import type { Metadata } from "next";
import NbaView from "./NbaView";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "NBA Picks · Hobby Hub",
  description: "NBA spreads and totals from DraftKings with Sam's model line beside each game.",
};

export default function NbaPicksPage() {
  return <NbaView />;
}
