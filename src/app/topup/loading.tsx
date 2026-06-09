import { PageBackdrop } from "@/components/murmur/page-backdrop";

/** Topup skeleton — headline + balance card + three SKU cards. */
export default function TopupLoading() {
  return (
    <div className="relative min-h-svh overflow-hidden bg-[#F5F1EB]">
      <PageBackdrop variant="soft" />

      <div
        className="relative z-10 mx-auto max-w-3xl px-5 md:px-10"
        style={{ paddingTop: "max(env(safe-area-inset-top, 0px), 72px)" }}
      >
        {/* Headline */}
        <div className="h-10 w-72 animate-pulse rounded-full bg-[#E5DDD0]/70 md:h-13 md:w-96" />

        {/* Balance card */}
        <div className="mt-8 h-40 animate-pulse rounded-[26px] border border-[#E5DDD0]/50 bg-white/60" />

        {/* SKU cards */}
        <div className="mt-12 grid grid-cols-1 gap-3 pb-44 md:grid-cols-[1fr_1.35fr_1fr] md:gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="h-44 animate-pulse rounded-[22px] border border-[#E5DDD0]/50 bg-white/60"
              style={{ animationDelay: `${i * 120}ms` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
