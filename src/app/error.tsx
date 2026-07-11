"use client";

import { RouteErrorScreen } from "@/components/murmur/route-error-screen";

export default function GlobalError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteErrorScreen scope="app" {...props} />;
}
