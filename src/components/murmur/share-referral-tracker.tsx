"use client";

import { useEffect, useRef } from "react";

import {
  claimShareReferral,
  clearRememberedShareReferrer,
  readRememberedShareReferrer,
  rememberShareReferrerFromLocation,
} from "@/lib/api/share-referral";
import { useCurrentAccount } from "@/lib/hooks/use-current-account";
import { fetchUserBalance } from "@/lib/hooks/use-user-balance";

export function ShareReferralTracker() {
  const { user, isRegistered, isLoading } = useCurrentAccount();
  const claimedRef = useRef<string | null>(null);

  useEffect(() => {
    rememberShareReferrerFromLocation();
  }, []);

  useEffect(() => {
    if (isLoading || !isRegistered || !user?.id) return;

    const referrerId = readRememberedShareReferrer();
    if (!referrerId || referrerId === user.id || claimedRef.current === referrerId) {
      return;
    }

    claimedRef.current = referrerId;
    void claimShareReferral(referrerId).then((result) => {
      if (!result.ok) {
        if (isTerminalReferralClaimError(result.error)) {
          clearRememberedShareReferrer();
        }
        return;
      }
      clearRememberedShareReferrer();
      void fetchUserBalance({ force: true });
    });
  }, [isLoading, isRegistered, user?.id]);

  return null;
}

function isTerminalReferralClaimError(error: string | null): boolean {
  return (
    error === "self_referral"
    || error === "invalid_referrer"
    || error === "ineligible_invitee"
    || error === "registration_required"
    || error === "grant_failed"
    || error === "sign_in_required"
  );
}
