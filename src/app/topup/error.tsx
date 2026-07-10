"use client";

import { RouteErrorScreen } from "@/components/murmur/route-error-screen";

export default function TopupError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteErrorScreen scope="topup" {...props} />;
}
