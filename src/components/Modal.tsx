"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { useRouter } from "next/navigation";

// A page opened over the current one (intercepted routes under app/@modal).
// Closing goes back in history, so the page underneath keeps its scroll and
// state; a reload of the same URL shows the full page instead. Esc, the
// backdrop and the close button all close it. Phones get a full-height sheet.

export default function Modal({ label, children }: { label: string; children: ReactNode }) {
  const router = useRouter();
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") router.back();
    };
    document.addEventListener("keydown", key);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", key);
    };
  }, [router]);

  return (
    <div
      className="fixed inset-0 z-[70] flex items-stretch justify-center bg-black/65 backdrop-blur-sm sm:items-start sm:px-4 sm:py-10"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) router.back();
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className="relative w-full max-w-2xl overflow-y-auto overscroll-contain bg-[#201f1c] shadow-2xl outline-none sm:max-h-[calc(100vh-5rem)] sm:rounded-2xl sm:border sm:border-[#49453e]"
      >
        <button
          type="button"
          onClick={() => router.back()}
          aria-label="Close"
          className="absolute right-3 top-3 z-10 grid size-9 place-items-center rounded-full text-[#cfc8bc] transition-colors hover:bg-[#33312b] hover:text-[#eee9df] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#efabb6]"
        >
          <svg aria-hidden viewBox="0 0 16 16" className="size-4 fill-none stroke-current" strokeWidth={1.8}>
            <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" />
          </svg>
        </button>
        {children}
      </div>
    </div>
  );
}
