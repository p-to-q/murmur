"use client";

import { useSyncExternalStore } from "react";
import type { AppUser, DevicePlatform } from "./types";

const STORAGE_KEY = "murmur.local-user";
const DEFAULT_USER: AppUser = {
  id: "guest",
  email: null,
  name: "Local Creator",
  avatarUrl: null,
};

interface PlatformState {
  auth: {
    user: AppUser;
    loading: false;
    authenticated: true;
  };
  device: {
    platform: DevicePlatform;
  };
}

const listeners = new Set<() => void>();
let currentUser = DEFAULT_USER;

function getPlatform(): DevicePlatform {
  if (typeof navigator === "undefined") return "web";
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes("miniprogram")) return "mini-program";
  if (ua.includes("iphone") || ua.includes("ipad")) return "ios";
  if (ua.includes("android")) return "android";
  return "web";
}

function loadUser(): AppUser {
  if (typeof window === "undefined") return DEFAULT_USER;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? { ...DEFAULT_USER, ...JSON.parse(raw) } : DEFAULT_USER;
  } catch {
    return DEFAULT_USER;
  }
}

function saveUser(user: AppUser) {
  currentUser = user;
  if (typeof window !== "undefined") {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
  }
  for (const listener of listeners) listener();
}

function getSnapshot(): PlatformState {
  if (typeof window !== "undefined") {
    currentUser = loadUser();
  }
  return {
    auth: {
      user: currentUser,
      loading: false,
      authenticated: true,
    },
    device: {
      platform: getPlatform(),
    },
  };
}

const serverSnapshot: PlatformState = {
  auth: {
    user: DEFAULT_USER,
    loading: false,
    authenticated: true,
  },
  device: {
    platform: "web",
  },
};

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function usePlatformState<T>(selector: (state: PlatformState) => T): T {
  return useSyncExternalStore(
    subscribe,
    () => selector(getSnapshot()),
    () => selector(serverSnapshot),
  );
}

export function useCurrentUser(): AppUser {
  return usePlatformState((state) => state.auth.user);
}

export const authClient = {
  get user() {
    return getSnapshot().auth.user;
  },
  get loading() {
    return false;
  },
  get authenticated() {
    return true;
  },
  async login() {
    saveUser(loadUser());
    return currentUser;
  },
  async logout() {
    saveUser(DEFAULT_USER);
  },
  async getSessionHeader() {
    return null;
  },
  getRequestHeaders(): Record<string, string> {
    const user = loadUser();
    return {
      "x-murmur-user-id": user.id,
      ...(user.email ? { "x-murmur-user-email": user.email } : {}),
      ...(user.name ? { "x-murmur-user-name": user.name } : {}),
      ...(user.avatarUrl ? { "x-murmur-user-avatar": user.avatarUrl } : {}),
    };
  },
};
