import type { NextRequest } from "next/server";
import { getRequestHostname } from "@/lib/auth/local-preview";
import { shouldBypassBillingInDevelopment } from "@/lib/billing/dev-balance";
import { isObject } from "@/lib/utils/is-object";

/**
 * Shared DB-outage detection for the song routes (collection, item, share).
 *
 * These used to be copy-pasted per route, which is exactly the kind of code
 * that gets fixed in one copy and not the others — a missed ECONNREFUSED
 * shape here means one route falls back to the local store while its
 * siblings 500.
 */
export function isDatabaseUnavailable(error: unknown): boolean {
  if (!isObject(error)) return false;

  const code = "code" in error ? error.code : null;
  if (code === "ECONNREFUSED") return true;

  const message = "message" in error ? String(error.message) : "";
  if (message.includes("ECONNREFUSED") || message.includes("connection refused")) {
    return true;
  }

  const cause = "cause" in error ? error.cause : null;
  if (cause && isDatabaseUnavailable(cause)) return true;

  const nestedErrors = "errors" in error ? error.errors : null;
  if (Array.isArray(nestedErrors)) {
    return nestedErrors.some((nestedError) => isDatabaseUnavailable(nestedError));
  }

  return false;
}

export function objectFieldAsString(value: unknown, key: string): string | undefined {
  if (!isObject(value) || !(key in value)) return undefined;
  const field = value[key];
  return typeof field === "string" ? field : String(field);
}

/**
 * Guest-only local-store fallback, used by the item and share routes when the
 * dev database is down. Deliberately narrower than the collection route's
 * fallback (which also honors local_header and dev local-creator sessions) —
 * owner-scoped mutations must never silently degrade for real accounts.
 */
export function shouldUseGuestSongFallback(req: NextRequest, userId: string): boolean {
  if (userId !== "guest") return false;
  return shouldBypassBillingInDevelopment({
    host: getRequestHostname(req),
  });
}

