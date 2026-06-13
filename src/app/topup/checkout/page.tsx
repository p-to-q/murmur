import { Suspense } from "react";
import { CheckoutScreen } from "@/components/screens/CheckoutScreen";

/**
 * /topup/checkout — provider handoff.
 *
 * Specced in docs/page-redesign.md §10. Reads `?sku=…` from the query
 * string; v2 v0 short-circuits to success after 1.4s so the routing UX is
 * testable before Waffo keys are configured (dev simulates the return leg).
 *
 * Wrapped in Suspense because `useSearchParams` requires it under the
 * Next.js App Router static prerender contract.
 */
export default function CheckoutPage() {
  return (
    <Suspense fallback={null}>
      <CheckoutScreen />
    </Suspense>
  );
}
