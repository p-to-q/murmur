"use client";

const STORAGE_KEY = "murmur.local-creator.bootstrapped";

let inflight: Promise<boolean> | null = null;

interface EnsureLocalCreatorSessionOptions {
  background?: boolean;
  force?: boolean;
}

export function hasTriedLocalCreatorBootstrap(): boolean {
  if (typeof window === "undefined") return false;
  return window.sessionStorage.getItem(STORAGE_KEY) === "1";
}

export function clearLocalCreatorBootstrapFlag(): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(STORAGE_KEY);
}

export async function ensureLocalCreatorSession(
  options: EnsureLocalCreatorSessionOptions = {},
): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (options.force) clearLocalCreatorBootstrapFlag();
  if (options.background && !options.force && hasTriedLocalCreatorBootstrap()) return true;
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
        const [{ refreshCurrentAccount }, { fetchUserBalance }] = await Promise.all([
          import("@/lib/hooks/use-current-account"),
          import("@/lib/hooks/use-user-balance"),
        ]);
        const accountResult = await refreshCurrentAccount();
        await fetchUserBalance({ force: true });
        return accountResult.account?.user?.accountKind === "local_creator";
      }
      clearLocalCreatorBootstrapFlag();
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

export function __resetLocalCreatorBootstrapForTesting(): void {
  inflight = null;
  clearLocalCreatorBootstrapFlag();
}
