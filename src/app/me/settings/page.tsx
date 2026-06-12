import { Suspense } from "react";
import { GlobalLoadingIndicator } from "@/components/murmur/global-loading-indicator";
import { SettingsScreen } from "@/components/screens/SettingsScreen";

export default function SettingsPage() {
  return (
    <Suspense fallback={<GlobalLoadingIndicator />}>
      <SettingsScreen />
    </Suspense>
  );
}
