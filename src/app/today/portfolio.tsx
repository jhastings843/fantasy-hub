import Link from "next/link";
import { cookies } from "next/headers";
import { ChevronRight } from "lucide-react";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { canSeePortfolio } from "@/lib/portfolio/lock";
import { getPortfolio } from "@/lib/portfolio/store";
import { etDate, todayMoves, type TodayMove } from "@/lib/portfolio/today";
import { usd } from "@/lib/portfolio/view";
import { Chip, Section, type Tone } from "@/components/hh/ui";

// Portfolio moves on Today, the way claims show: only on days something is due,
// and only on Jack's unlocked devices. Locked or nothing due renders nothing at
// all, so the public Today page never hints at balances or trades.

const KIND: Record<TodayMove["kind"], { label: string; tone: Tone }> = {
  sell: { label: "Sell", tone: "neg" },
  buy: { label: "Buy", tone: "pos" },
  limit: { label: "Set limit", tone: "accent" },
  cash: { label: "Cash plan", tone: "gold" },
  idea: { label: "New buy", tone: "pos" },
};

export async function PortfolioToday({ now = new Date() }: { now?: Date }) {
  const open = await canSeePortfolio({
    secret: process.env.HH_SESSION_SECRET,
    token: (await cookies()).get(SESSION_COOKIE)?.value,
    nodeEnv: process.env.NODE_ENV,
  });
  if (!open) return null;
  let moves: TodayMove[] = [];
  try {
    moves = todayMoves(await getPortfolio(), etDate(now));
  } catch (e) {
    console.error("portfolio today", e);
    return null;
  }
  if (!moves.length) return null;
  return (
    <Section
      id="t-portfolio"
      label="Portfolio moves"
      aside={
        <Link href="/portfolio" className="inline-flex min-h-11 items-center gap-0.5 font-semibold text-hh-accent-ink hover:underline">
          Portfolio
          <ChevronRight size={14} aria-hidden />
        </Link>
      }
    >
      <ul className="divide-y divide-hh-line">
        {moves.map((m) => (
          <li key={m.key} className="flex flex-col gap-1 py-2.5">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className="hh-num text-[16px] font-semibold text-hh-ink">{m.symbol}</span>
              <Chip tone={KIND[m.kind].tone}>{KIND[m.kind].label}</Chip>
              {m.amount !== null && <span className="hh-num ml-auto text-[15px] font-semibold text-hh-ink">{usd(m.amount)}</span>}
            </div>
            {m.detail && <p className="text-[13px] text-hh-muted">{m.detail}</p>}
            {m.reason && <p className="text-[13px] leading-relaxed text-hh-ink">{m.reason}</p>}
          </li>
        ))}
      </ul>
    </Section>
  );
}
