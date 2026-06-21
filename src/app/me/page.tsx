import { Suspense } from "react";
import { GlobalLoadingIndicator } from "@/components/murmur/global-loading-indicator";
import { MeScreen } from "@/components/screens/MeScreen";

export default function MePage() {
  return (
    <Suspense fallback={<GlobalLoadingIndicator />}>
      <MeScreen />
    </Suspense>
  );
}
