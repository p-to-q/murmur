"use client";

import { RouteErrorScreen } from "@/components/murmur/route-error-screen";

export default function MeError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteErrorScreen scope="me" {...props} />;
}
