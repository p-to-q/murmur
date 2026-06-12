import { describe, expect, it } from "bun:test";

import { shouldUseDevBalanceFallback } from "./dev-balance";

describe("shouldUseDevBalanceFallback", () => {
  it("allows explicit production opt-in via env flag", () => {
    const prev = process.env.MURMUR_ALLOW_DEV_BILLING_FALLBACK;
    process.env.NODE_ENV = "production";
    process.env.MURMUR_ALLOW_DEV_BILLING_FALLBACK = "1";

    try {
      expect(shouldUseDevBalanceFallback({ host: "murmur.ptoq.io" })).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.MURMUR_ALLOW_DEV_BILLING_FALLBACK;
      else process.env.MURMUR_ALLOW_DEV_BILLING_FALLBACK = prev;
    }
  });

  it("still allows loopback hosts outside development", () => {
    const prevNode = process.env.NODE_ENV;
    const prevFlag = process.env.MURMUR_ALLOW_DEV_BILLING_FALLBACK;
    process.env.NODE_ENV = "production";
    delete process.env.MURMUR_ALLOW_DEV_BILLING_FALLBACK;

    try {
      expect(shouldUseDevBalanceFallback({ host: "127.0.0.1" })).toBe(true);
    } finally {
      process.env.NODE_ENV = prevNode;
      if (prevFlag === undefined) delete process.env.MURMUR_ALLOW_DEV_BILLING_FALLBACK;
      else process.env.MURMUR_ALLOW_DEV_BILLING_FALLBACK = prevFlag;
    }
  });
});
