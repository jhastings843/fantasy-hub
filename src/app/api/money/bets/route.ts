import { deleteBet, getBets, saveBet } from "@/lib/money/store";
import { netUnits, validateBet, type Outcome } from "@/lib/money/bets";

export const dynamic = "force-dynamic";

// /api/money/bets: Jack's own bets (scripts/money-bet.mjs is the friendly way in).
//   POST { bets: MoneyBet[] }                      log or replace bets by id
//   POST { grade: { id, outcome, actual? } }       grade one by hand
//   POST { remove: id }                            take one off the record
// Same secret as the ingest route. Reading is the Money page's job.
const OUTCOMES: Outcome[] = ["W", "L", "P", "void"];

export async function POST(request: Request) {
  const secret = process.env.MONEY_INGEST_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as { bets?: unknown[]; grade?: { id: string; outcome: Outcome; actual?: string }; remove?: string } | null;
  if (!body) return Response.json({ ok: false, error: "Bad JSON" }, { status: 400 });

  if (body.remove) return Response.json({ ok: (await deleteBet(body.remove)) > 0 });

  if (body.grade) {
    const b = (await getBets()).find((x) => x.id === body.grade!.id);
    if (!b) return Response.json({ ok: false, error: "No such bet" }, { status: 404 });
    if (!OUTCOMES.includes(body.grade.outcome)) return Response.json({ ok: false, error: "outcome: W, L, P or void" }, { status: 400 });
    b.result = { outcome: body.grade.outcome, actual: body.grade.actual, net: netUnits(body.grade.outcome, b.units, b.price), gradedAt: new Date().toISOString(), by: "hand" };
    await saveBet(b);
    return Response.json({ ok: true, bet: b });
  }

  const errors: string[] = [];
  let saved = 0;
  for (const x of body.bets ?? []) {
    const v = validateBet(x);
    if (typeof v === "string") {
      errors.push(`${(x as { id?: string })?.id ?? "?"}: ${v}`);
      continue;
    }
    await saveBet(v);
    saved++;
  }
  return Response.json({ ok: errors.length === 0, saved, errors }, { status: errors.length && !saved ? 400 : 200 });
}
