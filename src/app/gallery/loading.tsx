import { Spinner } from "@/components/ui/spinner";

export default function GalleryLoading() {
  return (
    <div className="relative min-h-svh overflow-hidden bg-[#F5F1EB]">
      <div className="absolute inset-0 z-10 flex items-center justify-center">
        <Spinner size="lg" />
      </div>
    </div>
  );
}
