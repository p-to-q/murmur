import { PageBackdrop } from "@/components/murmur/page-backdrop";

/** Studio skeleton — vinyl disc + mixer track rows. */
export default function StudioLoading() {
  return (
    <div className="relative min-h-svh overflow-hidden bg-[#F5F1EB]">
      <PageBackdrop variant="soft" />

      <div
        className="relative z-10 mx-auto flex min-h-svh max-w-3xl flex-col items-center px-5"
        style={{ paddingTop: "max(env(safe-area-inset-top, 0px), 40px)" }}
      >
        {/* Vinyl disc */}
        <div className="mt-10 h-56 w-56 animate-pulse rounded-full bg-[#E5DDD0]/70 md:h-72 md:w-72" />

        {/* Track mixer rows */}
        <div className="mt-12 w-full space-y-3 pb-24">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="h-14 w-full animate-pulse rounded-[18px] border border-[#E5DDD0]/50 bg-white/60"
              style={{ animationDelay: `${i * 120}ms` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
