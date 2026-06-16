"use client";

const STORAGE_KEY = "murmur.local-creator.bootstrapped";

let inflight: Promise<boolean> | null = null;

export function hasTriedLocalCreatorBootstrap(): boolean {
  if (typeof window === "undefined") return false;
  return window.sessionStorage.getItem(STORAGE_KEY) === "1";
}

export async function ensureLocalCreatorSession(
  options: { background?: boolean } = {},
): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (options.background && hasTriedLocalCreatorBootstrap()) return true;
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const response = await fetch("/api/auth/local-creator", {
        method: "POST",
        credentials: "same-origin",
      });
      if (response.ok) {
        window.sessionStorage.setItem(STORAGE_KEY, "1");
        return true;
      }
      return false;
    } catch {
      return false;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}
