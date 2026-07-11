"use client";

import { RouteErrorScreen } from "@/components/murmur/route-error-screen";

export default function SongError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteErrorScreen scope="song" {...props} />;
}
