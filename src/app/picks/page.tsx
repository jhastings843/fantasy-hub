import type { Metadata } from "next";
import PicksView from "./PicksView";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Picks · Fantasy Hub",
  description: "Where David Sasser's and Sam's NFL models agree against the spread, backtested weekly.",
};

export default function NflPicksPage() {
  return <PicksView league="nfl" />;
}
