import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import {
  clearAccountScopedDeviceData,
  completeAccountExit,
} from "./account-exit";
import { useMurmurStore } from "@/lib/store/murmur-store";
import { useNotificationStore } from "@/lib/store/notification-store";

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

describe("account-exit device cleanup", () => {
  let localStorage: MemoryStorage;
  let sessionStorage: MemoryStorage;

  beforeEach(() => {
    localStorage = new MemoryStorage();
    sessionStorage = new MemoryStorage();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { localStorage, sessionStorage },
    });
    useNotificationStore.setState({
      items: [
        {
          id: "notification-1",
          kind: "system",
          title: "Private result",
          body: "Generation complete",
          createdAt: 1,
        },
      ],
      browserAlertsEnabled: true,
    });
    useMurmurStore.getState().setCurrentFlowId("flow-account-1");
    localStorage.setItem("murmur-creation-draft-v1", "sensitive draft");
    localStorage.setItem(
      "murmur.memory-events",
      JSON.stringify([{ action: "hum" }]),
    );
    localStorage.setItem("murmur.local-user", JSON.stringify({ id: "user-1" }));
    sessionStorage.setItem("murmur.checkout.baseline.v1", "account balance");
    sessionStorage.setItem("murmur.local-creator.bootstrapped", "1");
  });

  afterEach(() => {
    useNotificationStore.setState({ items: [], browserAlertsEnabled: false });
    void useMurmurStore.getState().resetFlow();
    if (originalWindow) {
      Object.defineProperty(globalThis, "window", originalWindow);
    } else {
      Reflect.deleteProperty(globalThis, "window");
    }
  });

  it("clears account-scoped data while preserving preferences", async () => {
    expect(localStorage.getItem("murmur-creation-draft-v1")).not.toBeNull();

    const result = await clearAccountScopedDeviceData();

    expect(localStorage.getItem("murmur-creation-draft-v1")).toBeNull();
    expect(localStorage.getItem("murmur.memory-events")).toBeNull();
    expect(localStorage.getItem("murmur.local-user")).toBeNull();
    expect(sessionStorage.getItem("murmur.checkout.baseline.v1")).toBeNull();
    expect(
      sessionStorage.getItem("murmur.local-creator.bootstrapped"),
    ).toBeNull();
    expect(useMurmurStore.getState().currentFlowId).toBeNull();
    expect(useNotificationStore.getState().items).toEqual([]);
    expect(useNotificationStore.getState().browserAlertsEnabled).toBe(true);
    expect(result.succeeded).toEqual([
      "notification-items",
      "memory-events",
      "account-storage",
      "browser-push",
    ]);
    expect(result.failed.map(({ step }) => step)).toEqual([
      "creation-data",
      "last-recording",
    ]);
  });

  it("attempts every cleanup when one browser store fails", async () => {
    const calls: string[] = [];

    const result = await clearAccountScopedDeviceData({
      clearCreationData: () => {
        calls.push("creation");
        throw new Error("storage unavailable");
      },
      clearLastRecording: async () => {
        calls.push("recording");
      },
      clearNotificationItems: () => {
        calls.push("notifications");
      },
      clearMemoryEvents: () => {
        calls.push("memory");
      },
      clearAccountStorage: () => {
        calls.push("account-storage");
      },
      unsubscribeBrowserPush: () => {
        calls.push("push");
      },
    });

    expect(calls).toEqual([
      "creation",
      "recording",
      "notifications",
      "memory",
      "account-storage",
      "push",
    ]);
    expect(result.succeeded).toEqual([
      "last-recording",
      "notification-items",
      "memory-events",
      "account-storage",
      "browser-push",
    ]);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]).toMatchObject({ step: "creation-data" });
    expect(result.failed[0]?.reason).toBeInstanceOf(Error);
  });

  it("reports a false cleanup outcome as an observable failure", async () => {
    const result = await clearAccountScopedDeviceData({
      clearCreationData: () => true,
      clearLastRecording: () => false,
      clearNotificationItems: () => true,
      clearMemoryEvents: () => true,
      clearAccountStorage: () => true,
      unsubscribeBrowserPush: () => true,
    });

    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]).toMatchObject({ step: "last-recording" });
  });

  it("never clears device data when the account exit fails", async () => {
    let cleanupCalls = 0;

    await expect(
      completeAccountExit(
        async () => {
          throw new Error("logout failed");
        },
        async () => {
          cleanupCalls += 1;
          return { succeeded: [], failed: [] };
        },
      ),
    ).rejects.toThrow("logout failed");

    expect(cleanupCalls).toBe(0);
  });

  it("keeps a successful server exit successful when local cleanup fails", async () => {
    const result = await completeAccountExit(
      async () => {},
      async () => ({
        succeeded: ["memory-events"],
        failed: [
          {
            step: "last-recording",
            reason: new Error("IndexedDB unavailable"),
          },
        ],
      }),
    );

    expect(result.serverExitSucceeded).toBe(true);
    expect(result.deviceCleanup.succeeded).toEqual(["memory-events"]);
    expect(result.deviceCleanup.failed[0]).toMatchObject({
      step: "last-recording",
    });
  });

  it("converts an unexpected device cleanup rejection into local evidence", async () => {
    const result = await completeAccountExit(
      async () => {},
      async () => {
        throw new Error("cleanup crashed");
      },
    );

    expect(result).toMatchObject({
      serverExitSucceeded: true,
      deviceCleanup: {
        succeeded: [],
        failed: [{ step: "device-cleanup" }],
      },
    });
  });
});
