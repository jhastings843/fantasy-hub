// Total value vs the S&P 500, both indexed to 100 on the first day. Server SVG,
// no client JavaScript. The portfolio is the solid ink line; the S&P is the
// dashed comparison; a dotted rule at 100 marks where both started. The SVG
// stretches to the column (non-scaling strokes), and every label is HTML so
// text stays the same size on a phone and a desktop.

type Pt = { x: number; y: number };

const W = 1000;
const H = 300;

const day = (x: number) => new Date(x).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const fmt = (v: number) => v.toFixed(1);

export function HistoryChart({ total, spx }: { total: Pt[]; spx: Pt[] }) {
  if (total.length < 2) return null;
  const all = [...total, ...spx];
  const x0 = Math.min(...all.map((p) => p.x));
  const x1 = Math.max(...all.map((p) => p.x));
  let y0 = Math.min(100, ...all.map((p) => p.y));
  let y1 = Math.max(100, ...all.map((p) => p.y));
  const span = y1 - y0 || 1;
  y0 -= span * 0.12;
  y1 += span * 0.12;
  const X = (x: number) => ((x - x0) / (x1 - x0 || 1)) * W;
  const Y = (y: number) => (1 - (y - y0) / (y1 - y0)) * H;
  const path = (pts: Pt[]) => pts.map((p, i) => `${i ? "L" : "M"}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join("");
  const last = total[total.length - 1];
  const lastS = spx.length >= 2 ? spx[spx.length - 1] : null;
  const up = last.y >= 100;

  return (
    <figure className="m-0 flex flex-col gap-2">
      <div className="relative h-[160px] w-full sm:h-[200px]">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={`Your total ${fmt(last.y)} and S&P 500 ${lastS ? fmt(lastS.y) : "n/a"}, both starting at 100 on ${day(x0)}`}
          className="absolute inset-0 block h-full w-full overflow-visible"
        >
          <line x1={0} x2={W} y1={Y(100)} y2={Y(100)} stroke="var(--hh-rule)" strokeWidth="1" strokeDasharray="2 4" opacity="0.6" vectorEffect="non-scaling-stroke" />
          <path
            d={`${path(total)}L${X(last.x).toFixed(1)},${Y(100).toFixed(1)}L${X(total[0].x).toFixed(1)},${Y(100).toFixed(1)}Z`}
            fill={up ? "var(--hh-pos)" : "var(--hh-neg)"}
            opacity="0.1"
          />
          {lastS && <path d={path(spx)} fill="none" stroke="var(--hh-muted)" strokeWidth="1.5" strokeDasharray="5 4" vectorEffect="non-scaling-stroke" />}
          <path d={path(total)} fill="none" stroke="var(--hh-ink)" strokeWidth="2.25" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        </svg>
        <span
          aria-hidden
          className="absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-hh-bg bg-hh-accent"
          style={{ left: `${(X(last.x) / W) * 100}%`, top: `${(Y(last.y) / H) * 100}%` }}
        />
      </div>
      <div aria-hidden className="flex justify-between text-[11px] text-hh-muted">
        <span className="hh-num">{day(x0)}</span>
        <span className="hh-num">{day(x1)}</span>
      </div>
      <figcaption className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-hh-ink-2">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="h-[3px] w-3.5 rounded-sm bg-hh-ink" />
          Your total <span className="hh-num font-semibold text-hh-ink">{fmt(last.y)}</span>
        </span>
        {lastS && (
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="w-3.5 border-t-2 border-dashed border-hh-muted" />
            S&amp;P 500 <span className="hh-num font-semibold text-hh-ink">{fmt(lastS.y)}</span>
          </span>
        )}
        <span className="text-hh-muted">Both start at 100</span>
      </figcaption>
    </figure>
  );
}
