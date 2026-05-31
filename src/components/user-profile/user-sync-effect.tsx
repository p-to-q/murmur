"use client";

import { useEffect } from "react";
import { authClient, usePlatformState } from "@/lib/platform/auth-client";

/**
 * Standalone profile sync. This keeps the local users table warm without tying
 * the app to a platform-specific auth bridge.
 */
export function UserSyncEffect() {
  const user = usePlatformState((s) => s.auth.user);

  useEffect(() => {
    (async () => {
      try {
        await fetch("/api/user/profile", {
          headers: authClient.getRequestHeaders(),
        });
      } catch (err) {
        console.error("[UserSyncEffect] profile fetch failed", err);
      }
    })();
  }, [user.id]);

  return null;
}
