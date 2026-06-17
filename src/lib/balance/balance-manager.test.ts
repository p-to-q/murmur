import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { getLocalBalance, spendLocalNotes } from "./balance-manager";

const originalLocalStorageDescriptor = Object.getOwnPropertyDescriptor(
  globalThis,
  "localStorage",
);

class MemoryStorage implements Storage {
  private values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return Array.from(this.values.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

describe("local creator balance", () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: new MemoryStorage(),
    });
  });

  afterEach(() => {
    if (originalLocalStorageDescriptor) {
      Object.defineProperty(globalThis, "localStorage", originalLocalStorageDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, "localStorage");
    }
  });

  it("grants exactly five local notes once", () => {
    expect(getLocalBalance()).toMatchObject({
      notes: 5,
      freeLimit: 5,
      nextRefillAt: null,
    });

    expect(spendLocalNotes(3)).toBe(true);
    expect(getLocalBalance().notes).toBe(2);
  });

  it("does not refill from the old daily date key", () => {
    localStorage.setItem("murmur-local-balance", "0");
    localStorage.setItem("murmur-local-balance-date", "yesterday");

    expect(getLocalBalance()).toMatchObject({
      notes: 0,
      freeLimit: 5,
      nextRefillAt: null,
    });
    expect(localStorage.getItem("murmur-local-balance-date")).toBeNull();
  });

  it("clamps invalid stored values back into the local free range", () => {
    localStorage.setItem("murmur-local-balance", "99");
    expect(getLocalBalance().notes).toBe(5);

    localStorage.setItem("murmur-local-balance", "-3");
    expect(getLocalBalance().notes).toBe(0);

    localStorage.setItem("murmur-local-balance", "nope");
    expect(getLocalBalance().notes).toBe(5);
  });
});
