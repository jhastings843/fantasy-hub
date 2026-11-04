// Small charts for Hobby Hub (dataviz rules: one series, no legend, 2px line,
// recessive baseline, text in ink not series colour, every chart labelled for
// screen readers and every point carries its value on hover). Server-safe SVG.

/** Running total over time (units by week, bankroll). Area to the zero line, a dot on the latest value. */
export function Sparkline({
  values,
  labels,
  width = 160,
  height = 44,
  label,
  format = (v: number) => v.toFixed(2),
}: {
  values: number[];
  /** One per value, for the hover title ("Week 6"). */
  labels?: string[];
  width?: number;
  height?: number;
  /** What the line shows, read aloud: "Units by week". */
  label: string;
  format?: (v: number) => string;
}) {
  if (values.length < 2) {
    return (
      <svg width={width} height={height} role="img" aria-label={`${label}: not enough weeks to draw yet`} className="max-w-full">
        <line x1="0" x2={width} y1={height / 2} y2={height / 2} stroke="var(--hh-line)" strokeDasharray="3 4" />
      </svg>
    );
  }
  const pad = 4;
  const lo = Math.min(0, ...values);
  const hi = Math.max(0, ...values);
  const span = hi - lo || 1;
  const x = (i: number) => pad + (i * (width - pad * 2)) / (values.length - 1);
  const y = (v: number) => pad + ((hi - v) * (height - pad * 2)) / span;
  const pts = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  const zero = y(0);
  const last = values[values.length - 1];
  const tone = last >= 0 ? "var(--hh-pos)" : "var(--hh-neg)";
  return (
    <span className="relative inline-block max-w-full">
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      role="img"
      aria-label={`${label}, from ${format(values[0])} to ${format(last)} over ${values.length} points`}
      className="max-w-full overflow-visible"
    >
      <line x1={pad} x2={width - pad} y1={zero} y2={zero} stroke="var(--hh-line)" strokeWidth="1" />
      <polygon points={`${x(0)},${zero} ${pts.join(" ")} ${x(values.length - 1)},${zero}`} fill={tone} opacity="0.12" />
      <polyline points={pts.join(" ")} fill="none" stroke="var(--hh-ink)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(values.length - 1)} cy={y(last)} r="3.5" fill="var(--hh-accent)" stroke="var(--hh-bg)" strokeWidth="2" />
      {values.map((v, i) => (
        // Hit targets wider than the mark: a full-height strip per point.
        <rect key={i} x={x(i) - (width - pad * 2) / (values.length - 1) / 2} y="0" width={(width - pad * 2) / (values.length - 1)} height={height} fill="transparent">
          <title>{`${labels?.[i] ?? `Point ${i + 1}`}: ${format(v)}`}</title>
        </rect>
      ))}
    </svg>
      <span className="sr-only">
        {values.map((v, i) => `${labels?.[i] ?? `Point ${i + 1}`}: ${format(v)}`).join(". ")}
      </span>
    </span>
  );
}

/** A chance from 0 to 1 (cover chance, win chance). Rust in light, teal gradient in dark; a tick at 50%. */
export function Meter({ value, label, showValue = true }: { value: number; label: string; showValue?: boolean }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div className="flex flex-col gap-1.5">
      <div
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
        aria-label={label}
        className="relative h-2 overflow-hidden rounded-[2px] bg-[var(--hh-track)]"
      >
        <div className="hh-meter-fill absolute inset-y-0 left-0 rounded-r-[2px]" style={{ width: `${pct}%`, background: "var(--hh-meter)" }} />
        <span aria-hidden className="absolute inset-y-0 left-1/2 w-px bg-hh-bg" />
      </div>
      {showValue && (
        <div className="flex justify-between text-xs text-hh-muted">
          <span>{label}</span>
          <span className="hh-num text-hh-ink">{`${Math.round(pct)}%`}</span>
        </div>
      )}
    </div>
  );
}

/**
 * An edge, centred on zero: positive grows right in the win colour, negative
 * grows left in the loss colour. `max` sets the scale so rows compare.
 */
export function EdgeBar({ value, max, label, format = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(1)}`, showValue = true, className = "w-20 sm:w-24" }: { value: number; max: number; label: string; format?: (v: number) => string; /** False when the number sits in its own column. */ showValue?: boolean; /** Track width. */ className?: string }) {
  const w = Math.min(1, Math.abs(value) / (max || 1)) * 50;
  const pos = value >= 0;
  return (
    <div className="flex items-center gap-2" title={`${label}: ${format(value)}`}>
      <div role="img" aria-label={`${label}: ${format(value)}`} className={`relative h-2 shrink-0 ${className}`}>
        <span aria-hidden className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-hh-rule" />
        <span
          aria-hidden
          className="absolute inset-y-0 rounded-[2px]"
          style={{ left: pos ? "50%" : `${50 - w}%`, width: `${w}%`, background: pos ? "var(--hh-pos)" : "var(--hh-neg)" }}
        />
      </div>
      {showValue && <span className={`hh-num w-12 text-right text-sm ${pos ? "text-hh-pos" : "text-hh-neg"}`}>{format(value)}</span>}
    </div>
  );
}
