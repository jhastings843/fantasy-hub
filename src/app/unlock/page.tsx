import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, SESSION_DAYS, makeToken, sameString, validToken } from "@/lib/auth/session";
import { PageHead } from "@/components/hh/ui";

// Unlock this device (security audit, 2026-11-04): the passphrase sets a signed
// cookie for SESSION_DAYS, and the survivor saves, screenshot reader, cache
// refresh and the private /portfolio page accept it. Other reads never need it.

export const metadata: Metadata = { title: "Unlock · Hobby Hub", robots: { index: false } };
export const dynamic = "force-dynamic";

async function unlock(form: FormData) {
  "use server";
  const pass = String(form.get("passphrase") ?? "");
  const want = process.env.HH_PASSPHRASE;
  const secret = process.env.HH_SESSION_SECRET;
  if (!want || !secret) redirect("/unlock?e=setup");
  if (!sameString(pass, want)) {
    // A little friction against guessing.
    await new Promise((r) => setTimeout(r, 800));
    redirect("/unlock?e=wrong");
  }
  (await cookies()).set(SESSION_COOKIE, await makeToken(secret), {
    httpOnly: true,
    secure: process.env.NODE_ENV !== "development",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DAYS * 86_400,
  });
  redirect("/unlock?ok=1");
}

export default async function UnlockPage({ searchParams }: { searchParams: Promise<{ e?: string; ok?: string }> }) {
  const q = await searchParams;
  const on = await validToken(process.env.HH_SESSION_SECRET, (await cookies()).get(SESSION_COOKIE)?.value);
  const msg = q.e === "wrong" ? "That passphrase didn't match. Try again." : q.e === "setup" ? "Unlocking isn't set up yet: the passphrase hasn't been added in Vercel." : null;
  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 pb-16 pt-10">
      <PageHead title="Unlock" sub="Your Portfolio page, saving survivor picks, reading a pool screenshot and refreshing the cache need this device unlocked. The rest of the site is open to read." />
      {on || q.ok ? (
        <p className="hh-spot p-4 text-[15px]">
          This device is unlocked for {SESSION_DAYS} days.{" "}
          <Link href="/portfolio" className="font-semibold text-hh-accent-ink underline-offset-2 hover:underline">
            Open your portfolio
          </Link>
        </p>
      ) : (
        <form action={unlock} className="flex flex-col gap-3">
          <label htmlFor="passphrase" className="text-sm font-semibold text-hh-ink">
            Passphrase
          </label>
          <input
            id="passphrase"
            name="passphrase"
            type="password"
            autoComplete="current-password"
            required
            className="h-11 rounded-[6px] border border-hh-line bg-hh-panel px-3 text-[16px] text-hh-ink focus:border-hh-accent focus:outline-none"
          />
          {msg && <p className="text-sm text-hh-neg" role="alert">{msg}</p>}
          <button type="submit" className="h-11 cursor-pointer rounded-[6px] bg-hh-accent font-semibold text-[var(--hh-on-accent)] transition-opacity hover:opacity-90">
            Unlock this device
          </button>
        </form>
      )}
    </main>
  );
}
