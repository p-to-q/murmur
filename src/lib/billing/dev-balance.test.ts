import { describe, expect, it } from "bun:test";

import { shouldUseDevBalanceFallback } from "./dev-balance";

describe("shouldUseDevBalanceFallback", () => {
  it("refuses explicit opt-in in production runtime", () => {
    const prevNode = process.env.NODE_ENV;
    const prevVercelEnv = process.env.VERCEL_ENV;
    const prev = process.env.MURMUR_ALLOW_DEV_BILLING_FALLBACK;
    process.env.NODE_ENV = "production";
    delete process.env.VERCEL_ENV;
    process.env.MURMUR_ALLOW_DEV_BILLING_FALLBACK = "1";

    try {
      expect(shouldUseDevBalanceFallback({ host: "murmur.ptoq.io" })).toBe(false);
    } finally {
      if (prevNode === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prevNode;
      if (prevVercelEnv === undefined) delete process.env.VERCEL_ENV;
      else process.env.VERCEL_ENV = prevVercelEnv;
      if (prev === undefined) delete process.env.MURMUR_ALLOW_DEV_BILLING_FALLBACK;
      else process.env.MURMUR_ALLOW_DEV_BILLING_FALLBACK = prev;
    }
  });

  it("allows loopback fallback for local production-build previews", () => {
    const prevNode = process.env.NODE_ENV;
    const prevVercelEnv = process.env.VERCEL_ENV;
    const prevFlag = process.env.MURMUR_ALLOW_DEV_BILLING_FALLBACK;
    process.env.NODE_ENV = "production";
    delete process.env.VERCEL_ENV;
    delete process.env.MURMUR_ALLOW_DEV_BILLING_FALLBACK;

    try {
      expect(shouldUseDevBalanceFallback({ host: "127.0.0.1" })).toBe(true);
    } finally {
      if (prevNode === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prevNode;
      if (prevVercelEnv === undefined) delete process.env.VERCEL_ENV;
      else process.env.VERCEL_ENV = prevVercelEnv;
      if (prevFlag === undefined) delete process.env.MURMUR_ALLOW_DEV_BILLING_FALLBACK;
      else process.env.MURMUR_ALLOW_DEV_BILLING_FALLBACK = prevFlag;
    }
  });

  it("refuses production runtime fallback when the host is not loopback", () => {
    const prevNode = process.env.NODE_ENV;
    const prevVercelEnv = process.env.VERCEL_ENV;
    const prevFlag = process.env.MURMUR_ALLOW_DEV_BILLING_FALLBACK;
    process.env.NODE_ENV = "production";
    delete process.env.VERCEL_ENV;
    process.env.MURMUR_ALLOW_DEV_BILLING_FALLBACK = "1";

    try {
      expect(shouldUseDevBalanceFallback({ host: "murmur.example" })).toBe(false);
      expect(shouldUseDevBalanceFallback()).toBe(false);
    } finally {
      if (prevNode === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prevNode;
      if (prevVercelEnv === undefined) delete process.env.VERCEL_ENV;
      else process.env.VERCEL_ENV = prevVercelEnv;
      if (prevFlag === undefined) delete process.env.MURMUR_ALLOW_DEV_BILLING_FALLBACK;
      else process.env.MURMUR_ALLOW_DEV_BILLING_FALLBACK = prevFlag;
    }
  });

  it("allows loopback fallback outside production", () => {
    const prevNode = process.env.NODE_ENV;
    const prevVercelEnv = process.env.VERCEL_ENV;
    delete process.env.NODE_ENV;
    delete process.env.VERCEL_ENV;

    try {
      expect(shouldUseDevBalanceFallback({ host: "127.0.0.1" })).toBe(true);
    } finally {
      if (prevNode === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prevNode;
      if (prevVercelEnv === undefined) delete process.env.VERCEL_ENV;
      else process.env.VERCEL_ENV = prevVercelEnv;
    }
  });

  it("refuses fallback on Vercel production even when NODE_ENV is not production", () => {
    const prevNode = process.env.NODE_ENV;
    const prevVercelEnv = process.env.VERCEL_ENV;
    const prevFlag = process.env.MURMUR_ALLOW_DEV_BILLING_FALLBACK;
    process.env.NODE_ENV = "test";
    process.env.VERCEL_ENV = "production";
    process.env.MURMUR_ALLOW_DEV_BILLING_FALLBACK = "1";

    try {
      expect(shouldUseDevBalanceFallback({ host: "staging.example" })).toBe(false);
    } finally {
      if (prevNode === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prevNode;
      if (prevVercelEnv === undefined) delete process.env.VERCEL_ENV;
      else process.env.VERCEL_ENV = prevVercelEnv;
      if (prevFlag === undefined) delete process.env.MURMUR_ALLOW_DEV_BILLING_FALLBACK;
      else process.env.MURMUR_ALLOW_DEV_BILLING_FALLBACK = prevFlag;
    }
  });
});
