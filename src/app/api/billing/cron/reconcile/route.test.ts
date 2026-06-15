import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { NextRequest } from "next/server";

let cronSecret = "cron_test";
let merchantId: string | null = "merchant_test";
let privateKey: string | null = "private_test";
const reconcileInputs: Array<{ merchantId: string; privateKey: string; limit?: number }> = [];

mock.module("@/lib/billing/waffo-reconcile", () => ({
  reconcileWaffoBilling: mock(async (input: { merchantId: string; privateKey: string; limit?: number }) => {
    reconcileInputs.push(input);
    return {
      summary: {
        checkedAt: "2026-06-15T18:00:00.000Z",
        paymentsChecked: 2,
        refundsChecked: 1,
        localPurchasesMatched: 2,
        issueCount: 0,
        errorCount: 0,
        warnCount: 0,
      },
      issues: [],
    };
  }),
}));

const { GET } = await import("./route");

beforeEach(() => {
  cronSecret = "cron_test";
  merchantId = "merchant_test";
  privateKey = "private_test";
  reconcileInputs.length = 0;
});

function buildRequest(headers: Record<string, string> = {}, url = "http://test.local/api/billing/cron/reconcile"): NextRequest {
  return new Request(url, { headers }) as unknown as NextRequest;
}

describe("GET /api/billing/cron/reconcile", () => {
  it("requires CRON_SECRET", async () => {
    delete process.env.CRON_SECRET;
    const response = await GET(buildRequest({ authorization: "Bearer cron_test" }));
    expect(response.status).toBe(500);
  });

  it("rejects unauthorized requests", async () => {
    process.env.CRON_SECRET = cronSecret;
    const response = await GET(buildRequest());
    expect(response.status).toBe(401);
  });

  it("returns 503 when Waffo is not configured", async () => {
    process.env.CRON_SECRET = cronSecret;
    process.env.WAFFO_MERCHANT_ID = "";
    delete process.env.WAFFO_PRIVATE_KEY;
    delete process.env.WAFFO_PRIVATE_KEY_BASE64;

    const response = await GET(buildRequest({ authorization: "Bearer cron_test" }));
    expect(response.status).toBe(503);
  });

  it("runs a read-only reconciliation", async () => {
    process.env.CRON_SECRET = cronSecret;
    process.env.WAFFO_MERCHANT_ID = merchantId;
    process.env.WAFFO_PRIVATE_KEY = privateKey;

    const response = await GET(
      buildRequest({ authorization: "Bearer cron_test" }, "http://test.local/api/billing/cron/reconcile?limit=20"),
    );

    expect(response.status).toBe(200);
    const body = await response.json() as {
      summary: { paymentsChecked: number; refundsChecked: number };
      issues: Array<unknown>;
    };
    expect(body.summary).toMatchObject({ paymentsChecked: 2, refundsChecked: 1 });
    expect(body.issues).toHaveLength(0);
    expect(reconcileInputs).toHaveLength(1);
    expect(reconcileInputs[0]).toMatchObject({
      merchantId: "merchant_test",
      privateKey: "private_test",
      limit: 20,
    });
  });

  it("returns 500 when limit is invalid", async () => {
    process.env.CRON_SECRET = cronSecret;
    process.env.WAFFO_MERCHANT_ID = merchantId;
    process.env.WAFFO_PRIVATE_KEY = privateKey;

    const response = await GET(
      buildRequest({ authorization: "Bearer cron_test" }, "http://test.local/api/billing/cron/reconcile?limit=0"),
    );

    expect(response.status).toBe(500);
  });
});
