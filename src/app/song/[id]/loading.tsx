import { PageBackdrop } from "@/components/murmur/page-backdrop";

/** Song detail skeleton — cover art + title + action row. */
export default function SongDetailLoading() {
  return (
    <div className="relative min-h-svh overflow-hidden bg-[#F5F1EB]">
      <PageBackdrop variant="soft" />

      <div
        className="relative z-10 mx-auto flex min-h-svh max-w-xl flex-col items-center px-6"
        style={{ paddingTop: "max(env(safe-area-inset-top, 0px), 40px)" }}
      >
        {/* Cover art */}
        <div className="mt-8 aspect-square w-full max-w-[340px] animate-pulse rounded-[26px] bg-[#E5DDD0]/70" />

        {/* Title + vibe */}
        <div className="mt-8 h-8 w-52 animate-pulse rounded-full bg-[#E5DDD0]/70" />
        <div className="mt-3 h-4 w-28 animate-pulse rounded-full bg-[#E5DDD0]/50" />

        {/* Action row */}
        <div className="mt-10 flex items-center gap-4">
          <div className="h-12 w-12 animate-pulse rounded-full bg-[#E5DDD0]/60" />
          <div className="h-14 w-14 animate-pulse rounded-full bg-[#FF8A5C]/40" />
          <div className="h-12 w-12 animate-pulse rounded-full bg-[#E5DDD0]/60" />
        </div>
      </div>
    </div>
  );
}
