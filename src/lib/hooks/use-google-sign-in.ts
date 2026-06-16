"use client";

import { useCallback, useEffect, useState } from "react";
import { signIn } from "next-auth/react";
import { toast } from "sonner";

import { ensureLocalCreatorSession } from "@/lib/auth/local-creator-client";
import { useTranslator } from "@/lib/i18n";

export function useGoogleSignIn() {
  const t = useTranslator();
  const [available, setAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/auth/providers")
      .then((res) => res.json())
      .then((providers: Record<string, unknown>) => {
        if (!cancelled) setAvailable(Boolean(providers.google));
      })
      .catch(() => {
        if (!cancelled) setAvailable(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const signInWithGoogle = useCallback(
    (callbackUrl = "/") => {
      if (available === false) {
        toast.error(t("auth.google_unavailable"));
        return;
      }
      void (async () => {
        await ensureLocalCreatorSession();
        await signIn("google", { callbackUrl });
      })();
    },
    [available, t],
  );

  return { signInWithGoogle, googleAuthAvailable: available };
}
