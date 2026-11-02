import type { Metadata } from "next";
import Link from "next/link";
import { getCbbBoard } from "@/lib/models/cbb/store";
import { CbbGamePreview, findCbbRow } from "../CbbGame";
import s from "../../picks.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "CBB game · Picks · Hobby Hub",
  description: "One college basketball game: our side, edge and chance in every market, and the result once it ends.",
};

// /picks/cbb/game?id=401...: the full page; from inside the site it opens as a pop-up (@modal).
export default async function CbbGamePage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const q = await searchParams;
  const id = typeof q.id === "string" ? q.id : "";
  const b = id ? await getCbbBoard(new Date(), 3, id).catch(() => null) : null;
  const x = b ? findCbbRow(b.days, id) : undefined;
  return (
    <main className={s.page}>
      <div className={s.wrap}>
        <Link href="/picks/cbb" className={s.linkA} style={{ fontSize: 14 }}>
          ‹ CBB picks
        </Link>
        {x ? <CbbGamePreview x={x} /> : <p className={s.calm}>That game isn&apos;t on the CBB board any more. Finished games are under Results.</p>}
      </div>
    </main>
  );
}
