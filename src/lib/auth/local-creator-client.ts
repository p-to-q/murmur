"use client";

interface EnsureLocalCreatorSessionOptions {
  background?: boolean;
}

/**
 * Best-effort bridge for routes that want a local creator session before
 * fetching user-owned resources. The server keeps guest/demo fallbacks, so
 * callers can safely continue when this endpoint is unavailable.
 */
export async function ensureLocalCreatorSession(
  options: EnsureLocalCreatorSessionOptions = {},
): Promise<boolean> {
  if (typeof window === "undefined") return false;

  try {
    const response = await fetch("/api/auth/local-creator", {
      method: "POST",
      credentials: "include",
      cache: "no-store",
    });
    return response.ok;
  } catch (error) {
    if (!options.background) {
      console.warn("[local-creator-session]", error);
    }
    return false;
  }
}
