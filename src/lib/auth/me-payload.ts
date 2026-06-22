import { resolveEntitlement } from "@murmur/core";
import { nextNotesRefillAt } from "@/lib/billing/notes-clock";
import type { RequestAuthSource } from "@/lib/platform/server-auth";
import type { AppUser } from "@/lib/platform/types";

export interface AuthMePayloadInput {
  user: AppUser;
  source: RequestAuthSource;
  sessionId: string | null;
  identityProviders?: string[];
  balance: {
    notes: number;
    accountNotes?: number;
    dailyFreeNotes?: number;
    planTier: "free" | "premium";
  };
  now?: Date;
}

export function buildAuthMePayload(input: AuthMePayloadInput) {
  const authenticated =
    input.source !== "guest" && input.user.accountKind !== "local_creator";
  const entitlementUser = {
    id: input.user.id,
    planTier: input.balance.planTier,
    isAuthenticated: authenticated,
    accountKind: input.user.accountKind ?? null,
  };
  const entitlementSubject = input.source === "guest" ? null : entitlementUser;

  return {
    user: input.user,
    source: input.source,
    authenticated,
    sessionId: input.sessionId,
    identityProviders: input.identityProviders ?? [],
    balance: {
      notes: input.balance.notes,
      accountNotes: input.balance.accountNotes ?? input.balance.notes,
      dailyFreeNotes: input.balance.dailyFreeNotes ?? 0,
      planTier: input.balance.planTier,
      nextRefillAt: nextNotesRefillAt(input.now).toISOString(),
    },
    entitlement: resolveEntitlement(entitlementSubject, input.balance.notes),
  };
}
