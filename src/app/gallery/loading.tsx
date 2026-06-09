import { PageBackdrop } from "@/components/murmur/page-backdrop";

/** Gallery skeleton — heatmap strip + sticker-card grid placeholders. */
export default function GalleryLoading() {
  return (
    <div className="relative min-h-svh overflow-hidden bg-[#F5F1EB]">
      <PageBackdrop variant="soft" />

      <div
        className="relative z-10 mx-auto max-w-5xl px-5 md:px-10"
        style={{ paddingTop: "max(env(safe-area-inset-top, 0px), 28px)" }}
      >
        {/* Title */}
        <div className="h-10 w-44 animate-pulse rounded-full bg-[#E5DDD0]/70 md:h-12 md:w-56" />

        {/* Heatmap strip */}
        <div className="mt-8 h-24 animate-pulse rounded-[22px] border border-[#E5DDD0]/50 bg-white/50" />

        {/* Card grid */}
        <div className="mt-8 grid grid-cols-2 gap-4 pb-24 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="animate-pulse rounded-[18px] border border-[#E5DDD0]/50 bg-white/60"
              style={{ aspectRatio: "3 / 4", animationDelay: `${i * 90}ms` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
