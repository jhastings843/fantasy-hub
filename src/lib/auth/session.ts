// A signed "this device is Jack's" cookie (security audit, 2026-11-04).
// The site stays readable by anyone; only routes that write or spend money
// (survivor saves and screenshot reads, cache refresh) need the cookie.
// Web Crypto only, so the same code runs in proxy.ts and in server actions.
//
//   token = "<issuedMs>.<base64url HMAC-SHA256(secret, 'hh:' + issuedMs)>"

export const SESSION_COOKIE = "hh_session";
export const SESSION_DAYS = 180;

const enc = new TextEncoder();
const b64url = (buf: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function hmac(secret: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", key, enc.encode(msg)));
}

/** Constant-time string compare (lengths differing is not secret). */
export function sameString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export async function makeToken(secret: string, now = Date.now()): Promise<string> {
  return `${now}.${await hmac(secret, `hh:${now}`)}`;
}

/** True only for a token this secret signed, not older than SESSION_DAYS. Fails closed on anything else. */
export async function validToken(secret: string | undefined, token: string | undefined, now = Date.now()): Promise<boolean> {
  if (!secret || !token) return false;
  const [issued, sig] = token.split(".");
  const at = Number(issued);
  if (!Number.isFinite(at) || !sig || at > now + 60_000 || now - at > SESSION_DAYS * 86_400_000) return false;
  return sameString(sig, await hmac(secret, `hh:${at}`));
}
