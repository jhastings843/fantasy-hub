import "server-only";
import { redis } from "@/lib/redis/client";
import { sendEmail } from "@/lib/guillotine/send";
import { alreadySent, recordSent } from "@/lib/email/sent-log";
import type { IssuedRecord } from "./issued";
import { dropPendingIssued, getIssued, markIssued, saveIssued } from "./issued-store";

// Sending an email that carries bets, so that the bets and the email can
// never disagree:
//
//   1. claim: ONE atomic intent per idempotency key (SET NX) holding the
//      exact HTML, subject and records, then each record written "pending";
//   2. send, with that idempotency key;
//   3. confirm: records -> "sent", then the sent log.
//
// Whoever loses the claim (a concurrent run, or a later retry) sends the
// CLAIMED card and writes the CLAIMED records, never its own render, so the
// email delivered and the bets recorded always come from the same intent.
// Recovery of a pending intent re-sends under the same key only inside the
// provider's duplicate window; past ~20 hours the records are marked
// "unconfirmed" (excluded from results, still counted as exposure) and left
// for a person, because a resend could deliver a second email.

const intentKey = (idem: string) => `picks:v2:intent:${idem}`;
/** Comfortably inside the provider's 24h idempotency window. */
export const RESEND_WINDOW_MS = 20 * 3600 * 1000;

export interface Intent {
  html: string;
  subject: string;
  records: IssuedRecord[];
  createdAt: string;
}

export interface IssueSendInput {
  /** Sent-log id ("picks", "picks-day", "sunday") and its season/week (picks-day: YYYYMMDD). */
  logId: string;
  season: string;
  week: number;
  subject: string;
  html: string;
  idempotencyKey: string;
  /** The bets this email carries (empty for an email with none). */
  records: IssuedRecord[];
  /** Sender, injectable for tests. */
  send?: typeof sendEmail;
  now?: () => number;
}

export interface IssueSendResult {
  sent: boolean;
  /** "sent", "reconciled", "resent-pending", "unconfirmed", "failed". */
  outcome: string;
  emailId?: string;
  error?: string;
  issued: string[];
}

/** The claimed intent for a key, if any. */
export async function loadIntent(idem: string): Promise<Intent | null> {
  return (await redis.get<Intent>(intentKey(idem)).catch(() => null)) ?? null;
}

export async function issueAndSend(input: IssueSendInput): Promise<IssueSendResult> {
  const send = input.send ?? sendEmail;
  const now = input.now ?? Date.now;
  const key = input.idempotencyKey;
  const issued: string[] = [];

  // 1. Claim, or adopt the existing claim.
  const mine: Intent = { html: input.html, subject: input.subject, records: input.records, createdAt: new Date(now()).toISOString() };
  const won = (await redis.set(intentKey(key), mine, { nx: true, ex: 30 * 24 * 3600 })) === "OK";
  const intent = won ? mine : ((await loadIntent(key)) ?? mine);
  const recs = intent.records;

  const current = await Promise.all(recs.map((r) => getIssued(r.league, r.season, r.week, r.slot)));
  if (recs.length && current.every((r) => r && r.status === "sent")) {
    if (!(await alreadySent(input.logId, input.season, input.week))) {
      await recordSent(input.logId, input.season, input.week, {
        sentAt: current[0]!.issuedAt,
        subject: current[0]!.subject,
        messageId: current[0]!.emailId,
        note: "reconciled from issued records",
      });
    }
    return { sent: false, outcome: "reconciled", issued: ["already issued and sent; log reconciled"] };
  }
  if (!won && now() - new Date(intent.createdAt).getTime() > RESEND_WINDOW_MS) {
    for (const r of recs) await markIssued(r, "unconfirmed");
    return {
      sent: false,
      outcome: "unconfirmed",
      error: `An earlier send of this card (${intent.createdAt}) never confirmed and is past the safe resend window; marked unconfirmed for a person to check.`,
      issued,
    };
  }
  // Every claimed record on file as pending (fills gaps a crash left).
  for (let i = 0; i < recs.length; i++) {
    if (!current[i]) {
      const ok = await saveIssued({ ...recs[i], status: "pending", idempotencyKey: key });
      issued.push(`${recs[i].league}${recs[i].slot && recs[i].slot !== "tue" ? `:${recs[i].slot}` : ""}: ${ok ? "intent recorded" : "already on file"}`);
    }
  }

  // 2. Send the claimed card.
  let result: Awaited<ReturnType<typeof sendEmail>>;
  try {
    result = await send(intent.subject, intent.html, key);
  } catch (e) {
    // Unknown whether it went: keep the intent; the next run retries under the same key.
    return { sent: false, outcome: "failed", error: e instanceof Error ? e.message : String(e), issued };
  }
  if (!result.sent) {
    for (const r of recs) await dropPendingIssued(r);
    await redis.del(intentKey(key)).catch(() => {});
    return { sent: false, outcome: "failed", error: result.reason ?? "Not sent.", issued: [...issued, "intent dropped (send refused)"] };
  }
  // 3. Confirm.
  for (const r of recs) await markIssued(r, "sent", result.id);
  await recordSent(input.logId, input.season, input.week, { sentAt: new Date(now()).toISOString(), subject: intent.subject, messageId: result.id });
  return { sent: true, outcome: won ? "sent" : "resent-pending", emailId: result.id, issued: [...issued, "confirmed sent"] };
}

/**
 * Finishes an earlier send that never confirmed, before anything new is
 * decided: re-sends the claimed card (inside the window) or marks it
 * unconfirmed. Returns null when there was nothing pending.
 */
export async function recoverPending(input: Omit<IssueSendInput, "html" | "subject" | "records">): Promise<IssueSendResult | null> {
  const intent = await loadIntent(input.idempotencyKey);
  if (!intent || !intent.records.length) return null;
  const states = await Promise.all(intent.records.map((r) => getIssued(r.league, r.season, r.week, r.slot)));
  if (states.every((r) => r && r.status !== "pending")) return null;
  return issueAndSend({ ...input, html: intent.html, subject: intent.subject, records: intent.records });
}
