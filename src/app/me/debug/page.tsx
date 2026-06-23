import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { DebugClient } from "./DebugClient";
import { resolveRequestAuth } from "@/lib/auth";
import { requireDebugSurfaceAccess } from "@/lib/observability/debug-surface";

export const metadata = {
  title: "Debug | Murmur",
  robots: {
    index: false,
    follow: false,
  },
};

export default async function DebugPage() {
  const request = await buildDebugPageRequest();
  const gate = await requireDebugSurfaceAccess(request, resolveRequestAuth);
  if (gate) {
    notFound();
  }

  return (
    <>
      <div className="sr-only" aria-hidden="true">
        Murmur / Debug Loading debug surface
      </div>
      <DebugClient />
    </>
  );
}

async function buildDebugPageRequest(): Promise<Request> {
  const headerStore = await headers();
  const requestHeaders = new Headers(headerStore);
  const host = headerStore.get("host") ?? "localhost";
  const protocol = headerStore.get("x-forwarded-proto") ?? "https";
  return new Request(`${protocol}://${host}/me/debug`, {
    headers: requestHeaders,
  });
}
