import Link from "next/link";

import { PageBackdrop } from "@/components/murmur/page-backdrop";

/**
 * 404 — a quiet page for a melody that isn't here.
 *
 * Server component on purpose: no client JS needed, and it renders for any
 * unmatched route (plus `notFound()` calls from song detail etc.).
 */
export default function NotFound() {
  return (
    <div className="relative min-h-svh overflow-hidden bg-[#F5F1EB]">
      <PageBackdrop variant="soft" />

      <div className="relative z-10 flex min-h-svh flex-col items-center justify-center px-6 text-center">
        <p className="text-[11px] uppercase tracking-[0.22em] text-[#8C8780]">
          404
        </p>
        <h1 className="hero-serif mt-4 text-[36px] leading-[1.08] text-[#1A1A1A] md:text-[52px]">
          这里没有旋律。
        </h1>
        <p className="font-serif-italic mt-4 max-w-[420px] text-[15px] text-[#6F6A63]">
          你找的页面不存在，或者已经被收进别的歌里了。
        </p>

        <div className="mt-9 flex items-center gap-5">
          <Link href="/" className="mm-btn-primary">
            回去哼一句
          </Link>
          <Link
            href="/gallery"
            className="text-[13px] tracking-[0.04em] text-[#8C8780] underline decoration-[#D2C9B6] underline-offset-4 transition-colors hover:text-[#1A1A1A]"
          >
            看看歌单
          </Link>
        </div>
      </div>
    </div>
  );
}
