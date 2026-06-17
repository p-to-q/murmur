import { request } from "@/lib/api/request";
import {
  SHARE_REFERRAL_COOKIE,
  SHARE_REFERRAL_STORAGE_KEY,
} from "@/lib/api/share-referral-constants";

export {
  SHARE_REFERRAL_COOKIE,
  SHARE_REFERRAL_STORAGE_KEY,
} from "@/lib/api/share-referral-constants";

export function rememberShareReferrerFromLocation(): string | null {
  if (typeof window === "undefined") return null;

  const referrerId = sanitizeReferrerId(
    new URLSearchParams(window.location.search).get("ref"),
  );
  if (!referrerId) return null;

  window.localStorage.setItem(SHARE_REFERRAL_STORAGE_KEY, referrerId);
  document.cookie = `${SHARE_REFERRAL_COOKIE}=${encodeURIComponent(referrerId)}; Path=/; Max-Age=${60 * 60 * 24 * 30}; SameSite=Lax`;
  return referrerId;
}

export function readRememberedShareReferrer(): string | null {
  if (typeof window === "undefined") return null;
  return sanitizeReferrerId(window.localStorage.getItem(SHARE_REFERRAL_STORAGE_KEY));
}

export function clearRememberedShareReferrer(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(SHARE_REFERRAL_STORAGE_KEY);
  document.cookie = `${SHARE_REFERRAL_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
}

export async function claimShareReferral(referrerId: string): Promise<boolean> {
  const response = await request("/api/share/claim", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ referrerId }),
  });
  return response.ok;
}

function sanitizeReferrerId(value: string | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed || trimmed === "share") return null;
  return /^[A-Za-z0-9_-]{6,128}$/.test(trimmed) ? trimmed : null;
}
