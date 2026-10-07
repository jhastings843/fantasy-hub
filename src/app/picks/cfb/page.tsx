import type { Metadata } from "next";
import PicksView from "../PicksView";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "College Picks · Fantasy Hub",
  description: "Where David Sasser's and Sam's college football models agree against the spread, backtested weekly.",
};

export default function CfbPicksPage() {
  return <PicksView league="cfb" />;
}
