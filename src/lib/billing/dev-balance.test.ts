import { describe, expect, it } from "bun:test";

import { shouldUseDevBalanceFallback } from "./dev-balance";

describe("shouldUseDevBalanceFallback", () => {
  it("ignores explicit production opt-in on public hosts", () => {
    const prevNode = process.env.NODE_ENV;
    const prev = process.env.MURMUR_ALLOW_DEV_BILLING_FALLBACK;
    process.env.NODE_ENV = "production";
    process.env.MURMUR_ALLOW_DEV_BILLING_FALLBACK = "1";

    try {
      expect(shouldUseDevBalanceFallback({ host: "murmur.ptoq.io" })).toBe(false);
    } finally {
      if (prevNode === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prevNode;
      if (prev === undefined) delete process.env.MURMUR_ALLOW_DEV_BILLING_FALLBACK;
      else process.env.MURMUR_ALLOW_DEV_BILLING_FALLBACK = prev;
    }
  });

  it("still allows loopback hosts on local production builds", () => {
    const prevNode = process.env.NODE_ENV;
    const prevFlag = process.env.MURMUR_ALLOW_DEV_BILLING_FALLBACK;
    const prevVercel = process.env.VERCEL;
    process.env.NODE_ENV = "production";
    delete process.env.MURMUR_ALLOW_DEV_BILLING_FALLBACK;
    delete process.env.VERCEL;

    try {
      expect(shouldUseDevBalanceFallback({ host: "127.0.0.1" })).toBe(true);
    } finally {
      process.env.NODE_ENV = prevNode;
      if (prevFlag === undefined) delete process.env.MURMUR_ALLOW_DEV_BILLING_FALLBACK;
      else process.env.MURMUR_ALLOW_DEV_BILLING_FALLBACK = prevFlag;
      if (prevVercel === undefined) delete process.env.VERCEL;
      else process.env.VERCEL = prevVercel;
    }
  });

  it("ignores a spoofed loopback host on managed cloud (Vercel)", () => {
    const prevNode = process.env.NODE_ENV;
    const prevFlag = process.env.MURMUR_ALLOW_DEV_BILLING_FALLBACK;
    const prevVercel = process.env.VERCEL;
    process.env.NODE_ENV = "production";
    delete process.env.MURMUR_ALLOW_DEV_BILLING_FALLBACK;
    process.env.VERCEL = "1";

    try {
      expect(shouldUseDevBalanceFallback({ host: "localhost" })).toBe(false);
      expect(shouldUseDevBalanceFallback({ host: "127.0.0.1" })).toBe(false);
      expect(shouldUseDevBalanceFallback({ host: "::1" })).toBe(false);
    } finally {
      process.env.NODE_ENV = prevNode;
      if (prevFlag === undefined) delete process.env.MURMUR_ALLOW_DEV_BILLING_FALLBACK;
      else process.env.MURMUR_ALLOW_DEV_BILLING_FALLBACK = prevFlag;
      if (prevVercel === undefined) delete process.env.VERCEL;
      else process.env.VERCEL = prevVercel;
    }
  });

  it("allows explicit opt-in outside production", () => {
    const prevNode = process.env.NODE_ENV;
    const prev = process.env.MURMUR_ALLOW_DEV_BILLING_FALLBACK;
    process.env.NODE_ENV = "staging";
    process.env.MURMUR_ALLOW_DEV_BILLING_FALLBACK = "true";

    try {
      expect(shouldUseDevBalanceFallback({ host: "preview.test" })).toBe(true);
    } finally {
      if (prevNode === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prevNode;
      if (prev === undefined) delete process.env.MURMUR_ALLOW_DEV_BILLING_FALLBACK;
      else process.env.MURMUR_ALLOW_DEV_BILLING_FALLBACK = prev;
    }
  });

  it("keeps test runs on ledger paths even when local env files enable fallback", () => {
    const prevNode = process.env.NODE_ENV;
    const prev = process.env.MURMUR_ALLOW_DEV_BILLING_FALLBACK;
    process.env.NODE_ENV = "test";
    process.env.MURMUR_ALLOW_DEV_BILLING_FALLBACK = "true";

    try {
      expect(shouldUseDevBalanceFallback({ host: "preview.test" })).toBe(false);
    } finally {
      if (prevNode === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prevNode;
      if (prev === undefined) delete process.env.MURMUR_ALLOW_DEV_BILLING_FALLBACK;
      else process.env.MURMUR_ALLOW_DEV_BILLING_FALLBACK = prev;
    }
  });

  it("keeps loopback fallback available in test for local route fixtures", () => {
    const prevNode = process.env.NODE_ENV;
    const prev = process.env.MURMUR_ALLOW_DEV_BILLING_FALLBACK;
    const prevVercel = process.env.VERCEL;
    process.env.NODE_ENV = "test";
    delete process.env.MURMUR_ALLOW_DEV_BILLING_FALLBACK;
    delete process.env.VERCEL;

    try {
      expect(shouldUseDevBalanceFallback({ host: "localhost" })).toBe(true);
    } finally {
      if (prevNode === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prevNode;
      if (prev === undefined) delete process.env.MURMUR_ALLOW_DEV_BILLING_FALLBACK;
      else process.env.MURMUR_ALLOW_DEV_BILLING_FALLBACK = prev;
      if (prevVercel === undefined) delete process.env.VERCEL;
      else process.env.VERCEL = prevVercel;
    }
  });
});
