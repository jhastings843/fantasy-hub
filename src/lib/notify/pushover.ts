import "server-only";

// Pushover: a phone alert alongside an email. Fantasy Hub has its own app
// token (one key per app); PUSHOVER_USER_KEY is the account it delivers to.
// Optional: without both variables nothing is pushed and the caller carries on.

const URL = "https://api.pushover.net/1/messages.json";

export function pushoverConfigured(env = process.env): boolean {
  return Boolean(env.PUSHOVER_APP_TOKEN && env.PUSHOVER_USER_KEY);
}

export interface Push {
  title: string;
  message: string;
  url?: string;
  urlTitle?: string;
}

/** Never throws: a failed push must not fail the email it rides with. */
export async function push(p: Push, env = process.env, fetchImpl: typeof fetch = fetch): Promise<{ pushed: boolean; reason?: string }> {
  if (!pushoverConfigured(env)) return { pushed: false, reason: "Pushover not configured (PUSHOVER_APP_TOKEN, PUSHOVER_USER_KEY)" };
  try {
    const res = await fetchImpl(URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        token: env.PUSHOVER_APP_TOKEN,
        user: env.PUSHOVER_USER_KEY,
        title: p.title.slice(0, 250),
        message: p.message.slice(0, 1024),
        ...(p.url ? { url: p.url, url_title: p.urlTitle ?? "Open" } : {}),
      }),
    });
    const data = (await res.json().catch(() => ({}))) as { status?: number; errors?: string[] };
    if (!res.ok || data.status !== 1) return { pushed: false, reason: `Pushover ${res.status}: ${(data.errors ?? []).join("; ") || "rejected"}` };
    return { pushed: true };
  } catch (e) {
    return { pushed: false, reason: e instanceof Error ? e.message : String(e) };
  }
}
