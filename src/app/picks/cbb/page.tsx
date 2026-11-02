import type { Metadata } from "next";
import CbbView from "./CbbView";
import { parseMarket, parseView } from "../ui";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "College Hoops Picks · Hobby Hub",
  description: "College basketball spreads, totals and straight up: our blended rating (ours plus T-Rank) against DraftKings, tracked and graded every game.",
};

export default async function CbbPicksPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const q = await searchParams;
  const v = parseView(q.v);
  return <CbbView view={v === "log" ? "week" : v} market={parseMarket(q.m)} show={q.show === "all" ? "all" : "priced"} />;
}
