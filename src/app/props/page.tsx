import type { Metadata } from "next";
import PropsView, { parsePropsMarket } from "./PropsView";
import { parseView } from "../picks/ui";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Props · Hobby Hub",
  description: "Sam's NFL player prop and first touchdown models, saved before kickoff, graded after, and checked for slices that beat the price.",
};

export default async function PropsPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const q = await searchParams;
  return <PropsView market={parsePropsMarket(q.m)} view={parseView(q.v)} />;
}
