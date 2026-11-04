import { PlayerAvatar } from "@/components/PlayerAvatar";
import { PlayerLink } from "@/components/PlayerLink";
import { PopLink } from "@/components/hh/PopLink";
import { Chip, Disclosure, Num, Section, Spotlight } from "@/components/hh/ui";
import { teamHref } from "@/app/picks/hrefs";
import type { Recommendation } from "@/lib/dynasty/draft-recommender";

// The draft page's one Spotlight: the top recommendation for the next pick.
// The rest sit below as hairline rows, each with its reasons behind "Why".

function RecLine({ rec, big = false }: { rec: Recommendation; big?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <Num className={`w-6 shrink-0 font-bold ${big ? "text-2xl text-hh-accent-ink" : "text-base text-hh-muted"}`}>{rec.rank}</Num>
      <PlayerAvatar name={rec.player.name} position={rec.player.position} photoUrl={rec.player.photoUrl} size={big ? "md" : "sm"} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <PlayerLink
            id={rec.player.id}
            name={rec.player.name}
            className={`truncate font-semibold text-hh-ink ${big ? "text-lg" : "text-base"}`}
          />
          {rec.isFit && <Chip tone="accent">Fit</Chip>}
          {rec.player.buyLow && <Chip tone="pos">Buy</Chip>}
          {rec.player.breakout && <Chip tone="gold">Break</Chip>}
          {rec.player.sellHigh && <Chip tone="neg">Risk</Chip>}
          {rec.consensus.level === "high" && (
            <span title={rec.consensus.note}>
              <Chip tone="pos">Consensus</Chip>
            </span>
          )}
          {rec.consensus.level === "split" && (
            <span title={rec.consensus.note}>
              <Chip>Split</Chip>
            </span>
          )}
        </div>
        <span className="text-xs text-hh-muted">
          {rec.player.team ? <PopLink href={teamHref("nfl", rec.player.team)}>{rec.player.team}</PopLink> : "FA"}
          {[rec.player.position, rec.player.age ? `age ${rec.player.age}` : null]
            .filter(Boolean)
            .map((x) => ` · ${x}`)
            .join("")}
          {" · "}
          <span className="font-semibold text-hh-ink-2">{rec.headline}</span>
        </span>
      </div>
      <div className="flex shrink-0 flex-col items-end">
        <Num className={`font-bold text-hh-ink ${big ? "text-xl" : "text-lg"}`}>{rec.player.value.toLocaleString()}</Num>
        {Math.abs(rec.surplus) >= 200 && (
          <span className={`text-[10px] font-bold ${rec.surplus > 0 ? "text-hh-pos" : "text-hh-neg"}`}>
            <Num>
              {rec.surplus > 0 ? "+" : ""}
              {rec.surplus.toLocaleString()}
            </Num>{" "}
            vs pick
          </span>
        )}
      </div>
    </div>
  );
}

function Why({ rec }: { rec: Recommendation }) {
  return (
    <Disclosure summary="Why this pick">
      <ul className="flex flex-col gap-1.5">
        {rec.reasoning.map((r, i) => (
          <li key={i} className="flex items-start gap-2 text-xs text-hh-ink-2">
            <span aria-hidden className="mt-1.5 size-1 shrink-0 rounded-full bg-hh-accent" />
            <span>{r}</span>
          </li>
        ))}
      </ul>
    </Disclosure>
  );
}

export function Recommendations({
  recommendations,
  nextPickLabel,
}: {
  recommendations: Recommendation[];
  nextPickLabel: string | null;
}) {
  if (recommendations.length === 0) return null;
  const [top, ...rest] = recommendations;
  const method = "Ranked by RosterAudit value + position fit + age, with KeepTradeCut as a consensus check.";

  return (
    <div className="flex flex-col gap-8">
      <Spotlight
        label={nextPickLabel ? `Take at your next pick (${nextPickLabel})` : "Top recommendation"}
        aside={nextPickLabel ? "if your pick was right now" : undefined}
      >
        <RecLine rec={top} big />
        <Why rec={top} />
      </Spotlight>
      {rest.length > 0 ? (
        <Section label="Also in range" aside={<span className="block max-w-[48ch]">{method}</span>}>
          <ol className="flex flex-col">
            {rest.map((rec) => (
              <li key={rec.player.id} className="border-b border-hh-line py-2.5 last:border-b-0">
                <RecLine rec={rec} />
                <Why rec={rec} />
              </li>
            ))}
          </ol>
        </Section>
      ) : (
        <p className="-mt-6 text-xs text-hh-muted">{method}</p>
      )}
    </div>
  );
}
