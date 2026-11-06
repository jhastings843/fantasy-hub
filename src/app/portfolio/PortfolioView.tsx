import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { Chip, Num, PageHead, Row, Section, Spotlight, type Tone } from "@/components/hh/ui";
import type { Action, CashStep, Idea, Move, PlanVsHold, Outlook, PortfolioSnapshot, SourceLink, TrackCall, TrackRecord, WatchItem } from "@/lib/portfolio/types";
import {
  capState,
  etTime,
  groupActions,
  groupHoldings,
  indexHistory,
  planSeries,
  liveActions,
  type LiveStatus,
  num,
  pct,
  pctSigned,
  shortDate,
  sign,
  sortIdeas,
  staleNotes,
  taxLine,
  usd,
  usdSigned,
} from "@/lib/portfolio/view";
import { HistoryChart } from "./HistoryChart";
import { PortfolioRefresh } from "./PortfolioRefresh";

// The unlocked Portfolio page. Server only: every number is already in the
// snapshot (from code on Jack's Mac); the advisor's outlook is a model estimate
// and says so on every row.

const STANCE: Record<string, { tone: Tone; label: string }> = {
  defensive: { tone: "gold", label: "Defensive" },
  neutral: { tone: "muted", label: "Neutral" },
  constructive: { tone: "pos", label: "Constructive" },
};
const CALL: Record<string, { tone: Tone; label: string }> = {
  up: { tone: "pos", label: "Up" },
  flat: { tone: "muted", label: "Flat" },
  down: { tone: "neg", label: "Down" },
};
const HORIZON: Record<string, string> = { days: "Next few days", weeks: "Next few weeks", months: "Next few months" };
const CONF: Record<string, string> = { low: "low confidence", med: "medium confidence", high: "high confidence" };
const CASH_STATUS: Record<string, Tone> = { waiting: "muted", "trigger hit": "accent", "backstop due": "gold" };
const WATCH_STATUS: Record<string, { tone: Tone; label: string }> = {
  warn: { tone: "neg", label: "Warning" },
  normal: { tone: "muted", label: "Normal" },
  calm: { tone: "pos", label: "Calm" },
};
const ACTION_TONE: Record<string, Tone | undefined> = { sell: "neg", buy: "pos", limit: "accent", wait: "gold", hold: undefined };

// A group that opens and closes (Jack, 2026-11-06: "make menus such as trades expandable").
// Native details/summary: works without JS, keyboard and screen readers included.
function Fold({ head, open = true, children }: { head: ReactNode; open?: boolean; children: ReactNode }) {
  return (
    <details className="group/fold flex flex-col" open={open}>
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-sm font-semibold text-hh-ink [&::-webkit-details-marker]:hidden">
        <ChevronRight size={15} strokeWidth={2.2} aria-hidden className="shrink-0 text-hh-muted transition-transform duration-200 group-open/fold:rotate-90" />
        {head}
      </summary>
      <div className="flex flex-col">{children}</div>
    </details>
  );
}

