"use client";

import { useEffect, useRef } from "react";
import { useSession } from "next-auth/react";

import {
  claimShareReferral,
  clearRememberedShareReferrer,
  readRememberedShareReferrer,
  rememberShareReferrerFromLocation,
} from "@/lib/api/share-referral";
import { fetchUserBalance } from "@/lib/hooks/use-user-balance";

export function ShareReferralTracker() {
  const { data: session, status } = useSession();
  const claimedRef = useRef<string | null>(null);

  useEffect(() => {
    rememberShareReferrerFromLocation();
  }, []);

  useEffect(() => {
    if (status !== "authenticated" || !session?.user?.id) return;

    const referrerId = readRememberedShareReferrer();
    if (!referrerId || referrerId === session.user.id || claimedRef.current === referrerId) {
      return;
    }

    claimedRef.current = referrerId;
    void claimShareReferral(referrerId).then((ok) => {
      if (!ok) return;
      clearRememberedShareReferrer();
      void fetchUserBalance({ force: true });
    });
  }, [session?.user?.id, status]);

  return null;
}
