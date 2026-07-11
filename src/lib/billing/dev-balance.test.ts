import { afterEach, describe, expect, it } from "bun:test";
import { setTestNodeEnv } from "@/test-utils/env";

import { shouldUseDevBalanceFallback } from "./dev-balance";

const original = {
  nodeEnv: process.env.NODE_ENV,
  productionPreview: process.env.MURMUR_ALLOW_PRODUCTION_LOCAL_PREVIEW,
  devBillingFallback: process.env.MURMUR_ALLOW_DEV_BILLING_FALLBACK,
  vercel: process.env.VERCEL,
};

afterEach(() => {
  setTestNodeEnv(original.nodeEnv);
  restore("MURMUR_ALLOW_PRODUCTION_LOCAL_PREVIEW", original.productionPreview);
  restore("MURMUR_ALLOW_DEV_BILLING_FALLBACK", original.devBillingFallback);
  restore("VERCEL", original.vercel);
});

describe("shouldUseDevBalanceFallback", () => {
  it("rejects forged loopback hosts in non-Vercel production", () => {
    setTestNodeEnv("production");
    delete process.env.VERCEL;
    delete process.env.MURMUR_ALLOW_PRODUCTION_LOCAL_PREVIEW;

    expect(shouldUseDevBalanceFallback({ host: "localhost" })).toBe(false);
    expect(shouldUseDevBalanceFallback({ host: "127.0.0.1" })).toBe(false);
    expect(shouldUseDevBalanceFallback({ host: "::1" })).toBe(false);
  });

  it("rejects forged loopback hosts in Vercel production", () => {
    setTestNodeEnv("production");
    process.env.VERCEL = "1";
    delete process.env.MURMUR_ALLOW_PRODUCTION_LOCAL_PREVIEW;

    expect(shouldUseDevBalanceFallback({ host: "localhost" })).toBe(false);
    expect(shouldUseDevBalanceFallback({ host: "127.0.0.1" })).toBe(false);
    expect(shouldUseDevBalanceFallback({ host: "::1" })).toBe(false);
  });

  it("does not treat the development billing flag as production opt-in", () => {
    setTestNodeEnv("production");
    process.env.MURMUR_ALLOW_DEV_BILLING_FALLBACK = "1";
    delete process.env.MURMUR_ALLOW_PRODUCTION_LOCAL_PREVIEW;

    expect(shouldUseDevBalanceFallback({ host: "localhost" })).toBe(false);
  });

  it("allows an explicitly opted-in production demo on any host", () => {
    setTestNodeEnv("production");
    process.env.MURMUR_ALLOW_PRODUCTION_LOCAL_PREVIEW = "true";

    expect(shouldUseDevBalanceFallback({ host: "murmur.ptoq.io" })).toBe(true);
  });

  it("allows explicit opt-in outside production", () => {
    setTestNodeEnv("staging");
    process.env.MURMUR_ALLOW_DEV_BILLING_FALLBACK = "true";

    expect(shouldUseDevBalanceFallback({ host: "preview.test" })).toBe(true);
  });

  it("keeps test runs on ledger paths even when env files enable fallback", () => {
    setTestNodeEnv("test");
    process.env.MURMUR_ALLOW_DEV_BILLING_FALLBACK = "true";
    process.env.MURMUR_ALLOW_PRODUCTION_LOCAL_PREVIEW = "true";

    expect(shouldUseDevBalanceFallback({ host: "preview.test" })).toBe(false);
  });

  it("keeps loopback fallback available only as a test fixture", () => {
    setTestNodeEnv("test");

    expect(shouldUseDevBalanceFallback({ host: "localhost" })).toBe(true);
  });
});

function restore(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
