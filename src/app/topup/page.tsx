import type { Metadata } from "next";
import { TopupClient } from "./TopupClient";

export const metadata: Metadata = {
  title: "Top Up",
  description: "Purchase additional notes to keep creating and sharing your songs.",
  openGraph: {
    title: "Top Up",
    description: "Purchase additional notes to keep creating and sharing your songs.",
    url: "/topup",
    images: [{ url: "/og?title=Top+Up&subtitle=Purchase+additional+notes", width: 1200, height: 630 }],
  },
  twitter: {
    title: "Top Up",
    description: "Purchase additional notes to keep creating and sharing your songs.",
    images: ["/og?title=Top+Up&subtitle=Purchase+additional+notes"],
  },
  alternates: {
    canonical: "/topup",
  },
};

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
