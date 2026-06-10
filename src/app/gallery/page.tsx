import { GalleryScreen } from "@/components/screens/GalleryScreen";

export default function GalleryPage() {
  return (
    <>
      {/* SSR route marker — the gallery grid hydrates client-side
          (/api/songs), so the page-contract smoke asserts this shell
          instead of grid copy. Keep in sync with qa-routes gallery-page. */}
      <span hidden>gallery-route</span>
      <GalleryScreen />
    </>
  );
}
