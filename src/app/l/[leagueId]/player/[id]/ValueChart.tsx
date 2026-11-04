// Pure SVG line chart for value history. No deps.

interface Point {
  date: string;
  value: number;
}

export function ValueChart({
  history,
  format,
}: {
  history: Array<{ date: string; sf: number; oneQb: number }>;
  format: "sf" | "oneQb";
}) {
  const points: Point[] = history
    .map((h) => ({
      date: h.date,
      value: format === "sf" ? h.sf : h.oneQb,
    }))
    .filter((p) => p.value > 0);

  if (points.length < 2) {
    return (
      <div className="flex h-32 items-center justify-center rounded-[4px] bg-hh-sunk text-xs text-hh-muted">
        Not enough history yet
      </div>
    );
  }

  const W = 800;
  const H = 200;
  const PAD = 16;
  const PAD_LEFT = 56;
  const PAD_BOTTOM = 22;
  const innerW = W - PAD_LEFT - PAD;
  const innerH = H - PAD - PAD_BOTTOM;

  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || max || 1;
  const padding = range * 0.12;
  const yMin = Math.max(0, min - padding);
  const yMax = max + padding;

  const xy = points.map((p, i) => {
    const x = PAD_LEFT + (i / (points.length - 1)) * innerW;
    const y = PAD + (1 - (p.value - yMin) / (yMax - yMin || 1)) * innerH;
    return { x, y, ...p };
  });

  const pathD = xy
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(" ");
  const areaD = `${pathD} L ${xy[xy.length - 1].x.toFixed(
    1,
  )} ${(PAD + innerH).toFixed(1)} L ${xy[0].x.toFixed(1)} ${(
    PAD + innerH
  ).toFixed(1)} Z`;

  // Y-axis ticks: 4 evenly spaced
  const tickCount = 4;
  const ticks = Array.from({ length: tickCount }, (_, i) => {
    const v = yMin + ((yMax - yMin) * (tickCount - 1 - i)) / (tickCount - 1);
    const y = PAD + (i / (tickCount - 1)) * innerH;
    return { v: Math.round(v), y };
  });

  // X-axis: first, middle, last labels
  const xLabels = [0, Math.floor(xy.length / 2), xy.length - 1].map((idx) => ({
    x: xy[idx].x,
    label: formatDateShort(xy[idx].date),
  }));

  const lastVal = xy[xy.length - 1].value;
  const firstVal = xy[0].value;
  const totalDelta = lastVal - firstVal;

  return (
    <div className="flex flex-col gap-2 text-hh-ink">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="hh-label">
          Value over time ({format === "sf" ? "Superflex" : "1QB"})
        </span>
        <span
          className={`text-sm font-semibold ${
            totalDelta > 0
              ? "text-hh-pos"
              : totalDelta < 0
                ? "text-hh-neg"
                : "text-hh-muted"
          }`}
        >
          <span className="hh-num">
            {totalDelta > 0 ? "+" : ""}
            {totalDelta.toLocaleString()}
          </span>{" "}
          since {formatDateShort(xy[0].date)}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-44 w-full" preserveAspectRatio="none">
        {/* Y grid lines + labels */}
        {ticks.map((t) => (
          <g key={t.v}>
            <line
              x1={PAD_LEFT}
              x2={W - PAD}
              y1={t.y}
              y2={t.y}
              stroke="currentColor"
              strokeOpacity={0.08}
            />
            <text
              x={PAD_LEFT - 6}
              y={t.y + 4}
              textAnchor="end"
              fontSize="11"
              fill="currentColor"
              fillOpacity={0.5}
            >
              {t.v.toLocaleString()}
            </text>
          </g>
        ))}
        {/* Area gradient fill */}
        <defs>
          <linearGradient id="valArea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--hh-accent)" stopOpacity={0.22} />
            <stop offset="100%" stopColor="var(--hh-accent)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <path d={areaD} fill="url(#valArea)" />
        {/* Line */}
        <path
          d={pathD}
          stroke="var(--hh-accent)"
          strokeWidth={2.5}
          fill="none"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {/* Last point dot */}
        <circle
          cx={xy[xy.length - 1].x}
          cy={xy[xy.length - 1].y}
          r={4}
          fill="var(--hh-accent)"
          stroke="var(--hh-bg)"
          strokeWidth={2}
        />
        {/* X axis labels */}
        {xLabels.map((l, i) => (
          <text
            key={i}
            x={l.x}
            y={H - 6}
            textAnchor="middle"
            fontSize="11"
            fill="currentColor"
            fillOpacity={0.5}
          >
            {l.label}
          </text>
        ))}
      </svg>
    </div>
  );
}

function formatDateShort(iso: string): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  return `${months[parseInt(m) - 1] ?? m} ${parseInt(d)}`;
}
