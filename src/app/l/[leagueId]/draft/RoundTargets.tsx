import { PlayerAvatar } from "@/components/PlayerAvatar";
import { PlayerLink } from "@/components/PlayerLink";
import { PopLink } from "@/components/hh/PopLink";
import { Chip, Num } from "@/components/hh/ui";
import { teamHref } from "@/app/picks/hrefs";
import type { RookieRow } from "./RookieList";

interface UserPick {
  pickNo: number;
  round: number;
  slot: number;
  zone: string;
  label: string;
  value: number | null;
}

// Simple model for "who's likely available at pick X":
// assume rookies get drafted in roughly RA-value order, so the top
// (pickNo - 1) are likely gone. Show the next 12 candidates (some
// will be picked before your turn; the rest are realistic gets).
function targetsForPick(
  pick: UserPick,
  rookies: RookieRow[],
  windowSize = 12,
): RookieRow[] {
  const sorted = [...rookies].sort((a, b) => b.value - a.value);
  const start = Math.max(0, pick.pickNo - 1);
  return sorted.slice(start, start + windowSize);
}

function ordinal(n: number): string {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

function FlagChip({
  label,
  tone,
}: {
  label: string;
  tone: "buy" | "sell" | "break";
}) {
  return <Chip tone={tone === "buy" ? "pos" : tone === "sell" ? "neg" : "gold"}>{label}</Chip>;
}

function RookieRowItem({
  r,
  isFit,
  rank,
  pickValue,
}: {
  r: RookieRow;
  isFit: boolean;
  rank: number;
  pickValue: number | null;
}) {
  const surplus = pickValue != null ? r.value - pickValue : null;
  return (
    <li
      className="flex min-h-11 items-center gap-2.5 py-2"
    >
      <Num className="w-5 shrink-0 text-[11px] font-semibold text-hh-muted">{rank}</Num>
      <PlayerAvatar
        name={r.name}
        position={r.position ?? null}
        photoUrl={r.photoUrl}
        size="sm"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <PlayerLink
            id={r.id}
            name={r.name}
            className="truncate text-sm font-medium"
          />
          {isFit && (
            <Chip tone="accent">Fit</Chip>
          )}
          {r.buyLow && <FlagChip label="Buy" tone="buy" />}
          {r.sellHigh && <FlagChip label="Sell" tone="sell" />}
          {r.breakout && <FlagChip label="Break" tone="break" />}
        </div>
        <span className="text-[11px] text-hh-muted">
          {r.team ? <PopLink href={teamHref("nfl", r.team)}>{r.team}</PopLink> : "FA"}
          {[r.position, r.age ? `age ${r.age}` : null]
            .filter(Boolean)
            .map((x) => ` · ${x}`)
            .join("")}
        </span>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-0.5">
        <Num className="text-sm font-semibold text-hh-ink">{r.value.toLocaleString()}</Num>
        {surplus != null && Math.abs(surplus) >= 100 && (
          <Num tone={surplus > 0 ? "pos" : "muted"} className="text-[10px] font-bold">
            {surplus > 0 ? "+" : ""}
            {surplus.toLocaleString()}
          </Num>
        )}
      </div>
    </li>
  );
}

function PickCard({
  pick,
  rookies,
  weakestPositions,
  isPast,
}: {
  pick: UserPick;
  rookies: RookieRow[];
  weakestPositions: string[];
  isPast: boolean;
}) {
  const targets = targetsForPick(pick, rookies);
  const fits = targets.filter(
    (r) => r.position && weakestPositions.includes(r.position),
  );
  const others = targets.filter(
    (r) => !r.position || !weakestPositions.includes(r.position),
  );

  return (
    <div className={`flex min-w-0 flex-col ${isPast ? "opacity-60" : ""}`}>
      <div className="hh-ruled flex items-baseline justify-between gap-3 pb-1">
        <div className="flex items-baseline gap-2">
          <Num className="text-base font-bold text-hh-ink">
            {pick.round}.{pick.slot.toString().padStart(2, "0")}
          </Num>
          <span className="hh-label">
            {pick.zone.charAt(0).toUpperCase() + pick.zone.slice(1)}{" "}
            {ordinal(pick.round)}
          </span>
        </div>
        <span className="text-xs text-hh-muted">
          pick value{" "}
          <Num className="font-semibold text-hh-accent-ink">
            {pick.value != null ? pick.value.toLocaleString() : "n/a"}
          </Num>
        </span>
      </div>

      {targets.length === 0 ? (
        <p className="py-3 text-sm text-hh-muted">
          No targets available: the pool is empty.
        </p>
      ) : (
        <>
          {fits.length > 0 && (
            <div>
              <div className="pt-2 text-[10px] font-bold uppercase tracking-wider text-hh-accent-ink">
                Position fits ({weakestPositions.join(" / ")})
              </div>
              <ul className="flex flex-col divide-y divide-hh-line">
                {fits.slice(0, 5).map((r) => (
                  <RookieRowItem
                    key={r.id}
                    r={r}
                    isFit
                    rank={r.rank}
                    pickValue={pick.value}
                  />
                ))}
              </ul>
            </div>
          )}
          {others.length > 0 && (
            <div>
              <div className="pt-2 text-[10px] font-bold uppercase tracking-wider text-hh-muted">
                Best available
              </div>
              <ul className="flex flex-col divide-y divide-hh-line">
                {others.slice(0, 8).map((r) => (
                  <RookieRowItem
                    key={r.id}
                    r={r}
                    isFit={false}
                    rank={r.rank}
                    pickValue={pick.value}
                  />
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function RoundTargets({
  userPicks,
  rookies,
  weakestPositions,
  draftedPickNos = [],
}: {
  userPicks: UserPick[];
  rookies: RookieRow[];
  weakestPositions: string[];
  draftedPickNos?: number[];
}) {
  if (userPicks.length === 0) return null;
  const draftedSet = new Set(draftedPickNos);
  return (
    <section className="flex flex-col gap-3">
      <header className="flex flex-col gap-1">
        <h2 className="hh-label">Round-by-round targets</h2>
        <p className="text-xs text-hh-muted">
          Realistic gets at each of your picks, ranked by RosterAudit value.
          Weak-position rookies tagged{" "}
          <Chip tone="accent">Fit</Chip>
          . Updates as the draft progresses.
        </p>
      </header>
      <div className="grid gap-x-8 gap-y-6 lg:grid-cols-2">
        {userPicks.map((pick) => (
          <PickCard
            key={pick.pickNo}
            pick={pick}
            rookies={rookies}
            weakestPositions={weakestPositions}
            isPast={draftedSet.has(pick.pickNo)}
          />
        ))}
      </div>
    </section>
  );
}
