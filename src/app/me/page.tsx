import { Suspense } from "react";
import { MeScreen } from "@/components/screens/MeScreen";

export default function MePage() {
  return (
    <Suspense fallback={null}>
      <MeScreen />
    </Suspense>
  );
}
