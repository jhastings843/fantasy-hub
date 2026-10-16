import m from "./money.module.css";

// One small line chart, drawn as SVG on the server: no chart library, no
// client JavaScript. The first series is the subject (filled underneath); any
// others are comparisons (SPY), drawn thinner and dashed. A baseline (the
// starting bankroll, zero units) is a dotted rule so up and down read at once.

export interface Series {
  label: string;
  points: { x: number; y: number }[];
  tone?: "pos" | "neg" | "auto" | "mute";
}

const PAD = { l: 8, r: 62, t: 14, b: 26 };

export function LineChart({
  series,
  baseline,
  format,
  height = 220,
  width = 640,
  ariaLabel,
  empty = "Not enough history to draw yet.",
}: {
  series: Series[];
  baseline?: number;
  format: (y: number) => string;
  height?: number;
  /** The drawing's own width. Smaller in a narrow panel, so the labels stay readable when scaled. */
  width?: number;
  ariaLabel: string;
  empty?: string;
}) {
  const W = width;
  // Drawn in time order whatever order they arrived in.
  series = series.map((s) => ({ ...s, points: [...s.points].sort((a, b) => a.x - b.x) }));
  const all = series.flatMap((s) => s.points);
  if (all.length < 2) return <p className={m.chartEmpty}>{empty}</p>;
  const xs = all.map((p) => p.x);
  const ys = all.map((p) => p.y).concat(baseline !== undefined ? [baseline] : []);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  let y0 = Math.min(...ys);
  let y1 = Math.max(...ys);
  const span = y1 - y0 || Math.abs(y1) * 0.02 || 1;
  y0 -= span * 0.12;
  y1 += span * 0.12;
  const X = (x: number) => PAD.l + ((x - x0) / (x1 - x0 || 1)) * (W - PAD.l - PAD.r);
  const Y = (y: number) => PAD.t + (1 - (y - y0) / (y1 - y0)) * (height - PAD.t - PAD.b);
  const path = (pts: { x: number; y: number }[]) => pts.map((p, i) => `${i ? "L" : "M"}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join("");
  const main = series[0];
  const last = main.points[main.points.length - 1];
  const up = baseline !== undefined ? last.y >= baseline : last.y >= main.points[0].y;
  const tone = main.tone === "auto" || !main.tone ? (up ? "pos" : "neg") : main.tone;
  const day = (x: number) => new Date(x).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });
  const area = `${path(main.points)}L${X(last.x).toFixed(1)},${(height - PAD.b).toFixed(1)}L${X(main.points[0].x).toFixed(1)},${(height - PAD.b).toFixed(1)}Z`;

  return (
    <figure className={m.chart}>
      <svg viewBox={`0 0 ${W} ${height}`} role="img" aria-label={ariaLabel} className={m.svg} data-tone={tone}>
        {baseline !== undefined && (
          <>
            <line x1={PAD.l} x2={W - PAD.r} y1={Y(baseline)} y2={Y(baseline)} className={m.base} />
            {/* Dropped when it would sit on the end value's label. */}
            {Math.abs(Y(baseline) - Y(last.y)) > 14 && (
              <text x={W - PAD.r + 6} y={Y(baseline) + 4} className={m.axis}>{format(baseline)}</text>
            )}
          </>
        )}
        <path d={area} className={m.area} />
        {series.slice(1).map((s) => (
          <path key={s.label} d={path(s.points)} className={m.compare} />
        ))}
        <path d={path(main.points)} className={m.line} />
        <circle cx={X(last.x)} cy={Y(last.y)} r={4} className={m.dot} />
        <text x={W - PAD.r + 6} y={Y(last.y) + 4} className={m.endLabel}>{format(last.y)}</text>
        <text x={PAD.l} y={height - 6} className={m.axis}>{day(x0)}</text>
        <text x={W - PAD.r} y={height - 6} textAnchor="end" className={m.axis}>{day(x1)}</text>
      </svg>
      {series.length > 1 && (
        <figcaption className={m.legend}>
          {series.map((s, i) => (
            <span key={s.label} className={i ? m.legendCompare : m.legendMain} data-tone={i ? undefined : tone}>
              {s.label}
            </span>
          ))}
        </figcaption>
      )}
    </figure>
  );
}
