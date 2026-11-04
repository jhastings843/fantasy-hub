import { Chip, Disclosure, Num, Section, Spotlight } from "@/components/hh/ui";
import { TeamEdge } from "@/components/hh/team";
import { buildWaivers } from "@/lib/waivers/build";
import type { SeasonTarget, StartableTarget, WaiverPlayer } from "@/lib/waivers/rank";
import { usageText } from "@/lib/waivers/freshness";

export const dynamic = "force-dynamic";

// Who to claim, and what it costs.
//
// Two questions, kept apart on the page because they have different answers and
// different deadlines. "Who would start for me on Sunday" is usually nobody.
// "Who is worth a roster spot" usually has an answer. A page that merged them
// would bury the second behind the emptiness of the first.

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold uppercase tracking-wider text-hh-muted ">
      {children}
    </p>
  );
}


function seasonChip(p: WaiverPlayer) {
  if (p.seasonRank === null) return <Chip tone="neg">unranked</Chip>;
  return (
    <>
      <Chip tone="gold">#{p.seasonRank}</Chip>
      {p.seasonPositionRank && <Chip>{p.seasonPositionRank}</Chip>}
      {p.tier && <Chip>{p.tier}</Chip>}
    </>
  );
}

function ResearchLine({ p }: { p: WaiverPlayer }) {
  if (!p.research) return null;
  return (
    <p className="mt-1.5 text-xs leading-relaxed text-hh-ink-2 ">
      <Chip tone="gold">
        {p.research.faabPercent != null ? `Consensus ${p.research.faabPercent}%` : "Consensus pick"}
      </Chip>{" "}
      {p.research.note}
    </p>
  );
}

function JinglesLine({ p }: { p: WaiverPlayer }) {
  if (!p.jingles) return null;
  const { rank, faab, faabPercent, budget, note } = p.jingles;
  // His dollars and the percent they represent. The dollars are what he wrote
  // and the percent is what carries into a league with a different budget, and
  // showing only one of them makes a reader do the conversion he already did.
  const bid = `$${faab} of $${budget}`;
  return (
    <p className="mt-1.5 text-xs leading-relaxed text-hh-ink-2 ">
      <Chip tone="accent">
        Jingles{rank !== null ? ` #${rank}` : ""} {bid} ({Math.round(faabPercent)}%)
      </Chip>{" "}
      {note}
    </p>
  );
}

function UsageLine({ p }: { p: WaiverPlayer }) {
  if (!p.lastWeek) return null;
  const quiet = p.lastWeek.snaps < 10 && !p.onBye;
  return (
    <p className={`mt-1 text-xs ${quiet ? "text-hh-neg " : "text-hh-muted "}`}>
      {usageText(p.lastWeek)}
      {quiet ? ". Barely played." : ""}
    </p>
  );
}

function matchupText(p: WaiverPlayer): string {
  if (!p.opponent) return "";
  return `${p.home ? "vs" : "@"} ${p.opponent}`;
}

function BidLine({ price }: { price: StartableTarget["price"] }) {
  if (!price) return null;
  return (
    <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <span className="text-sm tabular-nums">
        <span className="text-hh-muted ">Bid </span>
        <span className="font-semibold text-hh-ink ">${price.bid}</span>
        {price.walkAway > price.bid ? (
          <span className="text-hh-muted ">, stop at ${price.walkAway}</span>
        ) : null}
      </span>
      <Chip tone={price.tier === "winner" || price.tier === "starter" ? "accent" : "muted"}>
        {price.tierLabel}
      </Chip>
      {price.longShot ? <Chip tone="neg">likely loses at ${price.marketExpected}</Chip> : null}
    </div>
  );
}

function StartRow({ t }: { t: StartableTarget }) {
  return (
    <div className="border-b border-hh-line py-4">
      <div className="flex flex-wrap items-center gap-2">
        <Chip tone="accent">{t.slot}</Chip>
        <span className="font-medium text-hh-ink ">{t.player.name}</span>
        <Chip>{t.player.position}</Chip>
        {t.player.flexRank !== null ? (
          <Chip>FLEX {t.player.flexRank}</Chip>
        ) : t.player.positionalRank !== null ? (
          <Chip>
            {t.player.position} {t.player.positionalRank}
          </Chip>
        ) : null}
        <span className="text-sm text-hh-muted ">
          {matchupText(t.player)}
        </span>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-hh-ink-2 ">
        Would start at {t.slot} this week
        {t.displaces ? `, ahead of ${t.displaces.name}` : ""}.
      </p>
      <ResearchLine p={t.player} />
      <JinglesLine p={t.player} />
      <UsageLine p={t.player} />
      <BidLine price={t.price} />
      {t.price ? (
        <p className="mt-1.5 text-xs leading-relaxed text-hh-muted ">
          {t.price.reason}
        </p>
      ) : null}
    </div>
  );
}

