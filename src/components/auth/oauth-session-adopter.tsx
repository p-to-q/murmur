"use client";

import { useEffect, useRef } from "react";
import { useSession } from "next-auth/react";

import { refreshCurrentAccount } from "@/lib/hooks/use-current-account";
import { fetchUserBalance } from "@/lib/hooks/use-user-balance";
import { notifyMurmurSessionReady } from "@/lib/auth/session-events";

export function OAuthSessionAdopter() {
  const { data: session, status } = useSession();
  const adoptedUserRef = useRef<string | null>(null);
  const userId = (session?.user as { id?: string } | undefined)?.id ?? null;

  useEffect(() => {
    if (status !== "authenticated" || !userId || userId === "guest") return;
    if (adoptedUserRef.current === userId) return;

    adoptedUserRef.current = userId;
    void (async () => {
      const response = await fetch("/api/auth/oauth/adopt", {
        method: "POST",
        credentials: "include",
        cache: "no-store",
      });
      if (!response.ok) {
        adoptedUserRef.current = null;
        return;
      }
      notifyMurmurSessionReady();
      await refreshCurrentAccount();
      await fetchUserBalance({ force: true });
    })();
  }, [status, userId]);

  return null;
}
