import { PageBackdrop } from "@/components/murmur/page-backdrop";

/** Profile skeleton — avatar + name + settings rows. */
export default function MeLoading() {
  return (
    <div className="relative min-h-svh overflow-hidden bg-[#F5F1EB]">
      <PageBackdrop variant="soft" />

      <div
        className="relative z-10 mx-auto max-w-xl px-6"
        style={{ paddingTop: "max(env(safe-area-inset-top, 0px), 40px)" }}
      >
        {/* Avatar + name */}
        <div className="mt-6 flex items-center gap-4">
          <div className="h-16 w-16 animate-pulse rounded-full bg-[#E5DDD0]/70" />
          <div className="space-y-2">
            <div className="h-5 w-36 animate-pulse rounded-full bg-[#E5DDD0]/70" />
            <div className="h-3.5 w-24 animate-pulse rounded-full bg-[#E5DDD0]/50" />
          </div>
        </div>

        {/* Balance card */}
        <div className="mt-8 h-28 animate-pulse rounded-[22px] border border-[#E5DDD0]/50 bg-white/60" />

        {/* Settings rows */}
        <div className="mt-6 space-y-3 pb-24">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="w-full animate-pulse rounded-[16px] border border-[#E5DDD0]/40 bg-white/50"
              style={{ height: 52, animationDelay: `${i * 110}ms` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
