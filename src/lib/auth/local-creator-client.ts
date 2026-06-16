"use client";

const STORAGE_KEY = "murmur.local-creator.bootstrapped";

let inflight: Promise<boolean> | null = null;

interface EnsureLocalCreatorSessionOptions {
  background?: boolean;
}

export function hasTriedLocalCreatorBootstrap(): boolean {
  if (typeof window === "undefined") return false;
  return window.sessionStorage.getItem(STORAGE_KEY) === "1";
}

export async function ensureLocalCreatorSession(
  options: EnsureLocalCreatorSessionOptions = {},
): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (options.background && hasTriedLocalCreatorBootstrap()) return true;
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const response = await fetch("/api/auth/local-creator", {
        method: "POST",
        credentials: "include",
        cache: "no-store",
      });
      if (response.ok) {
        window.sessionStorage.setItem(STORAGE_KEY, "1");
        return true;
      }
      return false;
    } catch (error) {
      if (!options.background) {
        console.warn("[local-creator-session]", error);
      }
      return false;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}
