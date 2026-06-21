"use client";

import dynamic from "next/dynamic";
import { GlobalLoadingIndicator } from "@/components/murmur/global-loading-indicator";

export const TopupClient = dynamic(
  () => import("@/components/screens/TopupScreen").then((mod) => mod.TopupScreen),
  { loading: () => <GlobalLoadingIndicator />, ssr: false },
);
