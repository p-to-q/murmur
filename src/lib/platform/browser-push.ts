"use client";

export async function getBrowserPushSubscription(): Promise<PushSubscription | null> {
  if (typeof window === "undefined" || typeof navigator === "undefined") return null;
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return null;

  try {
    const registration = await navigator.serviceWorker.getRegistration("/");
    return (await registration?.pushManager.getSubscription()) ?? null;
  } catch {
    return null;
  }
}

/** Remove this browser's push endpoint without requiring an authenticated API. */
export async function unsubscribeBrowserPushLocally(): Promise<void> {
  const subscription = await getBrowserPushSubscription();
  if (!subscription) return;
  await subscription.unsubscribe().catch(() => false);
}
