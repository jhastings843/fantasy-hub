import type { Metadata } from "next";
import Link from "next/link";
import type { BracketField } from "@/lib/models/cbb/bracket-types";
import { FIELD_FIXTURE } from "@/lib/models/cbb/field-fixture";
import { Background, PageHead } from "../../board";
import BracketView from "./BracketView";
import { parseQuery } from "./query";
import s from "../../picks.module.css";
import b from "./bracket.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Bracket Optimizer · Hobby Hub",
  description: "March Madness brackets built to win your pool: model odds against public picks, sized to your pool and its scoring.",
};

/**
 * The field: the lead's loader (field.ts) once it exists, else the frozen
 * projected field. turbopackOptional keeps the build green while field.ts is
 * missing; a missing module or a loader error falls back to the fixture.
 */
async function loadField(): Promise<BracketField> {
  try {
    const mod = await import(/* turbopackOptional: true */ "@/lib/models/cbb/field");
    const field = await mod.getBracketField();
    if (field?.teams?.length === 64) return field;
  } catch {
    // fall through to the fixture
  }
  return FIELD_FIXTURE;
}

const asOf = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

export default async function BracketPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const [field, q] = await Promise.all([loadField(), searchParams]);
  const season = `${field.season}-${String(field.season + 1).slice(2)}`;
  const publicNote = field.publicSource === "estimate" ? "public pick shares are an estimate until Yahoo and ESPN post theirs." : `public pick shares from ${field.publicSource === "yahoo" ? "Yahoo" : "ESPN"}.`;
  return (
    <main className={b.root}>
      <div className={s.wrap}>
        <div style={{ display: "grid", gap: 10 }}>
          <Link href="/picks/cbb" className={b.crumb}>
            <span aria-hidden>‹</span> CBB board
          </Link>
          <PageHead
            title="Bracket optimizer"
            sub="Most brackets are built to be right. This one is built to win your pool: model odds against what the public picks, sized to your pool and its scoring."
            asof={`${season}, ${field.source === "projected" ? "projected field" : "official bracket"}, ${asOf(field.asOf)}`}
          />
        </div>
        {field.source === "projected" ? (
          <p className={s.scope}>{`Projected field from today's ratings. The real bracket replaces this on Selection Sunday; ${publicNote}`}</p>
        ) : field.publicSource === "estimate" ? (
          <p className={s.scope}>{`The official bracket. Pick shares are an estimate until Yahoo and ESPN post theirs.`}</p>
        ) : null}
        <BracketView field={field} initial={parseQuery(q)} />
        <Background title="How this works">
          <p className={s.p}>
            The method is Rick Gehman&apos;s (RickRunGood): take the odds of each team reaching each round, set them against how often the public picks that team to get there, and spend your picks where the model is higher than the crowd. Build from the champion and Final Four backward, because that is where the points are. Stay close to chalk in small pools; in big ones, you need a believable champion that few others have.
          </p>
          <p className={s.p}>
            Here it is done by simulation. Win chances come from our college model&apos;s ratings: a team rated 5 points better wins a neutral-floor game about 67% of the time. We build about 40 brackets, one per likely champion at three levels of boldness, plus a few Final Four swaps. Then we play the tournament 2,000 times against 300 brackets drawn from the public&apos;s picks, and for each bracket count how often it would finish ahead of everyone in a pool your size. The page shows the one with the best expected payout.
          </p>
          <p className={s.p}>
            Public shares, until the real ones are posted, come from a model of how casual entries pick: they lean harder on favorites and top seeds than the odds justify. Chasing perfection picks the single most likely bracket instead, which is a good ticket for a perfect bracket and a poor one for a pool.
          </p>
        </Background>
      </div>
    </main>
  );
}
