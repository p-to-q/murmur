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
let currentPlatform: DevicePlatform = "web";
let currentSnapshot = buildSnapshot(currentUser, currentPlatform);

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

function sameUser(a: AppUser, b: AppUser): boolean {
  return (
    a.id === b.id &&
    (a.email ?? null) === (b.email ?? null) &&
    (a.name ?? null) === (b.name ?? null) &&
    (a.avatarUrl ?? null) === (b.avatarUrl ?? null)
  );
}

function buildSnapshot(user: AppUser, platform: DevicePlatform): PlatformState {
  return {
    auth: {
      user,
      loading: false,
      authenticated: true,
    },
    device: {
      platform,
    },
  };
}

function updateSnapshot(user: AppUser, platform: DevicePlatform): PlatformState {
  if (sameUser(currentUser, user) && currentPlatform === platform) {
    return currentSnapshot;
  }

  currentUser = sameUser(currentUser, user) ? currentUser : user;
  currentPlatform = platform;
  currentSnapshot = buildSnapshot(currentUser, currentPlatform);
  return currentSnapshot;
}

function saveUser(user: AppUser) {
  updateSnapshot(user, getPlatform());
  if (typeof window !== "undefined") {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
  }
  for (const listener of listeners) listener();
}

function getSnapshot(): PlatformState {
  return updateSnapshot(
    typeof window !== "undefined" ? loadUser() : currentUser,
    getPlatform(),
  );
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
  const state = useSyncExternalStore(
    subscribe,
    getSnapshot,
    () => serverSnapshot,
  );
  return selector(state);
}

export function useCurrentUser(): AppUser {
  return usePlatformState((state) => state.auth.user);
}

export type SessionLogoutErrorCode = "http_error" | "network_error";

export class SessionLogoutError extends Error {
  readonly code: SessionLogoutErrorCode;
  readonly status: number;

  constructor(code: SessionLogoutErrorCode, message: string, status = 0) {
    super(message);
    this.name = "SessionLogoutError";
    this.code = code;
    this.status = status;
  }
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
    await revokeMurmurSession();
    saveUser(DEFAULT_USER);
  },
  setUser(partial: Partial<AppUser>) {
    saveUser({ ...loadUser(), ...partial });
  },
  async getSessionHeader() {
    return null;
  },
  getRequestHeaders(): Record<string, string> {
    const mode = process.env.NEXT_PUBLIC_MURMUR_AUTH_MODE?.trim().toLowerCase();
    if (mode !== "local") return {};

    const user = loadUser();
    return {
      "x-murmur-user-id": user.id,
      ...(user.email ? { "x-murmur-user-email": user.email } : {}),
      ...(user.name ? { "x-murmur-user-name": user.name } : {}),
      ...(user.avatarUrl ? { "x-murmur-user-avatar": user.avatarUrl } : {}),
    };
  },
};

async function revokeMurmurSession(): Promise<void> {
  if (typeof window === "undefined") return;

  let response: Response;
  try {
    response = await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "same-origin",
    });
  } catch (error) {
    throw new SessionLogoutError(
      "network_error",
      error instanceof Error
        ? `Could not reach the logout endpoint: ${error.message}`
        : "Could not reach the logout endpoint",
    );
  }

  if (!response.ok) {
    throw new SessionLogoutError(
      "http_error",
      `Logout endpoint returned HTTP ${response.status}`,
      response.status,
    );
  }
}
