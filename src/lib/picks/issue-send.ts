import "server-only";
import { redis } from "@/lib/redis/client";
import { sendEmail } from "@/lib/guillotine/send";
import { alreadySent, recordSent } from "@/lib/email/sent-log";
import type { IssuedRecord } from "./issued";
import { dropPendingIssued, getIssued, markIssuedSent, saveIssued } from "./issued-store";

// Sending an email that carries bets, so that the bets and the email can
// never disagree:
//
//   1. intent: each issued record is written with status "pending", and the
//      exact HTML is stored next to it, BEFORE anything is sent;
//   2. send, with a fixed idempotency key;
//   3. confirm: records -> "sent", then the sent log.
//
// A crash anywhere is reconciled on the next run. Records already "sent"
// with no log entry just get the log written (no email). Records "pending"
// are re-sent from the STORED html under the SAME key, so the provider
// treats a delivered retry as a duplicate (within its 24h window) and the
// card that goes out is the card that was recorded. An explicit send failure
// drops the intent, so it never counts as issued.

const htmlKey = (idem: string) => `picks:v2:intent-html:${idem}`;

export interface IssueSendInput {
  /** Sent-log id ("picks", "picks-sat", "sunday") and its season/week. */
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
}

export interface IssueSendResult {
  sent: boolean;
  /** "sent", "reconciled" (log written for a confirmed earlier send), "resent-pending", "failed". */
  outcome: string;
  emailId?: string;
  error?: string;
  issued: string[];
}

export async function issueAndSend(input: IssueSendInput): Promise<IssueSendResult> {
  const send = input.send ?? sendEmail;
  const issued: string[] = [];

  // Reconcile anything an earlier run left behind.
  const existing = await Promise.all(input.records.map((r) => getIssued(r.league, r.season, r.week, r.slot)));
  const confirmedEarlier = existing.filter((r) => r && r.status !== "pending");
  const pendingEarlier = existing.filter((r): r is IssuedRecord => !!r && r.status === "pending");
  if (input.records.length && confirmedEarlier.length === input.records.length) {
    if (!(await alreadySent(input.logId, input.season, input.week))) {
      await recordSent(input.logId, input.season, input.week, {
        sentAt: confirmedEarlier[0]!.issuedAt,
        subject: confirmedEarlier[0]!.subject,
        messageId: confirmedEarlier[0]!.emailId,
        note: "reconciled from issued records",
      });
    }
    return { sent: false, outcome: "reconciled", issued: ["already issued and sent; log reconciled"] };
  }

  let html = input.html;
  let subject = input.subject;
  let key = input.idempotencyKey;
  if (pendingEarlier.length) {
    // Resend exactly what was recorded, under its original key.
    key = pendingEarlier[0].idempotencyKey ?? key;
    const stored = await redis.get<{ html: string; subject: string }>(htmlKey(key));
    if (stored) {
      html = stored.html;
      subject = stored.subject;
    }
  } else {
    await redis.set(htmlKey(key), { html, subject }, { ex: 14 * 24 * 3600 });
    for (const r of input.records) {
      const ok = await saveIssued({ ...r, status: "pending", idempotencyKey: key });
      issued.push(`${r.league}${r.slot && r.slot !== "tue" ? `:${r.slot}` : ""}: ${ok ? "intent recorded" : "already on file"}`);
    }
  }

  let result: Awaited<ReturnType<typeof sendEmail>>;
  try {
    result = await send(subject, html, key);
  } catch (e) {
    // Unknown whether it went: keep the intent; the next run retries under the same key.
    return { sent: false, outcome: "failed", error: e instanceof Error ? e.message : String(e), issued };
  }
  if (!result.sent) {
    for (const r of input.records) await dropPendingIssued(r);
    return { sent: false, outcome: "failed", error: result.reason ?? "Not sent.", issued: [...issued, "intent dropped (send refused)"] };
  }
  for (const r of input.records) await markIssuedSent(r, result.id);
  await recordSent(input.logId, input.season, input.week, { sentAt: new Date().toISOString(), subject, messageId: result.id });
  return { sent: true, outcome: pendingEarlier.length ? "resent-pending" : "sent", emailId: result.id, issued: [...issued, "confirmed sent"] };
}
