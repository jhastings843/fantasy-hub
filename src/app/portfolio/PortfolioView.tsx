import type { ReactNode } from "react";
import { Chip, Num, PageHead, Row, Section, Spotlight, type Tone } from "@/components/hh/ui";
import type { Action, CashStep, Idea, Outlook, PortfolioSnapshot, SourceLink, WatchItem } from "@/lib/portfolio/types";
import {
  capState,
  etTime,
  groupActions,
  groupHoldings,
  indexHistory,
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
          <span className="flex flex-col gap-0.5 sm:items-end">
            <span>As of {etTime(s.asOf)}</span>
            {s.priceDate && <span>Closing prices from {shortDate(s.priceDate)}</span>}
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
          {advisor?.actions && advisor.actions.length > 0 && <Actions actions={advisor.actions} />}
          {advisor && sortIdeas(advisor.ideas).length > 0 && <Ideas ideas={sortIdeas(advisor.ideas)} />}
          <Holdings s={s} />
          {hist.total.length >= 2 && (
            <Section label="Value over time" aside={`${s.history?.length ?? 0} days`}>
              <HistoryChart total={hist.total} spx={hist.spx} />
            </Section>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-8">
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

function Actions({ actions }: { actions: Action[] }) {
  const groups = groupActions(actions);
  return (
    <Section label="Moves" aside="You place every order">
      <div className="flex flex-col gap-5">
        {groups.map((g) => (
          <div key={g.kind} className="flex flex-col">
            <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold text-hh-ink">
              <span
                aria-hidden
                className="size-2 rounded-[2px]"
                style={{ background: ACTION_TONE[g.kind] ? `var(--hh-${ACTION_TONE[g.kind]})` : "var(--hh-muted)" }}
              />
              {g.label}
              <span className="text-xs font-normal text-hh-muted">{g.items.length}</span>
            </h3>
            {g.items.map((a, i) => (
              <ActionRow key={`${a.symbol}-${i}`} a={a} />
            ))}
          </div>
        ))}
      </div>
    </Section>
  );
}

function ActionRow({ a }: { a: Action }) {
  const tax = taxLine(a.tax);
  return (
    <div className="flex flex-col gap-1 border-b border-hh-line py-2.5 last:border-b-0">
      <div className="flex items-baseline justify-between gap-3">
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="font-semibold text-hh-ink">{a.symbol ?? "n/a"}</span>
          {a.detail && <span className="truncate text-sm text-hh-ink-2">{a.detail}</span>}
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
        <div className="flex flex-col gap-5">
          {groups.map((g) => (
            <div key={g.key} className="flex flex-col">
              <h3 className="flex items-baseline justify-between gap-3 border-b border-hh-rule/40 pb-1 text-sm font-semibold text-hh-ink">
                {g.label}
                <span className="text-xs font-normal text-hh-muted">
                  <Num className="text-hh-ink-2">{usd(g.value)}</Num>
                  {s.totals.total ? <> · <Num>{pct((g.value / s.totals.total) * 100)}</Num></> : null}
                </span>
              </h3>
              {g.items.map((h, i) => (
                <div key={`${h.symbol}-${h.account}-${i}`} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 border-b border-hh-line py-2.5 last:border-b-0">
                  <span className="flex min-w-0 items-baseline gap-2">
                    <span className="font-semibold text-hh-ink">{h.symbol}</span>
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
            </div>
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
