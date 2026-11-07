import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { canSeePortfolio } from "@/lib/portfolio/lock";
import { loadStatus } from "@/lib/status/load";
import { ago, GROUP_ORDER, type Health, type StatusRow } from "@/lib/status/core";
import { Chip, Empty, Num, PageHead, Section, type Tone } from "@/components/hh/ui";

// Every scheduled job, when it last ran and whether it worked (UX pass,
// 2026-11-06). Open to read, like /api/health. Error text can carry upstream
// hostnames, so it shows only on an unlocked device (security audit, 2026-11-04).

export const metadata: Metadata = { title: "Status · Hobby Hub", robots: { index: false } };
export const dynamic = "force-dynamic";

const HEALTH: Record<Health, { tone: Tone; label: string }> = {
  failing: { tone: "neg", label: "Failing" },
  quiet: { tone: "gold", label: "Not running" },
  unknown: { tone: "muted", label: "No time yet" },
  ok: { tone: "pos", label: "OK" },
};

const BLURB: Record<string, string> = {
  "Every hour": "Jobs the pulse runs every 15 minutes on game days, hourly otherwise.",
  "Captures and models": "Line, prop and model captures run by GitHub on their own schedules.",
  "Outside sources": "Reading other people's models: Harris, Sam, Jingles.",
  Emails: "What the last pulse decided about each scheduled email.",
  "From the Mac": "Exports your Mac posts on its own schedule.",
};

function JobRow({ r, now, unlocked }: { r: StatusRow; now: Date; unlocked: boolean }) {
  const h = HEALTH[r.health];
  const when = ago(r.at, now);
  const lastOk = r.health === "failing" ? ago(r.okAt, now) : null;
  return (
    <li className="flex min-w-0 flex-col gap-1 border-b border-hh-line py-3 last:border-b-0">
      <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="min-w-0 break-words font-semibold">{r.name}</span>
        <Chip tone={h.tone}>{h.label}</Chip>
      </div>
      <Num className="flex flex-wrap gap-x-2 text-xs text-hh-muted">
        <span>{when ? `Last ran ${when}` : "Run time not recorded yet (starts with the next run)"}</span>
        {r.health === "failing" && (
          <>
            <span aria-hidden>·</span>
            <span className="text-hh-neg">{r.streak} run{r.streak === 1 ? "" : "s"} in a row</span>
            <span aria-hidden>·</span>
            <span>{lastOk ? `last worked ${lastOk}` : "last clean run not recorded yet"}</span>
          </>
        )}
      </Num>
      {r.error && unlocked && <p className="break-words font-mono text-xs text-hh-ink-2">{r.error}</p>}
    </li>
  );
}

export default async function StatusPage() {
  const now = new Date();
  const [view, unlocked] = await Promise.all([
    loadStatus(now),
    (async () =>
      canSeePortfolio({
        secret: process.env.HH_SESSION_SECRET,
        token: (await cookies()).get(SESSION_COOKIE)?.value,
        nodeEnv: process.env.NODE_ENV,
      }))(),
  ]);
  const failing = view.rows.filter((r) => r.health === "failing").length;
  const pulseAgo = ago(view.pulse?.at, now);
  const pulseMin = view.pulse ? (now.getTime() - Date.parse(view.pulse.at)) / 60_000 : null;
  // Failing jobs lead the page in their own section instead of sitting in their group.
  const failingRows = view.rows.filter((r) => r.health === "failing");
  const groups = GROUP_ORDER.map((g) => ({ g, rows: view.rows.filter((r) => r.group === g && r.health !== "failing") })).filter((x) => x.rows.length);

  return (
    <main className="mx-auto flex w-full min-w-0 max-w-3xl flex-col gap-10 px-4 py-8 text-hh-ink sm:px-6 lg:px-8 lg:py-12">
      <PageHead
        title="Status"
        sub={
          failing ? (
            <>
              <Num tone="neg">{failing}</Num> job{failing === 1 ? " is" : "s are"} failing. Everything else ran clean on its last try.
            </>
          ) : (
            "Every job ran clean on its last try."
          )
        }
        aside={
          pulseAgo ? (
            <span className={pulseMin !== null && pulseMin > 90 ? "font-semibold text-hh-neg" : undefined}>
              Pulse last ran {pulseAgo} ({view.pulse!.tier})
            </span>
          ) : (
            "No pulse on record"
          )
        }
      />

      {!unlocked && failing > 0 && (
        <p className="text-sm text-hh-muted">
          Error details show on an unlocked device.{" "}
          <Link href="/unlock" className="font-semibold text-hh-accent-ink underline-offset-2 hover:underline">
            Unlock
          </Link>
        </p>
      )}

      {view.problems.length > 0 && <p className="text-sm text-hh-neg">Some of this page could not be read just now.</p>}

      {failingRows.length > 0 && (
        <Section label="Failing now" aside={<Num tone="neg">{failingRows.length}</Num>}>
          <ul>
            {failingRows.map((r) => (
              <JobRow key={r.key} r={{ ...r, name: `${r.name} (${r.group.toLowerCase()})` }} now={now} unlocked={unlocked} />
            ))}
          </ul>
        </Section>
      )}

      {groups.length === 0 && failingRows.length === 0 && <Empty>No job has reported yet.</Empty>}

      {groups.map(({ g, rows }) => {
        const good = rows.filter((r) => r.health === "ok").length;
        return (
          <Section key={g} label={g} aside={<Num>{`${good} of ${rows.length} ok`}</Num>}>
            <p className="mb-1 max-w-2xl text-sm leading-relaxed text-hh-ink-2">{BLURB[g]}</p>
            <ul>
              {rows.map((r) => (
                <JobRow key={r.key} r={r} now={now} unlocked={unlocked} />
              ))}
            </ul>
          </Section>
        );
      })}

      <p className="text-xs leading-relaxed text-hh-muted">
        A job that fails three runs in a row also sends a phone alert once, and again only after it has had a clean run.
      </p>
    </main>
  );
}