function SeasonRow({ t }: { t: SeasonTarget }) {
  return (
    <div className="flex flex-col gap-1.5 px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-hh-ink ">{t.player.name}</span>
          <Chip>{t.player.position}</Chip>
          {seasonChip(t.player)}
        </div>
        <p className="mt-1 text-sm leading-relaxed text-hh-muted ">
          {t.dropFor ? (
            <>
              Drop <span className="font-medium text-hh-ink-2 ">{t.dropFor.name}</span>
              {t.dropFor.seasonRank !== null ? ` (#${t.dropFor.seasonRank})` : " (unranked)"}
              {t.placesBetter !== null ? `, ${t.placesBetter} places better` : ""}.
            </>
          ) : (
            "You have a free roster spot, so this one costs nothing."
          )}
        </p>
        {t.why ? (
          <p className="text-sm leading-relaxed text-hh-muted ">
            His weekly list: {t.why}.
          </p>
        ) : null}
        <ResearchLine p={t.player} />
        <JinglesLine p={t.player} />
        <UsageLine p={t.player} />
        <BidLine price={t.price} />
        {t.price ? (
          <p className="mt-1 text-xs leading-relaxed text-hh-muted ">
            {t.price.reason}
          </p>
        ) : null}
        {t.alternative ? (
          <p className="mt-1 text-sm leading-relaxed text-hh-muted ">
            Or <span className="font-medium text-hh-ink-2 ">{t.alternative.name}</span>
            {t.alternative.jingles
              ? `, his waiver pick${t.alternative.jingles.rank != null ? ` #${t.alternative.jingles.rank}` : ""} at $${t.alternative.jingles.faab} of $${t.alternative.jingles.budget}`
              : ""}
            .
          </p>
        ) : null}
      </div>
    </div>
  );
}

export default async function WaiversPage({
  params,
}: {
  params: Promise<{ leagueId: string }>;
}) {
  const { leagueId } = await params;
  const w = await buildWaivers(leagueId);
  const { startable, seasonUpgrades, dropCandidates } = w.report;

  return (
    <main className="mx-auto max-w-5xl min-w-0 break-words text-hh-ink px-4 py-8 sm:px-6 lg:px-8">
      <Eyebrow>{w.week ? `Week ${w.week}` : "Waivers"}</Eyebrow>
      <h1 className="mt-1 text-3xl font-semibold tracking-tight sm:text-4xl">
        {startable.length > 0
          ? `${startable.length} on the wire would start for you.`
          : seasonUpgrades.length > 0
            ? "Nothing to start, one worth holding."
            : "Nothing worth claiming."}
      </h1>
      <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-hh-ink-2 ">
        {startable.length > 0
          ? "These would crack this week's lineup, which is the rare case. Everything below is the longer game."
          : seasonUpgrades.length > 0
            ? "Nobody unowned improves this week's lineup. These are worth a roster spot for the rest of the season."
            : "Nobody unowned improves this week's lineup, and nobody he ranks beats what you already have."}
      </p>

      {(w.budgetLeft !== null || w.freeAgentCount > 0) && (
        <div className="mt-5 flex flex-wrap gap-x-6 gap-y-2 text-sm text-hh-ink-2 ">
          {w.budgetLeft !== null && (
            <span className="tabular-nums">
              <span className="font-semibold text-hh-ink ">
                ${w.budgetLeft}
              </span>{" "}
              FAAB left{w.budgetTotal !== null ? ` of $${w.budgetTotal}` : ""}
            </span>
          )}
          <span className="tabular-nums">
            <span className="font-semibold text-hh-ink ">
              {w.freeAgentCount}
            </span>{" "}
            of his ranked players unowned
          </span>
        </div>
      )}

      {w.pacing ? (
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-hh-ink-2 ">
          {w.pacing.note}
        </p>
      ) : null}

      {w.source.note && (
        <div className="mt-6 max-w-2xl text-sm leading-relaxed text-hh-ink-2  border-b border-hh-line py-4">
          {w.source.note}
        </div>
      )}

      {w.blocked && (
        <div className="mt-6 max-w-2xl text-sm leading-relaxed text-hh-ink-2  border-b border-hh-line py-4">
          {w.blocked}
        </div>
      )}

      {startable.length > 0 && (
        <div className="mt-8">
          <Eyebrow>Would start this week</Eyebrow>
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            {startable.map((t) => (
              <StartRow key={t.player.playerId} t={t} />
            ))}
          </div>
        </div>
      )}

      {seasonUpgrades.length > 0 && (
        <div className="mt-8">
          <Eyebrow>{w.source.fresh ? "Worth a claim for the season" : w.source.label}</Eyebrow>
          <div className="mt-3 overflow-hidden border-b border-hh-line py-4">
            <div className="divide-y divide-hh-line ">
              {seasonUpgrades.map((t) => (
                <SeasonRow key={t.player.playerId} t={t} />
              ))}
            </div>
          </div>
        </div>
      )}

      {dropCandidates.length > 0 && (
        <div className="mt-8">
          <Eyebrow>Droppable, worst first</Eyebrow>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-hh-muted ">
            Anyone this week&rsquo;s lineup depends on is left out of this list, however poor
            their season rank. A fill-in who is actually starting on Sunday is worth more than a
            better player you cannot start.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {dropCandidates.map((d) => (
              <span
                key={d.playerId}
                className="inline-flex items-center gap-2 rounded-full border border-zinc-200 px-3 py-1.5 text-sm "
              >
                <span className="text-hh-ink ">{d.name}</span>
                <span className="text-xs text-hh-muted ">
                  {d.seasonRank !== null ? `#${d.seasonRank}` : "unranked"}
                </span>
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="mt-10 max-w-2xl space-y-2 text-xs leading-relaxed text-hh-muted ">
        <p>
          This week from {w.listTitle ?? "his weekly rankings"}
          {w.listUpdatedLabel ? `, last updated ${w.listUpdatedLabel}` : ""}. Season-long from{" "}
          {w.seasonListTitle}.
        </p>
        {!w.seasonListMatchesScoring && (
          <p>
            That season list is for different scoring than this league, so treat the ranks as
            indicative rather than exact.
          </p>
        )}
      </div>
    </main>
  );
}
