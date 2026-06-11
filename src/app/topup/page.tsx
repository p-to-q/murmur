import { TopupClient } from "./TopupClient";

/**
 * /topup — the *renew* moment.
 *
 * Specced in docs/page-redesign.md §9 + docs/payment-topup-feature.md §5.1.
 * The screen reads `useUserBalance()` for the current notes count and
 * navigates to /topup/checkout?sku=… on confirm.
 */
export default function TopupPage() {
  return <TopupClient />;
}
