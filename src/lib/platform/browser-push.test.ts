import { afterEach, describe, expect, it } from "bun:test";
import { unsubscribeBrowserPushLocally } from "./browser-push";

const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");

afterEach(() => {
  restoreGlobal("navigator", originalNavigator);
  restoreGlobal("window", originalWindow);
});

describe("browser push cleanup", () => {
  it("unsubscribes the browser endpoint without an authenticated request", async () => {
    let unsubscribeCalls = 0;
    const subscription = {
      unsubscribe: async () => {
        unsubscribeCalls += 1;
        return true;
      },
    };
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { PushManager: class PushManager {} },
    });
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {
        serviceWorker: {
          getRegistration: async () => ({
            pushManager: { getSubscription: async () => subscription },
          }),
        },
      },
    });

    await unsubscribeBrowserPushLocally();

    expect(unsubscribeCalls).toBe(1);
  });

  it("degrades to a no-op when service workers are unavailable", async () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {},
    });
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {},
    });

    await expect(unsubscribeBrowserPushLocally()).resolves.toBeUndefined();
  });
});

function restoreGlobal(
  key: "navigator" | "window",
  descriptor: PropertyDescriptor | undefined,
): void {
  if (descriptor) {
    Object.defineProperty(globalThis, key, descriptor);
  } else {
    Reflect.deleteProperty(globalThis, key);
  }
}