const safeUrl = (u: string | undefined) => (u && /^https?:\/\//i.test(u) ? u : undefined);

export function PortfolioView({ s }: { s: PortfolioSnapshot }) {
  const t = s.totals;
  const notes = staleNotes(s);
  const hist = indexHistory(s.history);
  const advisor = s.advisor ?? null;

  return (
    <>
      <PageHead
        title="Portfolio"
        aside={
          <span className="flex flex-col gap-2 sm:items-end">
            <PortfolioRefresh asOf={s.asOf} />
            <span className="flex flex-col gap-0.5 sm:items-end">
              <span>As of {etTime(s.asOf)}</span>
              {s.priceDate && <span>Closing prices from {shortDate(s.priceDate)}</span>}
            </span>
          </span>
        }
      />

      {/* The one number that matters first: what it's all worth, and today's move. */}
      <section aria-label="Total value" className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <span className="text-xs text-hh-muted">Total value</span>
          <Num className="text-[44px] font-semibold leading-none text-hh-ink sm:text-[56px]">{usd(t.total)}</Num>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[17px]">
            <Num tone={sign(t.dayChange)} className="font-semibold">
              {usdSigned(t.dayChange)}
            </Num>
            <Num tone={sign(t.dayChangePct)}>{pctSigned(t.dayChangePct, 2)}</Num>
            <span className="text-sm text-hh-muted">today</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-x-8 gap-y-3 border-t border-hh-line pt-3">
          <MiniStat label="Cash" value={usd(t.cash)} sub={`${pct(t.cashPct)} of total`} />
          {s.holdingsFrom && <MiniStat label="Holdings file" value={shortDate(s.holdingsFrom)} sub={s.holdingsFile} />}
        </div>
        {(t.estimatedTrades ?? 0) > 0 && (
          <p className="rounded-[6px] bg-[var(--hh-gold-soft)] px-3 py-2 text-sm leading-snug text-hh-ink">
            Includes {t.estimatedTrades} {t.estimatedTrades === 1 ? "trade" : "trades"} made after your last Fidelity file, priced at closing prices. An estimate until the next file.
          </p>
        )}
        {notes.length > 0 && (
          <ul className="flex flex-col gap-2">
            {notes.map((n) => (
              <li key={n} className="rounded-[6px] bg-[var(--hh-gold-soft)] px-3 py-2 text-sm leading-snug text-hh-ink">
                {n}
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="grid grid-cols-1 gap-x-10 gap-y-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,340px)]">
        <div className="flex min-w-0 flex-col gap-8">
          {advisor && <AdvisorBlock a={advisor} />}
          {s.moves && s.moves.length > 0 && <Trades moves={s.moves} at={s.movesAt} />}
          {advisor?.actions && advisor.actions.length > 0 && <Actions actions={advisor.actions} moves={s.moves} holdings={s.holdings} />}
          {advisor && sortIdeas(advisor.ideas).length > 0 && <Ideas ideas={sortIdeas(advisor.ideas)} />}
          <Holdings s={s} />
          {hist.total.length >= 2 && (
            <Section label="Value over time" aside={`${s.history?.length ?? 0} days`}>
              <HistoryChart total={hist.total} spx={hist.spx} />
            </Section>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-8">
          {s.planVsHold && (s.planVsHold.series?.length ?? 0) > 0 && <PlanVsHoldCard p={s.planVsHold} />}
          {s.cashPlan && s.cashPlan.length > 0 && <CashPlan steps={s.cashPlan} />}
          {s.market && <MarketStrip m={s.market} />}
          {(s.sleeve || s.employer) && <Limits s={s} />}
          {s.accounts && s.accounts.length > 0 && (
            <Section label="Accounts">
              {s.accounts.map((a) => (
                <Row key={a.name}>
                  <span className="text-[15px] text-hh-ink">{a.name}</span>
                  <span className="flex flex-col items-end">
                    <Num className="text-[15px] text-hh-ink">{usd(a.value)}</Num>
                    <Num tone={sign(a.dayChange)} className="text-xs">
                      {usdSigned(a.dayChange)}
                    </Num>
                  </span>
                </Row>
              ))}
            </Section>
          )}
          {s.calendar && s.calendar.length > 0 && (
            <Section label="Coming up">
              {s.calendar.map((c, i) => (
                <Row key={`${c.date}-${i}`} className="!justify-start">
                  <Num className="w-14 shrink-0 text-sm text-hh-muted">{shortDate(c.date)}</Num>
                  <span className="min-w-0 text-[15px] text-hh-ink">
                    {c.event}
                    {c.symbol && <span className="ml-2 text-xs font-semibold text-hh-muted">{c.symbol}</span>}
                  </span>
                </Row>
              ))}
            </Section>
          )}
          {s.watch && s.watch.length > 0 && <Watch items={s.watch} />}
          {s.trackRecord && (s.trackRecord.groups?.length ?? 0) > 0 && <Track r={s.trackRecord} />}
        </div>
      </div>

      {advisor && <Sources a={advisor} />}
      <p className="text-xs leading-relaxed text-hh-muted">
        {advisor?.disclaimer || "Research, not licensed financial advice. You place every order."} Outlook calls are estimates.
      </p>
    </>
  );
}

function MiniStat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-xs text-hh-muted">{label}</span>
      <Num className="text-[20px] font-semibold leading-tight text-hh-ink">{value}</Num>
      {sub && <span className="truncate text-xs text-hh-muted">{sub}</span>}
    </div>
  );
}

function AdvisorBlock({ a }: { a: NonNullable<PortfolioSnapshot["advisor"]> }) {
  const stance = a.stance ? STANCE[a.stance] ?? { tone: "muted" as Tone, label: a.stance } : null;
  return (
    <Spotlight label="Today's read" aside={stance && <Chip tone={stance.tone}>{stance.label}</Chip>}>
      <div className="flex flex-col gap-4">
        {a.headline && <p className="font-display text-[24px] font-bold leading-[1.1] text-hh-ink sm:text-[28px]">{a.headline}</p>}
        {a.summary && <p className="max-w-[68ch] text-[15px] leading-relaxed text-hh-ink-2">{a.summary}</p>}
        {a.outlook && a.outlook.length > 0 && (
          <div className="flex flex-col">
            {a.outlook.map((o, i) => (
              <OutlookRow key={`${o.horizon}-${i}`} o={o} />
            ))}
          </div>
        )}
        {a.changes && a.changes.length > 0 && (
          <div className="flex flex-col gap-1.5 border-t border-hh-line pt-3">
            <span className="text-xs font-semibold text-hh-muted">What changed</span>
            <ul className="flex list-disc flex-col gap-1 pl-5 text-sm leading-snug text-hh-ink-2 marker:text-hh-muted">
              {a.changes.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Spotlight>
  );
}

function OutlookRow({ o }: { o: Outlook }) {
  const call = o.call ? CALL[o.call] ?? { tone: "muted" as Tone, label: o.call } : null;
  return (
    <div className="flex flex-col gap-1 border-t border-hh-line py-3 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-hh-ink">{HORIZON[o.horizon] ?? o.horizon}</span>
        {call && <Chip tone={call.tone}>{call.label}</Chip>}
        {o.confidence && <span className="text-xs text-hh-muted">{CONF[o.confidence] ?? o.confidence}</span>}
        <span className="ml-auto text-[11px] font-semibold uppercase tracking-[0.06em] text-hh-muted">estimate</span>
      </div>
      {o.reason && <p className="text-sm leading-snug text-hh-ink-2">{o.reason}</p>}
      {o.signal && (
        <p className="text-xs leading-snug text-hh-muted">
          <span className="font-semibold">Watch:</span> {o.signal}
        </p>
      )}
    </div>
  );
}

const LIVE: Record<"held" | "todo", { label: string; tone: Tone }> = {
  todo: { label: "Do now", tone: "neg" },
  held: { label: "Held", tone: "gold" },
};

function Actions({ actions, moves, holdings }: { actions: Action[]; moves?: Move[]; holdings?: PortfolioSnapshot["holdings"] }) {
  // Last night's advice, minus what's already placed today (live from the monitor and the latest Fidelity file).
  const live = liveActions(actions, moves, holdings);
  const status = new Map(live.rows.map((r) => [r.a, r]));
  const groups = groupActions(live.rows.map((r) => r.a));
  return (
    <Section label="Moves" aside={live.placed ? `${live.placed} placed today, see Trades` : "You place every order"}>
      <div className="flex flex-col gap-1">
        {groups.map((g) => (
          <Fold
            key={g.kind}
            open={g.kind !== "hold"}
            head={
              <>
                <span
                  aria-hidden
                  className="size-2 rounded-[2px]"
                  style={{ background: ACTION_TONE[g.kind] ? `var(--hh-${ACTION_TONE[g.kind]})` : "var(--hh-muted)" }}
                />
                {g.label}
                <span className="text-xs font-normal text-hh-muted">{g.items.length}</span>
              </>
            }
          >
            {g.items.map((a, i) => (
              <ActionRow key={`${a.symbol}-${i}`} a={a} live={status.get(a)} />
            ))}
          </Fold>
        ))}
      </div>
    </Section>
  );
}

function ActionRow({ a, live }: { a: Action; live?: { status: LiveStatus; until?: string } }) {
  const tax = taxLine(a.tax);
  const chip = live?.status === "todo" || live?.status === "held" ? LIVE[live.status] : null;
  return (
    <div className="flex flex-col gap-1 border-b border-hh-line py-2.5 last:border-b-0">
      <div className="flex items-baseline justify-between gap-3">
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="font-semibold text-hh-ink">{a.symbol ?? "n/a"}</span>
          {chip && <Chip tone={chip.tone}>{live?.status === "held" && live.until ? `${chip.label} until ${shortDate(live.until)}` : chip.label}</Chip>}
          {a.detail && live?.status !== "held" && <span className="truncate text-sm text-hh-ink-2">{a.detail}</span>}
        </span>
        {typeof a.amount === "number" && <Num className="shrink-0 text-[15px] font-semibold text-hh-ink">{usd(a.amount)}</Num>}
      </div>
      {a.reason && <p className="text-sm leading-snug text-hh-ink-2">{a.reason}</p>}
      {(a.when || tax) && (
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-hh-muted">
          {a.when && <span>When: {/^\d{4}-\d{2}-\d{2}$/.test(a.when) ? shortDate(a.when) : a.when.replace(/\d{4}-\d{2}-\d{2}/g, (d) => shortDate(d))}</span>}
          {tax && <span className="font-semibold text-hh-ink-2">{tax}</span>}
        </div>
      )}
    </div>
  );
}

const IDEA_TYPE: Record<string, string> = { stock: "Stock", etf: "ETF", ipo: "IPO" };
const IDEA_FIT: Record<string, string> = { core: "Core", bet: "Bet" };

function Ideas({ ideas }: { ideas: Idea[] }) {
  return (
    <Section label="Ideas to consider" aside="Things you don't own yet">
      <div className="flex flex-col gap-2">
        {ideas.map((i, n) => (
          <IdeaRow key={`${i.symbol}-${n}`} i={i} />
        ))}
      </div>
    </Section>
  );
}

function IdeaRow({ i }: { i: Idea }) {
  const ready = i.status === "ready";
  const dropped = i.status === "dropped";
  const src = safeUrl(i.source);
  const box = ready
    ? "rounded-[6px] border border-hh-accent bg-hh-accent-soft/40 px-3 py-3"
    : `border-b border-hh-line py-3 last:border-b-0 ${dropped ? "opacity-60" : ""}`;
  return (
    <div className={`flex flex-col gap-1.5 ${box}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className={`font-semibold ${dropped ? "text-hh-muted line-through" : "text-hh-ink"}`}>{i.symbol}</span>
          {i.name && <span className="min-w-0 truncate text-sm text-hh-ink-2">{i.name}</span>}
        </div>
        {typeof i.size === "number" && <Num className="shrink-0 text-[15px] font-semibold text-hh-ink">{usd(i.size)}</Num>}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {ready && <Chip tone="accent">Ready</Chip>}
        {dropped && <Chip tone="muted">Dropped</Chip>}
        {i.status === "watching" && <Chip tone="muted">Watching</Chip>}
        {i.type && <Chip tone="muted">{IDEA_TYPE[i.type] ?? i.type}</Chip>}
        {i.fit && <span className="text-xs text-hh-muted">Fits: {IDEA_FIT[i.fit] ?? i.fit}</span>}
        {i.replaces && <span className="text-xs text-hh-muted">Would replace {i.replaces}</span>}
      </div>
      {i.thesis && <p className="text-sm leading-snug text-hh-ink-2">{i.thesis}</p>}
      {i.risk && (
        <p className="text-sm leading-snug text-hh-ink-2">
          <span className="font-semibold text-hh-ink">Risk:</span> {i.risk}
        </p>
      )}
      {(i.entry || src || i.added) && (
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-hh-muted">
          {i.entry && (
            <span>
              <span className="font-semibold">Buy when:</span> {i.entry}
            </span>
          )}
          {i.added && <span>Added {shortDate(i.added)}</span>}
          {src && (
            <a href={src} target="_blank" rel="noopener noreferrer nofollow" className="text-hh-accent-ink underline-offset-2 hover:underline">
              Source
            </a>
          )}
        </div>
      )}
    </div>
  );
}

function CashPlan({ steps }: { steps: CashStep[] }) {
  return (
    <Section label="Cash plan">
      {steps.map((c, i) => {
        const st = c.status ?? "waiting";
        const dist = c.distancePct;
        const distText =
          typeof dist !== "number"
            ? c.trigger_spx
              ? null
              : "No price trigger"
            : dist < 0
              ? `S&P ${pct(Math.abs(dist))} above the trigger`
              : "S&P at or past the trigger";
        return (
          <div key={`${c.label}-${i}`} className="flex flex-col gap-1 border-b border-hh-line py-2.5 last:border-b-0">
            <div className="flex items-start justify-between gap-3">
              <span className="min-w-0 text-[15px] leading-snug text-hh-ink">{c.label ?? c.buy ?? "Step"}</span>
              <Num className="shrink-0 text-[15px] font-semibold text-hh-ink">{usd(c.amount)}</Num>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-hh-muted">
              <Chip tone={CASH_STATUS[st] ?? "muted"}>{st.charAt(0).toUpperCase() + st.slice(1)}</Chip>
              {c.trigger_spx ? <span>Trigger S&amp;P <Num>{num(c.trigger_spx)}</Num></span> : null}
              {distText && <span>{distText}</span>}
              {c.backstop && <span>Backstop {shortDate(c.backstop)}</span>}
            </div>
          </div>
        );
      })}
    </Section>
  );
}

function MarketStrip({ m }: { m: NonNullable<PortfolioSnapshot["market"]> }) {
  const cells: { label: string; value: string; sub?: ReactNode }[] = [
    {
      label: "S&P 500",
      value: num(m.spx, 0),
      sub: (
        <>
          <Num tone={sign(m.spxDayPct)}>{pctSigned(m.spxDayPct, 2)}</Num>
          {typeof m.spxDrawdownPct === "number" && (
            <span className="block">
              <Num>{pctSigned(m.spxDrawdownPct)}</Num> from record
            </span>
          )}
        </>
      ),
    },
    { label: "Nasdaq 100", value: num(m.ndx, 0), sub: <Num tone={sign(m.ndxDayPct)}>{pctSigned(m.ndxDayPct, 2)}</Num> },
    { label: "VIX", value: num(m.vix, 1), sub: "Fear gauge" },
    { label: "10-year", value: typeof m.tenYear === "number" ? `${m.tenYear.toFixed(2)}%` : "n/a", sub: "Treasury yield" },
  ];
  return (
    <Section label="Market">
      <div className="grid grid-cols-2 gap-x-6 gap-y-4">
        {cells.map((c) => (
          <div key={c.label} className="flex min-w-0 flex-col gap-0.5">
            <span className="text-xs text-hh-muted">{c.label}</span>
            <Num className="text-[18px] font-semibold leading-tight text-hh-ink">{c.value}</Num>
            {c.sub && <span className="text-xs leading-snug text-hh-muted">{c.sub}</span>}
          </div>
        ))}
      </div>
    </Section>
  );
}

function CapMeter({ label, value, cap, note }: { label: string; value: number | null | undefined; cap: number | null | undefined; note?: ReactNode }) {
  const state = capState(value, cap);
  const v = typeof value === "number" ? value : 0;
  const c = typeof cap === "number" && cap > 0 ? cap : null;
  const scale = Math.max(c ? c * 1.5 : 10, v * 1.1, 1);
  const fill = state === "over" ? "var(--hh-neg)" : state === "near" ? "var(--hh-gold)" : "var(--hh-meter)";
  return (
    <div className="flex flex-col gap-1.5 py-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm text-hh-ink">{label}</span>
        <span className="text-sm">
          <Num tone={state === "over" ? "neg" : state === "near" ? "gold" : undefined} className="font-semibold text-hh-ink">
            {pct(value)}
          </Num>
          {c && <span className="text-xs text-hh-muted"> of {pct(c, 0)} cap</span>}
        </span>
      </div>
      <div
        role="meter"
        aria-valuemin={0}
        aria-valuemax={Math.round(scale)}
        aria-valuenow={Math.round(v * 10) / 10}
        aria-label={`${label}: ${pct(value)}${c ? ` of a ${pct(c, 0)} cap` : ""}`}
        className="relative h-2 rounded-[2px] bg-[var(--hh-track)]"
      >
        <div className="hh-meter-fill absolute inset-y-0 left-0 rounded-[2px]" style={{ width: `${Math.min(100, (v / scale) * 100)}%`, background: fill }} />
        {c && <span aria-hidden className="absolute -inset-y-1 w-0.5 bg-hh-ink" style={{ left: `${(c / scale) * 100}%` }} />}
      </div>
      {state === "over" && <span className="text-xs font-semibold text-hh-neg">Over the cap</span>}
      {note && <span className="text-xs leading-snug text-hh-muted">{note}</span>}
    </div>
  );
}

function Limits({ s }: { s: PortfolioSnapshot }) {
  return (
    <Section label="Limits">
      {s.sleeve && (
        <CapMeter
          label="Bets"
          value={s.sleeve.pct}
          cap={s.sleeve.capPct}
          note={
            <>
              <Num>{usd(s.sleeve.value)}</Num> of the total
              {s.sleeve.names && s.sleeve.names.length > 0 && <>: {s.sleeve.names.join(", ")}</>}
            </>
          }
        />
      )}
      {s.employer && (
        <CapMeter
          label="Nucor stock"
          value={s.employer.pctOfBrokerage}
          cap={s.employer.capPct}
          note={
            <>
              <Num>{usd(s.employer.value)}</Num>, share of the brokerage account
            </>
          }
        />
      )}
    </Section>
  );
}

function Holdings({ s }: { s: PortfolioSnapshot }) {
  const groups = groupHoldings(s.holdings);
  return (
    <Section label="Holdings" aside={`${s.holdings.length} positions`}>
      {groups.length === 0 ? (
        <p className="py-2 text-sm text-hh-muted">No positions in this snapshot.</p>
      ) : (
        <div className="flex flex-col gap-1">
          {groups.map((g) => (
            <Fold
              key={g.key}
              head={
                <>
                  {g.label}
                  <span className="text-xs font-normal text-hh-muted">{g.items.length}</span>
                  <span className="ml-auto text-xs font-normal text-hh-muted">
                    <Num className="text-hh-ink-2">{usd(g.value)}</Num>
                    {s.totals.total ? <> · <Num>{pct((g.value / s.totals.total) * 100)}</Num></> : null}
                  </span>
                </>
              }
            >
              {g.items.map((h, i) => (
                <div key={`${h.symbol}-${h.account}-${i}`} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 border-b border-hh-line py-2.5 last:border-b-0">
                  <span className="flex min-w-0 items-baseline gap-2">
                    <span className="font-semibold text-hh-ink">{h.symbol}</span>
                    {h.estimated && <Chip tone="gold">estimate</Chip>}
                    {h.account && <span className="truncate text-xs text-hh-muted">{h.account}</span>}
                  </span>
                  <Num className="text-right text-[15px] text-hh-ink">{usd(h.value)}</Num>
                  <span className="truncate text-xs text-hh-muted">
                    {typeof h.weight === "number" && <><Num>{pct(h.weight)}</Num> of total</>}
                    {h.name && <span className="hidden sm:inline"> · {h.name}</span>}
                  </span>
                  <span className="flex justify-end gap-3 text-xs">
                    <span title="Today">
                      <Num tone={sign(h.dayChange)}>{usdSigned(h.dayChange)}</Num>
                    </span>
                    {typeof h.gainLoss === "number" && (
                      <span title="Gain or loss since bought" className="text-hh-muted">
                        <Num tone={sign(h.gainLoss)}>{usdSigned(h.gainLoss)}</Num>
                        {typeof h.gainLossPct === "number" && <> (<Num tone={sign(h.gainLossPct)}>{pctSigned(h.gainLossPct)}</Num>)</>}
                      </span>
                    )}
                  </span>
                </div>
              ))}
            </Fold>
          ))}
          <p className="text-xs text-hh-muted">Each row: value, share of total, today&apos;s change, then gain or loss since bought.</p>
        </div>
      )}
    </Section>
  );
}

function Watch({ items }: { items: WatchItem[] }) {
  return (
    <Section label="Watch list">
      {items.map((w, i) => {
        const st = WATCH_STATUS[w.status ?? ""] ?? { tone: "muted" as Tone, label: w.status ?? "n/a" };
        return (
          <div key={`${w.signal}-${i}`} className="flex flex-col gap-0.5 border-b border-hh-line py-2.5 last:border-b-0">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[15px] text-hh-ink">{w.signal ?? w.symbol}</span>
              <span className="flex items-center gap-2">
                <Num className="text-[15px] text-hh-ink">{num(w.now, 2)}</Num>
                <Chip tone={st.tone}>{st.label}</Chip>
              </span>
            </div>
            {(typeof w.warn_above === "number" || typeof w.calm_below === "number") && (
              <span className="text-xs text-hh-muted">
                {typeof w.warn_above === "number" && <>Warn above <Num>{num(w.warn_above, 2)}</Num></>}
                {typeof w.warn_above === "number" && typeof w.calm_below === "number" && ", "}
                {typeof w.calm_below === "number" && <>calm below <Num>{num(w.calm_below, 2)}</Num></>}
              </span>
            )}
          </div>
        );
      })}
    </Section>
  );
}

function SourceItem({ l }: { l: SourceLink }) {
  const url = safeUrl(l.url);
  const title = l.title ?? l.text ?? l.source ?? url ?? "Source";
  const sub = [l.title || !l.text ? null : l.source, shortDate(l.date)].filter((x): x is string => !!x);
  return (
    <li className="flex flex-col gap-0.5 border-b border-hh-line py-2 last:border-b-0">
      {url ? (
        <a href={url} target="_blank" rel="noopener noreferrer nofollow" className="text-sm text-hh-accent-ink underline-offset-2 hover:underline">
          {title}
        </a>
      ) : (
        <span className="text-sm text-hh-ink">{title}</span>
      )}
      {sub.length > 0 && <span className="text-xs text-hh-muted">{sub.join(", ")}</span>}
    </li>
  );
}

function Sources({ a }: { a: NonNullable<PortfolioSnapshot["advisor"]> }) {
  const read = a.marketRead ?? [];
  const src = a.sources ?? [];
  if (!read.length && !src.length) return null;
  return (
    <Section label="Sources">
      <ul className="flex flex-col">
        {[...read, ...src].map((l, i) => (
          <SourceItem key={i} l={l} />
        ))}
      </ul>
    </Section>
  );
}

// The advisor's report card. Every number comes from learn.py (code), which
// grades each call against real closes once its horizon passes. Rates under the
// lesson minimum are shown muted: too few calls to mean much yet.
function Track({ r }: { r: TrackRecord }) {
  const groups = r.groups ?? [];
  const min = r.minForLesson ?? 10;
  const scored = groups.reduce((n, g) => n + (g.scored ?? 0), 0);
  const pending = groups.reduce((n, g) => n + (g.pending ?? 0), 0);
  const lessons = (r.lessons ?? []).filter(Boolean);
  const recent = (r.recent ?? []).slice(0, 4);
  return (
    <Section label="Advisor track record" aside={r.firstLogged ? `Since ${shortDate(r.firstLogged)}` : undefined}>
      <p className="pb-2 text-xs leading-snug text-hh-muted">
        {scored === 0
          ? `${pending} calls logged. The first grades land about a week after ${r.firstLogged ? shortDate(r.firstLogged) : "the first call"}.`
          : `${scored} graded, ${pending} waiting. Hit rates under ${min} calls are too early to trust.`}
      </p>
      {groups.map((g) => {
        const n = g.scored ?? 0;
        const rate = typeof g.hitRate === "number" ? g.hitRate : null;
        const firm = n >= min;
        return (
          <Row key={g.key}>
            <span className="flex min-w-0 flex-col">
              <span className="text-[15px] text-hh-ink">{g.label ?? g.key}</span>
              <span className="text-xs text-hh-muted">
                {n > 0 ? `${g.hits ?? 0} of ${n} right` : "Not graded yet"}
                {(g.pending ?? 0) > 0 && ` · ${g.pending} waiting`}
              </span>
            </span>
            <Num className={`shrink-0 text-[15px] font-semibold ${firm ? "text-hh-ink" : "text-hh-muted"}`}>
              {rate === null ? "n/a" : `${rate}%`}
            </Num>
          </Row>
        );
      })}
      {recent.length > 0 && (
        <div className="flex flex-col gap-1.5 pt-3">
          <span className="text-xs font-semibold text-hh-muted">Latest grades</span>
          {recent.map((x, i) => (
            <div key={`${x.date}-${x.symbol}-${i}`} className="flex items-start gap-2 text-sm leading-snug">
              <Chip tone={x.result === "hit" ? "pos" : "neg"}>{x.result === "hit" ? "Right" : "Wrong"}</Chip>
              <span className="min-w-0 text-hh-ink-2">{x.detail}</span>
            </div>
          ))}
        </div>
      )}
      {(r.log?.length ?? 0) > 0 && <CallLog log={r.log ?? []} />}
      {lessons.length > 0 && (
        <div className="flex flex-col gap-1.5 border-t border-hh-line pt-3 mt-3">
          <span className="text-xs font-semibold text-hh-muted">What it has learned</span>
          <ul className="flex list-disc flex-col gap-1 pl-5 text-sm leading-snug text-hh-ink-2 marker:text-hh-muted">
            {lessons.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        </div>
      )}
    </Section>
  );
}

// Every call the advisor has made, newest first, with how and when it gets
// graded. Grades come from learn.py against real closes, never from the model.
const CALL_STATUS: Record<string, { tone: Tone; label: string }> = {
  pending: { tone: "muted", label: "Waiting" },
  hit: { tone: "pos", label: "Right" },
  miss: { tone: "neg", label: "Wrong" },
  void: { tone: "muted", label: "Void" },
};
const CALL_VERB: Record<string, string> = { up: "Up", down: "Down", flat: "Flat", sell: "Sell", buy: "Buy", wait: "Wait", hold: "Hold" };

function CallLog({ log }: { log: TrackCall[] }) {
  const open = log.filter((c) => (c.status ?? "pending") === "pending").length;
  const order = ["outlook", "sell", "buy", "wait", "hold", "idea"];
  const rank = (g?: string) => {
    const i = order.findIndex((k) => (g ?? "").startsWith(k));
    return i < 0 ? order.length : i;
  };
  const rows = [...log].sort((a, b) => b.logged.localeCompare(a.logged) || rank(a.group) - rank(b.group));
  return (
    <details className="group mt-3 border-t border-hh-line pt-3">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-[4px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-hh-accent [&::-webkit-details-marker]:hidden">
        <span className="flex flex-col">
          <span className="text-[15px] font-semibold text-hh-ink">Learner log</span>
          <span className="text-xs text-hh-muted">
            {log.length} calls · {open} waiting on a grade
          </span>
        </span>
        <span aria-hidden className="text-hh-muted transition-transform group-open:rotate-90">
          ›
        </span>
      </summary>
      <ul className="flex flex-col pt-1">
        {rows.map((c, i) => {
          const st = CALL_STATUS[c.status ?? "pending"] ?? CALL_STATUS.pending;
          const graded = c.status === "hit" || c.status === "miss";
          const sym = c.symbol === "^GSPC" ? "S&P 500" : c.symbol;
          const verb = CALL_VERB[c.call ?? ""] ?? c.call;
          return (
            <li key={`${c.logged}-${c.group}-${c.symbol}-${i}`} className="flex flex-col gap-1 border-b border-hh-line py-2.5 last:border-b-0">
              <div className="flex items-center justify-between gap-3">
                <span className="flex min-w-0 items-center gap-2">
                  <Chip tone={st.tone}>{st.label}</Chip>
                  <span className="truncate text-[15px] text-hh-ink">
                    <b className="font-semibold">{verb}</b> {sym}
                  </span>
                </span>
                <Num className="shrink-0 text-xs text-hh-muted">{shortDate(c.logged)}</Num>
              </div>
              <span className="text-xs text-hh-muted">
                {c.label}
                {c.confidence && ` · ${c.confidence} confidence`}
                {c.due && (graded ? ` · graded ${shortDate(c.due)}` : c.status === "pending" ? ` · grade about ${shortDate(c.due)}` : "")}
              </span>
              {c.text && <p className="text-sm leading-snug text-hh-ink-2">{c.text}</p>}
              {c.detail && <p className={`text-sm leading-snug ${graded ? (c.status === "hit" ? "text-hh-pos" : "text-hh-neg") : "text-hh-muted"}`}>{c.detail}</p>}
            </li>
          );
        })}
      </ul>
    </details>
  );
}

// Live trade status from the Mac's monitor, reposted after every check and every
// new Fidelity file. Grouped by what Jack has to do: place it, wait, or nothing.
const TRADE_GROUPS: { status: string; label: string; tone: Tone }[] = [
  { status: "alerted", label: "Place these", tone: "neg" },
  { status: "held", label: "Held on purpose", tone: "gold" },
  { status: "open", label: "Not decided yet", tone: "muted" },
  { status: "done", label: "Placed", tone: "pos" },
];

function Trades({ moves, at }: { moves: Move[]; at?: string }) {
  const name = (m: Move) => (m.kind === "swap" && m.sell ? `${m.sell} to ${m.buy ?? "?"}` : `${m.buy ?? m.id}${m.kind === "limit" ? " limit" : m.kind === "cash" ? " (new cash)" : ""}`);
  return (
    <Section label="Trades" aside={at ? `Updated ${etTime(at)}` : undefined}>
      <div className="flex flex-col gap-1">
        {TRADE_GROUPS.map((g) => {
          const items = moves.filter((m) => (m.status ?? "open") === g.status);
          if (!items.length) return null;
          const total = items.reduce((n, m) => n + (m.amount ?? 0), 0);
          return (
            <Fold
              key={g.status}
              open={g.status !== "done"}
              head={
                <>
                  <Chip tone={g.tone}>{g.label}</Chip>
                  <span className="text-xs font-normal text-hh-muted">{items.length}</span>
                  {total > 0 && <Num className="ml-auto text-xs font-normal text-hh-muted">{usd(total)}</Num>}
                </>
              }
            >
              {items.map((m) => (
                <div key={m.id} className="flex flex-col gap-0.5 border-b border-hh-line py-2 last:border-b-0">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 truncate font-semibold text-hh-ink">{name(m)}</span>
                    {typeof m.amount === "number" && <Num className="shrink-0 text-[15px] text-hh-ink">{usd(m.amount)}</Num>}
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-hh-muted">
                    {m.status === "held" && m.revisit && <span className="font-semibold text-hh-ink-2">Until {shortDate(m.revisit)}</span>}
                    {m.status === "held" && m.heldReason && <span>{m.heldReason}</span>}
                    {m.alertedAt && m.status !== "held" && <span>Alerted {shortDate(m.alertedAt.slice(0, 10))} {m.alertedAt.slice(11)}</span>}
                    {m.status === "open" && m.deadline && <span>By {shortDate(m.deadline)}</span>}
                    {taxLine(m.tax) && <span>{taxLine(m.tax)}</span>}
                  </div>
                </div>
              ))}
            </Fold>
          );
        })}
      </div>
    </Section>
  );
}

// Every call followed vs nothing changed, from the Nov 5 holdings. Both books are
// code-built from closing prices, so this is an estimate of the plan's effect,
// not Jack's actual fills. The gap opens only after the trade day.
function PlanVsHoldCard({ p }: { p: PlanVsHold }) {
  const lines = planSeries(p);
  const diff = typeof p.diff === "number" ? p.diff : null;
  return (
    <Section label="Plan vs doing nothing" aside={p.start ? `Since ${shortDate(p.start)}` : undefined}>
      <div className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <Num tone={sign(diff)} className="text-[26px] font-semibold leading-none">
            {diff === null ? "n/a" : usdSigned(diff)}
          </Num>
          <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-hh-muted">estimate</span>
        </div>
        <p className="text-xs leading-snug text-hh-muted">
          {p.scope ?? "Brokerage"} if every call {p.calls ? `(${p.calls} so far) ` : ""}was made at that day&apos;s close, compared with keeping the Nov 5 holdings.
          {lines.plan.length < 2 || Math.abs(diff ?? 0) < 0.5 ? " The two match on the trade day; the gap shows from the next close." : ""}
        </p>
        {lines.plan.length >= 2 && <HistoryChart total={lines.plan} spx={lines.hold} labels={{ a: "Followed the plan", b: "Changed nothing" }} />}
      </div>
    </Section>
  );
}
