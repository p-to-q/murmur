"use client";

import { useEffect } from "react";
import { useSession } from "next-auth/react";
import { ensureLocalCreatorSession } from "@/lib/auth/local-creator-client";

export function LocalCreatorBootstrap() {
  const { status } = useSession();

  useEffect(() => {
    if (status !== "unauthenticated") return;
    if (typeof window === "undefined") return;

    void ensureLocalCreatorSession({ background: true }).catch(() => {
      // Local Creator creation is a resilience improvement, not a hard boot
      // requirement. The existing guest fallback keeps the demo path alive.
    });
  }, [status]);

  return null;
}
