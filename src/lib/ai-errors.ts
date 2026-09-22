/**
 * Turns Anthropic SDK failures into something a person can read.
 *
 * The one that matters: when the account runs out of credit the API returns a
 * 400 whose message is "Your credit balance is too low to access the Claude
 * API". Without this, that surfaces as a generic 500 and a broken page.
 */

export const AI_PAUSED_MESSAGE =
  "AI features are paused: the Anthropic account is out of credit. Add credit at console.anthropic.com/settings/billing to switch them back on.";

export const AI_BUSY_MESSAGE =
  "Claude is rate limited right now. Wait a minute and try again.";

export const AI_UNCONFIGURED_MESSAGE =
  "AI features are not configured: no Anthropic API key is set for this environment.";

type ErrorLike = {
  status?: number;
  message?: string;
  error?: { error?: { message?: string; type?: string }; message?: string };
};

function textOf(err: unknown): string {
  const e = (err ?? {}) as ErrorLike;
  return [e.message, e.error?.message, e.error?.error?.message]
    .filter((s): s is string => typeof s === "string")
    .join(" ")
    .toLowerCase();
}

function statusOf(err: unknown): number | undefined {
  const s = (err as ErrorLike)?.status;
  return typeof s === "number" ? s : undefined;
}

/** Out of credit. The API reports this as a 400, not a 402. */
export function isCreditExhausted(err: unknown): boolean {
  const status = statusOf(err);
  if (status === 402) return true;
  if (status !== undefined && status !== 400) return false;
  const text = textOf(err);
  return (
    text.includes("credit balance is too low") ||
    text.includes("insufficient credit") ||
    (text.includes("billing") && text.includes("credit"))
  );
}

export function isRateLimited(err: unknown): boolean {
  return statusOf(err) === 429 || textOf(err).includes("rate limit");
}

export function isMissingKey(err: unknown): boolean {
  const text = textOf(err);
  return text.includes("could not resolve authentication") || text.includes("api key");
}

/**
 * A message worth showing a user, or null when the failure is something else
 * and the caller should fall back to its own handling.
 */
export function friendlyAiError(err: unknown): string | null {
  if (isCreditExhausted(err)) return AI_PAUSED_MESSAGE;
  if (isRateLimited(err)) return AI_BUSY_MESSAGE;
  if (isMissingKey(err)) return AI_UNCONFIGURED_MESSAGE;
  return null;
}

/** HTTP status to answer with: 503 for out of credit, 429 for throttled. */
export function aiErrorStatus(err: unknown): number {
  if (isCreditExhausted(err)) return 503;
  if (isRateLimited(err)) return 429;
  return 500;
}
