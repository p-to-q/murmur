"use client";

import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";

export type MurmurNotificationKind =
  | "song_generated"
  | "song_saved"
  | "system";

export type MurmurNotification = {
  id: string;
  kind: MurmurNotificationKind;
  title: string;
  body: string;
  href?: string;
  createdAt: number;
  readAt?: number;
  sourceId?: string;
};

type NotificationInput = Omit<MurmurNotification, "id" | "createdAt"> & {
  id?: string;
  createdAt?: number;
};

type NotificationStore = {
  items: MurmurNotification[];
  browserAlertsEnabled: boolean;
  addNotification: (input: NotificationInput) => MurmurNotification;
  markRead: (id: string) => void;
  markAllRead: () => void;
  clearAll: () => void;
  setBrowserAlertsEnabled: (enabled: boolean) => void;
};

const MAX_NOTIFICATIONS = 24;
const noopStorage: StateStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};

function fallbackId(kind: MurmurNotificationKind, sourceId?: string) {
  if (sourceId) return `${kind}:${sourceId}`;
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${kind}:${Date.now()}:${Math.random().toString(16).slice(2)}`;
}

export const useNotificationStore = create<NotificationStore>()(
  persist(
    (set) => ({
      items: [],
      browserAlertsEnabled: false,
      addNotification: (input) => {
        const notification: MurmurNotification = {
          ...input,
          id: input.id ?? fallbackId(input.kind, input.sourceId),
          createdAt: input.createdAt ?? Date.now(),
        };

        set((state) => {
          const existing = state.items.filter((item) => item.id !== notification.id);
          return {
            items: [notification, ...existing].slice(0, MAX_NOTIFICATIONS),
          };
        });

        return notification;
      },
      markRead: (id) =>
        set((state) => ({
          items: state.items.map((item) =>
            item.id === id && !item.readAt
              ? { ...item, readAt: Date.now() }
              : item,
          ),
        })),
      markAllRead: () =>
        set((state) => {
          const readAt = Date.now();
          return {
            items: state.items.map((item) =>
              item.readAt ? item : { ...item, readAt },
            ),
          };
        }),
      clearAll: () => set({ items: [] }),
      setBrowserAlertsEnabled: (enabled) =>
        set({ browserAlertsEnabled: enabled }),
    }),
    {
      name: "murmur-notifications",
      storage: createJSONStorage(() =>
        typeof window === "undefined" ? noopStorage : localStorage,
      ),
      partialize: (state) => ({
        items: state.items,
        browserAlertsEnabled: state.browserAlertsEnabled,
      }),
      version: 1,
    },
  ),
);

export function addMurmurNotification(input: NotificationInput) {
  return useNotificationStore.getState().addNotification(input);
}

export function isBrowserAlertPreferenceEnabled() {
  return useNotificationStore.getState().browserAlertsEnabled;
}
