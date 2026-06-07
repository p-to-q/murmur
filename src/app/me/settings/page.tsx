import { Suspense } from "react";
import { SettingsScreen } from "@/components/screens/SettingsScreen";

export default function SettingsPage() {
  return (
    <Suspense fallback={null}>
      <SettingsScreen />
    </Suspense>
  );
}
