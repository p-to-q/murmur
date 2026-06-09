import { PageBackdrop } from "@/components/murmur/page-backdrop";

/**
 * Global route-transition fallback: the cream surface plus a soft pulsing
 * dot trio, shown while a route segment's JS/data streams in. Route-specific
 * skeletons (gallery, studio, …) override this with their own loading.tsx.
 */
export default function Loading() {
  return (
    <div className="relative min-h-svh overflow-hidden bg-[#F5F1EB]">
      <PageBackdrop variant="soft" />

      <div className="relative z-10 flex min-h-svh items-center justify-center">
        <div className="flex items-center gap-2" aria-label="加载中">
          <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-[#FF8A5C] [animation-delay:0ms]" />
          <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-[#FF8A5C] [animation-delay:180ms]" />
          <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-[#FF8A5C] [animation-delay:360ms]" />
        </div>
      </div>
    </div>
  );
}
