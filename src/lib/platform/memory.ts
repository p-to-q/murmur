"use client";

import type { MemoryActionParams } from "./types";

const STORAGE_KEY = "murmur.memory-events";
const MAX_EVENTS = 200;

function readEvents(): MemoryActionParams[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as MemoryActionParams[]) : [];
  } catch {
    return [];
  }
}

export const memory = {
  async reportAction(params: MemoryActionParams): Promise<void> {
    if (typeof window === "undefined") return;
    const event = {
      ...params,
      platform: params.platform ?? "web",
      timestamp: params.timestamp ?? new Date().toISOString(),
    };
    const next = [event, ...readEvents()].slice(0, MAX_EVENTS);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent("murmur:memory", { detail: event }));
  },
};
