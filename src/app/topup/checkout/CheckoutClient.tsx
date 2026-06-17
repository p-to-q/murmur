"use client";

import dynamic from "next/dynamic";

const CheckoutScreen = dynamic(
  () => import("@/components/screens/CheckoutScreen").then((mod) => mod.CheckoutScreen),
  { ssr: false },
);

export default function CheckoutClient() {
  return <CheckoutScreen />;
}
