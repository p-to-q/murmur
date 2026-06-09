"use client";

/**
 * Global error boundary — catches render/data errors below the root layout.
 *
 * Mirrors the Murmur visual language (cream surface, serif headline, coral
 * action) so a crash still feels like the same product. `reset()` re-renders
 * the segment; the home link is the escape hatch when retry keeps failing.
 */

import { useEffect } from "react";
import { PageBackdrop } from "@/components/murmur/page-backdrop";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app-error-boundary]", error);
  }, [error]);

  return (
    <div className="relative min-h-svh overflow-hidden bg-[#F5F1EB]">
      <PageBackdrop variant="soft" />

      <div className="relative z-10 flex min-h-svh flex-col items-center justify-center px-6 text-center">
        <p className="text-[11px] uppercase tracking-[0.22em] text-[#8C8780]">
          MURMUR
        </p>
        <h1 className="hero-serif mt-4 text-[36px] leading-[1.08] text-[#1A1A1A] md:text-[52px]">
          这一句走调了。
        </h1>
        <p className="font-serif-italic mt-4 max-w-[420px] text-[15px] text-[#6F6A63]">
          页面出了点问题，不过你的旋律都还在。再试一次，或者先回首页哼一句。
        </p>
        {error.digest && (
          <p className="mt-3 text-[11px] tracking-[0.06em] text-[#B7AEA1]">
            错误编号 {error.digest}
          </p>
        )}

        <div className="mt-9 flex items-center gap-5">
          <button onClick={reset} className="mm-btn-primary">
            再试一次
          </button>
          {/* Plain <a> on purpose: a full page load resets whatever client
              state crashed the segment, which <Link> would carry along. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a
            href="/"
            className="text-[13px] tracking-[0.04em] text-[#8C8780] underline decoration-[#D2C9B6] underline-offset-4 transition-colors hover:text-[#1A1A1A]"
          >
            回首页
          </a>
        </div>
      </div>
    </div>
  );
}
