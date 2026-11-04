import type { TeamRisk } from "@/lib/guillotine/chop-line";
import { Num, Section } from "@/components/hh/ui";

// The signature element of this page.
//
// Every other way of showing "am I safe" reduces to a rank or a percentage,
// and both hide the thing that actually decides the week: how far your
// projection sits from the score that gets someone chopped.
//
// The first version drew a single line at the average low score, and it lied by
// omission. In a sixteen-team week that average sits far below every projection
// (it is the minimum of sixteen draws, and someone always busts), so every team
// appeared comfortably clear while carrying real risk. What the page draws now
// is the BAND the chop line actually lands in, and each team's floor rather
// than only its projection, because the chop is decided by bad weeks.

interface Props {
  teams: TeamRisk[];
  chopLine: number;
  range: [number, number];
}

export function ChopLine({ teams, chopLine, range }: Props) {
  if (teams.length === 0) return null;

  const [lineLow, lineHigh] = range;
  const values = [...teams.map((t) => t.projected), ...teams.map((t) => t.floor), lineLow, lineHigh];
  const low = Math.min(...values);
  const high = Math.max(...values);
  const pad = Math.max(4, (high - low) * 0.06);
  const min = low - pad;
  const max = high + pad;
  const span = max - min || 1;

  const position = (value: number) => ((value - min) / span) * 100;
  const mine = teams.find((t) => t.isMine);
  const atRisk = mine ? mine.floor <= lineHigh : false;

  return (
    <Section label="The chop line" aside={<><Num>{teams.length}</Num> alive</>}>

      <div className="relative mt-9 mb-3 h-24">
        {/* Where the low score usually lands. Everything inside is losing range. */}
        <div
          className="absolute top-3 bottom-6 rounded-sm bg-[var(--hh-neg-soft)] ring-1 ring-inset ring-[var(--hh-neg)]/40"
          style={{
            left: `${position(lineLow)}%`,
            width: `${Math.max(0.6, position(lineHigh) - position(lineLow))}%`,
          }}
          aria-hidden
        />
        <div
          className="absolute top-0 -translate-x-1/2 whitespace-nowrap rounded-[4px] bg-hh-neg px-2 py-0.5 text-[10px] font-semibold text-hh-bg"
          style={{ left: `${position((lineLow + lineHigh) / 2)}%` }}
        >
          line lands here
        </div>

        <div className="absolute inset-x-0 top-12 h-px bg-hh-line" />

        {teams.map((team) => {
          if (team.isMine) return null;
          return (
            <div key={team.rosterId}>
              {/* Projection, then a fainter mark at the floor it could fall to. */}
              <div
                className="absolute top-[2.625rem] h-2.5 w-0.5 -translate-x-1/2 rounded-full bg-hh-muted"
                style={{ left: `${position(team.projected)}%` }}
                title={`${team.name}: projects ${team.projected.toFixed(1)}, floor ${team.floor.toFixed(1)}`}
              />
              <div
                className="absolute top-[3.25rem] h-1.5 w-px -translate-x-1/2 bg-hh-muted opacity-50"
                style={{ left: `${position(team.floor)}%` }}
                aria-hidden
              />
            </div>
          );
        })}

        {mine ? (
          <>
            {/* The reach from your floor to your projection, drawn as one span. */}
            <div
              className="absolute top-[3.05rem] h-0.5 rounded-full bg-hh-accent opacity-40"
              style={{
                left: `${position(mine.floor)}%`,
                width: `${Math.max(0.4, position(mine.projected) - position(mine.floor))}%`,
              }}
              aria-hidden
            />
            <div
              className="absolute top-9 h-6 w-0.5 -translate-x-1/2 rounded-full bg-hh-accent"
              style={{ left: `${position(mine.projected)}%` }}
            />
            <div
              className="hh-num absolute top-[4.25rem] -translate-x-1/2 whitespace-nowrap text-[10px] font-semibold text-hh-accent-ink"
              style={{ left: `${position(mine.projected)}%` }}
            >
              You {mine.projected.toFixed(0)}
            </div>
            <div
              className="absolute top-[2.9rem] h-3 w-0.5 -translate-x-1/2 rounded-full bg-hh-accent opacity-50"
              style={{ left: `${position(mine.floor)}%` }}
              title={`Your floor: ${mine.floor.toFixed(1)}`}
            />
          </>
        ) : null}
      </div>

      <p className="text-sm leading-relaxed text-hh-ink-2">
        {mine ? (
          <>
            You project{" "}
<Num className="font-semibold text-hh-ink">{mine.projected.toFixed(1)}</Num>{" "}
            with a bad week around{" "}
<Num tone="accent" className="font-semibold">{mine.floor.toFixed(1)}</Num>
            . The low score usually lands between{" "}
<Num tone="neg" className="font-semibold">{lineLow.toFixed(0)}</Num>{" "}
            and{" "}
<Num tone="neg" className="font-semibold">{lineHigh.toFixed(0)}</Num>
            .{" "}
            {atRisk
              ? "Your floor reaches into that range, which is why the risk is real even though the projection looks comfortable."
              : "Your floor clears it, so only an unusual week puts you in danger."}
          </>
        ) : (
          "Your roster is not in this week's simulation."
        )}
      </p>

      <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-hh-muted">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-0.5 rounded-full bg-hh-muted" />
          projection
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-1.5 w-px bg-hh-muted opacity-50" />
          floor
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-[var(--hh-neg-soft)] ring-1 ring-inset ring-[var(--hh-neg)]/40" />
          where the line lands
        </span>
      </p>

      <p className="sr-only">
        Expected low score {chopLine.toFixed(1)} points.
      </p>
    </Section>
  );
}
