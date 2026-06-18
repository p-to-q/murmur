"use client";

import { useCallback, useEffect, useState } from "react";
import { signIn } from "next-auth/react";
import { toast } from "sonner";

import { ensureLocalCreatorSession } from "@/lib/auth/local-creator-client";
import { useTranslator } from "@/lib/i18n";

export type OAuthProvider = "google" | "github";

export interface AuthProviders {
  google: boolean | null;
  github: boolean | null;
  email: boolean | null;
}

export function useAuthProviders() {
  const t = useTranslator();
  const [providers, setProviders] = useState<AuthProviders>({
    google: null,
    github: null,
    email: null,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/auth/available-providers")
      .then((res) => res.json())
      .then((data: Record<string, boolean>) => {
        if (!cancelled) {
          setProviders({
            google: Boolean(data.google),
            github: Boolean(data.github),
            email: Boolean(data.email),
          });
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setProviders({ google: false, github: false, email: false });
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const signInWithOAuth = useCallback(
    (provider: OAuthProvider, callbackUrl = "/") => {
      if (providers[provider] === false) {
        toast.error(t("auth.google_unavailable"));
        return;
      }
      void (async () => {
        await ensureLocalCreatorSession();
        await signIn(provider, { callbackUrl });
      })();
    },
    [providers, t],
  );

  return { providers, signInWithOAuth, loading };
}
