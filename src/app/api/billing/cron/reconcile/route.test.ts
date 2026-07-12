import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { NextRequest } from "next/server";
import { setTestEnv } from "@/test-utils/env";

let cronSecret = "cron_test";
let merchantId: string | null = "merchant_test";
let privateKey: string | null = "private_test";
type ReconcileInput = {
  merchantId: string;
  privateKey: string;
  limit?: number;
  autoFix?: boolean;
};
const reconcileInputs: Array<ReconcileInput> = [];
let reconcileSummary = {
  checkedAt: "2026-06-15T18:00:00.000Z",
  paymentsChecked: 2,
  refundsChecked: 1,
  localPurchasesMatched: 2,
  issueCount: 0,
  errorCount: 0,
  warnCount: 0,
};
let nextAutoFix: {
  enabled: boolean;
  grantsFixed: number;
  requiresManualReview: number;
  fixed: number;
} | null = null;

mock.module("@/lib/billing/waffo-reconcile", () => ({
  reconcileWaffoBilling: mock(async (input: ReconcileInput) => {
    reconcileInputs.push(input);
    return {
      summary: reconcileSummary,
      issues: [],
      ...(nextAutoFix ? { autoFix: nextAutoFix } : {}),
    };
  }),
}));

const { GET } = await import("./route");

beforeEach(() => {
  cronSecret = "cron_test";
  merchantId = "merchant_test";
  privateKey = "private_test";
  reconcileInputs.length = 0;
  nextAutoFix = null;
  delete process.env.WAFFO_RECONCILE_AUTOFIX;
  reconcileSummary = {
    checkedAt: "2026-06-15T18:00:00.000Z",
    paymentsChecked: 2,
    refundsChecked: 1,
    localPurchasesMatched: 2,
    issueCount: 0,
    errorCount: 0,
    warnCount: 0,
  };
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
    setTestEnv("WAFFO_MERCHANT_ID", merchantId ?? undefined);
    setTestEnv("WAFFO_PRIVATE_KEY", privateKey ?? undefined);

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

  it("returns 207 when reconciliation finds mismatches", async () => {
    process.env.CRON_SECRET = cronSecret;
    setTestEnv("WAFFO_MERCHANT_ID", merchantId ?? undefined);
    setTestEnv("WAFFO_PRIVATE_KEY", privateKey ?? undefined);
    reconcileSummary = {
      ...reconcileSummary,
      issueCount: 1,
      errorCount: 1,
      warnCount: 0,
    };

    const response = await GET(
      buildRequest({ authorization: "Bearer cron_test" }, "http://test.local/api/billing/cron/reconcile"),
    );

    expect(response.status).toBe(207);
  });

  it("returns 500 when limit is invalid", async () => {
    process.env.CRON_SECRET = cronSecret;
    setTestEnv("WAFFO_MERCHANT_ID", merchantId ?? undefined);
    setTestEnv("WAFFO_PRIVATE_KEY", privateKey ?? undefined);

    const response = await GET(
      buildRequest({ authorization: "Bearer cron_test" }, "http://test.local/api/billing/cron/reconcile?limit=0"),
    );

    expect(response.status).toBe(500);
  });

  it("stays report-only by default and enables autoFix via env or ?autoFix (#238)", async () => {
    process.env.CRON_SECRET = cronSecret;
    setTestEnv("WAFFO_MERCHANT_ID", merchantId ?? undefined);
    setTestEnv("WAFFO_PRIVATE_KEY", privateKey ?? undefined);

    // Default: report-only.
    await GET(buildRequest({ authorization: "Bearer cron_test" }));
    expect(reconcileInputs.at(-1)?.autoFix).toBe(false);

    // Env opt-in.
    process.env.WAFFO_RECONCILE_AUTOFIX = "1";
    await GET(buildRequest({ authorization: "Bearer cron_test" }));
    expect(reconcileInputs.at(-1)?.autoFix).toBe(true);

    // Per-request override wins over the env.
    await GET(
      buildRequest(
        { authorization: "Bearer cron_test" },
        "http://test.local/api/billing/cron/reconcile?autoFix=0",
      ),
    );
    expect(reconcileInputs.at(-1)?.autoFix).toBe(false);
  });

  it("returns 200 once autoFix resolves the detected drift", async () => {
    process.env.CRON_SECRET = cronSecret;
    setTestEnv("WAFFO_MERCHANT_ID", merchantId ?? undefined);
    setTestEnv("WAFFO_PRIVATE_KEY", privateKey ?? undefined);
    // Drift was detected (errorCount 1) but auto-fix repaired it all.
    reconcileSummary = { ...reconcileSummary, issueCount: 1, errorCount: 1 };
    nextAutoFix = {
      enabled: true,
      grantsFixed: 1,
      requiresManualReview: 0,
      fixed: 1,
    };

    const response = await GET(
      buildRequest(
        { authorization: "Bearer cron_test" },
        "http://test.local/api/billing/cron/reconcile?autoFix=1",
      ),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { autoFix?: { fixed: number } };
    expect(body.autoFix?.fixed).toBe(1);
  });

  it("returns 207 when autoFix still leaves items for manual review", async () => {
    process.env.CRON_SECRET = cronSecret;
    setTestEnv("WAFFO_MERCHANT_ID", merchantId ?? undefined);
    setTestEnv("WAFFO_PRIVATE_KEY", privateKey ?? undefined);
    reconcileSummary = { ...reconcileSummary, issueCount: 1, errorCount: 1 };
    nextAutoFix = {
      enabled: true,
      grantsFixed: 0,
      requiresManualReview: 1,
      fixed: 0,
    };

    const response = await GET(
      buildRequest(
        { authorization: "Bearer cron_test" },
        "http://test.local/api/billing/cron/reconcile?autoFix=1",
      ),
    );

    expect(response.status).toBe(207);
  });
});
