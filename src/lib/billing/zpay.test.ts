import { createHash } from "crypto";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { setTestNodeEnv } from "@/test-utils/env";

import {
  __resetZpayConfigForTesting,
  isZpayCheckoutEnabled,
  zpayVerifyNotify,
  ZPAY_PRODUCTION_REFUND_GAP_ALLOW_ENV,
} from "./zpay";

describe("ZPay checkout launch gate", () => {
  it("requires an explicit production allow flag while refund webhooks are missing", () => {
    const previous = snapshotEnv();

    try {
      process.env.ZPAY_PID = "pid_test";
      process.env.ZPAY_KEY = "key_test";
      setTestNodeEnv("production");
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
      setTestNodeEnv("test");
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
      setTestNodeEnv("production");
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
  setTestNodeEnv(previous.nodeEnv);
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

const BASE_NOTIFY = {
  pid: "pid_test",
  trade_no: "trade_zpay_1",
  out_trade_no: "usr_zpay:topup_120_notes:order_1",
  type: "wxpay",
  name: "Murmur",
  money: "42.90",
  trade_status: "TRADE_SUCCESS",
  sign_type: "MD5",
};

function signZpay(params: Record<string, string>, key: string): string {
  const sorted = Object.keys(params)
    .filter((field) => field !== "sign" && field !== "sign_type" && params[field] !== "")
    .sort();
  const message = sorted.map((field) => `${field}=${params[field]}`).join("&");
  return createHash("md5").update(`${message}${key}`).digest("hex");
}

function signedNotify(overrides: Record<string, string> = {}) {
  const params = { ...BASE_NOTIFY, ...overrides };
  return {
    ...params,
    sign: signZpay(params, "key_test"),
  };
}

describe("zpayVerifyNotify", () => {
  let prevPid: string | undefined;
  let prevKey: string | undefined;

  beforeEach(() => {
    prevPid = process.env.ZPAY_PID;
    prevKey = process.env.ZPAY_KEY;
    process.env.ZPAY_PID = "pid_test";
    process.env.ZPAY_KEY = "key_test";
    __resetZpayConfigForTesting();
  });

  afterEach(() => {
    if (prevPid === undefined) delete process.env.ZPAY_PID;
    else process.env.ZPAY_PID = prevPid;
    if (prevKey === undefined) delete process.env.ZPAY_KEY;
    else process.env.ZPAY_KEY = prevKey;
    __resetZpayConfigForTesting();
  });

  it("accepts signed notifications for the configured merchant", () => {
    const verified = zpayVerifyNotify(signedNotify());

    expect(verified).toMatchObject({
      pid: "pid_test",
      trade_no: "trade_zpay_1",
      out_trade_no: "usr_zpay:topup_120_notes:order_1",
      sign_type: "MD5",
    });
  });

  it("rejects notifications for a different merchant pid", () => {
    expect(zpayVerifyNotify(signedNotify({ pid: "pid_other" }))).toBeNull();
  });

  it("rejects unsupported sign_type values", () => {
    expect(zpayVerifyNotify(signedNotify({ sign_type: "SHA256" }))).toBeNull();
  });

  it("rejects missing required fields", () => {
    const params = signedNotify();
    delete (params as Partial<typeof params>).trade_no;

    expect(zpayVerifyNotify(params)).toBeNull();
  });

  it("rejects tampered signatures", () => {
    expect(zpayVerifyNotify({ ...signedNotify(), money: "0.01" })).toBeNull();
  });
});
