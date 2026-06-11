"use client";

import dynamic from "next/dynamic";

export const TopupClient = dynamic(
  () => import("@/components/screens/TopupScreen").then((mod) => mod.TopupScreen),
  { ssr: false },
);
