"use client";

import dynamic from "next/dynamic";
import { GlobalLoadingIndicator } from "@/components/murmur/global-loading-indicator";

const CheckoutScreen = dynamic(
  () => import("@/components/screens/CheckoutScreen").then((mod) => mod.CheckoutScreen),
  { loading: () => <GlobalLoadingIndicator />, ssr: false },
);

export default function CheckoutClient() {
  return <CheckoutScreen />;
}
