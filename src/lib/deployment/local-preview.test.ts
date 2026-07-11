import { afterEach, describe, expect, it } from "bun:test";
import { setTestNodeEnv } from "@/test-utils/env";

import { shouldAllowDeploymentLocalPreview } from "./local-preview";

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

describe("shouldAllowDeploymentLocalPreview", () => {
  it("fails closed in non-Vercel production without explicit opt-in", () => {
    setTestNodeEnv("production");
    delete process.env.VERCEL;
    delete process.env.MURMUR_ALLOW_PRODUCTION_LOCAL_PREVIEW;
    process.env.MURMUR_ALLOW_DEV_BILLING_FALLBACK = "1";

    expect(shouldAllowDeploymentLocalPreview()).toBe(false);
  });

  it("fails closed in Vercel production without explicit opt-in", () => {
    setTestNodeEnv("production");
    process.env.VERCEL = "1";
    delete process.env.MURMUR_ALLOW_PRODUCTION_LOCAL_PREVIEW;

    expect(shouldAllowDeploymentLocalPreview()).toBe(false);
  });

  it("allows an explicitly opted-in non-Vercel production demo", () => {
    setTestNodeEnv("production");
    delete process.env.VERCEL;
    process.env.MURMUR_ALLOW_PRODUCTION_LOCAL_PREVIEW = "true";

    expect(shouldAllowDeploymentLocalPreview()).toBe(true);
  });

  it("allows an explicitly opted-in Vercel production demo", () => {
    setTestNodeEnv("production");
    process.env.VERCEL = "1";
    process.env.MURMUR_ALLOW_PRODUCTION_LOCAL_PREVIEW = "1";

    expect(shouldAllowDeploymentLocalPreview()).toBe(true);
  });

  it("keeps development local previews enabled", () => {
    setTestNodeEnv("development");

    expect(shouldAllowDeploymentLocalPreview()).toBe(true);
  });

  it("keeps tests fail closed unless the caller supplies a test fixture", () => {
    setTestNodeEnv("test");
    process.env.MURMUR_ALLOW_PRODUCTION_LOCAL_PREVIEW = "1";
    process.env.MURMUR_ALLOW_DEV_BILLING_FALLBACK = "1";

    expect(shouldAllowDeploymentLocalPreview()).toBe(false);
  });
});

function restore(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
