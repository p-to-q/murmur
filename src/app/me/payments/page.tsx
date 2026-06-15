import { Suspense } from "react";
import { GlobalLoadingIndicator } from "@/components/murmur/global-loading-indicator";
import { PaymentsScreen } from "@/components/screens/PaymentsScreen";

export default function PaymentsPage() {
  return (
    <Suspense fallback={<GlobalLoadingIndicator />}>
      <PaymentsScreen />
    </Suspense>
  );
}
