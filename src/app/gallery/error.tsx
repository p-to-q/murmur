"use client";

import { RouteErrorScreen } from "@/components/murmur/route-error-screen";

export default function GalleryError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteErrorScreen scope="gallery" {...props} />;
}
