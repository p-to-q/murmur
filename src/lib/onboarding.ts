"use client";

export const HUM_ONBOARDING_SEEN_STORAGE_KEY = "murmur:onboarding-seen";
export const HUM_ONBOARDING_COMPLETE_EVENT = "murmur:onboarding-complete";

export function hasSeenHumOnboarding() {
  if (typeof window === "undefined") return false;
  try {
    return !!window.localStorage.getItem(HUM_ONBOARDING_SEEN_STORAGE_KEY);
  } catch {
    return false;
  }
}

export function writeHumOnboardingSeen() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(HUM_ONBOARDING_SEEN_STORAGE_KEY, "1");
  } catch {}
  window.dispatchEvent(new Event(HUM_ONBOARDING_COMPLETE_EVENT));
}
