"use client";

const STORAGE_KEY = "murmur.notifications-subscribed";

function readSubscribed(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(STORAGE_KEY) === "true";
}

function writeSubscribed(subscribed: boolean) {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(STORAGE_KEY, String(subscribed));
  }
  return { subscribed };
}

export const notificationsClient = {
  async isSubscribed() {
    return { subscribed: readSubscribed() };
  },
  async subscribe() {
    return writeSubscribed(true);
  },
  async unsubscribe() {
    return writeSubscribed(false);
  },
};
