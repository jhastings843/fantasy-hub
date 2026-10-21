import type { Metadata } from "next";
import PropsView, { parsePropsMarket } from "./PropsView";
import { parseView } from "../picks/ui";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Props · Hobby Hub",
  description: "Our own NFL and NBA player prop, first touchdown and first basket models, and David Sasser's NFL props board: saved before kickoff, graded after, and checked for slices that beat the price.",
};

export default async function PropsPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const q = await searchParams;
  return <PropsView market={parsePropsMarket(q.m)} view={parseView(q.v)} />;
}
