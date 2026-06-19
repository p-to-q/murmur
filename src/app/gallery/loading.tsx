import { PageBackdrop } from "@/components/murmur/page-backdrop";
import { Spinner } from "@/components/ui/spinner";

/** Gallery route fallback — a general spinner, no skeleton cards (those
 *  never matched the real grid, so they read as a layout glitch). */
export default function GalleryLoading() {
  return (
    <div className="relative min-h-svh overflow-hidden bg-[#F5F1EB]">
      <PageBackdrop variant="soft" />

      <div className="relative z-10 flex min-h-svh items-center justify-center">
        <Spinner size="lg" />
      </div>
    </div>
  );
}
