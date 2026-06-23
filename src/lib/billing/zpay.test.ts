import { describe, expect, it } from "bun:test";

import {
  __resetZpayConfigForTesting,
  isZpayCheckoutEnabled,
  ZPAY_PRODUCTION_REFUND_GAP_ALLOW_ENV,
} from "./zpay";

describe("ZPay checkout launch gate", () => {
  it("requires an explicit production allow flag while refund webhooks are missing", () => {
    const previous = snapshotEnv();

    try {
      process.env.ZPAY_PID = "pid_test";
      process.env.ZPAY_KEY = "key_test";
      process.env.NODE_ENV = "production";
      delete process.env[ZPAY_PRODUCTION_REFUND_GAP_ALLOW_ENV];
      __resetZpayConfigForTesting();

      expect(isZpayCheckoutEnabled()).toBe(false);

      process.env[ZPAY_PRODUCTION_REFUND_GAP_ALLOW_ENV] = "1";
      expect(isZpayCheckoutEnabled()).toBe(true);
    } finally {
      restoreEnv(previous);
      __resetZpayConfigForTesting();
    }
  });

  it("keeps configured non-production ZPay available for integration testing", () => {
    const previous = snapshotEnv();

    try {
      process.env.ZPAY_PID = "pid_test";
      process.env.ZPAY_KEY = "key_test";
      process.env.NODE_ENV = "test";
      delete process.env.VERCEL;
      delete process.env.VERCEL_ENV;
      delete process.env[ZPAY_PRODUCTION_REFUND_GAP_ALLOW_ENV];
      __resetZpayConfigForTesting();

      expect(isZpayCheckoutEnabled()).toBe(true);
    } finally {
      restoreEnv(previous);
      __resetZpayConfigForTesting();
    }
  });

  it("does not treat Vercel preview as a production ZPay launch", () => {
    const previous = snapshotEnv();

    try {
      process.env.ZPAY_PID = "pid_test";
      process.env.ZPAY_KEY = "key_test";
      process.env.NODE_ENV = "production";
      process.env.VERCEL = "1";
      process.env.VERCEL_ENV = "preview";
      delete process.env[ZPAY_PRODUCTION_REFUND_GAP_ALLOW_ENV];
      __resetZpayConfigForTesting();

      expect(isZpayCheckoutEnabled()).toBe(true);
    } finally {
      restoreEnv(previous);
      __resetZpayConfigForTesting();
    }
  });
});

function snapshotEnv() {
  return {
    nodeEnv: process.env.NODE_ENV,
    vercel: process.env.VERCEL,
    vercelEnv: process.env.VERCEL_ENV,
    pid: process.env.ZPAY_PID,
    key: process.env.ZPAY_KEY,
    allow: process.env[ZPAY_PRODUCTION_REFUND_GAP_ALLOW_ENV],
  };
}

function restoreEnv(previous: ReturnType<typeof snapshotEnv>) {
  restoreOptionalEnv("NODE_ENV", previous.nodeEnv);
  restoreOptionalEnv("VERCEL", previous.vercel);
  restoreOptionalEnv("VERCEL_ENV", previous.vercelEnv);
  restoreOptionalEnv("ZPAY_PID", previous.pid);
  restoreOptionalEnv("ZPAY_KEY", previous.key);
  restoreOptionalEnv(ZPAY_PRODUCTION_REFUND_GAP_ALLOW_ENV, previous.allow);
}

function restoreOptionalEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}
