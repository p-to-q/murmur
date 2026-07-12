import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { NextRequest } from "next/server";

type ReconcileOptions = { pageLimit?: number; maxPages?: number };
const reconcileInputs: ReconcileOptions[] = [];
let nextSummary = {
  scanned: 0,
  refundsFixed: 0,
  alreadySettled: 0,
  requiresManualReview: 0,
  pages: 0,
};
let reconcileThrows: Error | null = null;

mock.module("@/lib/billing/pending-refund-reconcile", () => ({
  reconcilePendingRefunds: mock(async (options: ReconcileOptions) => {
    reconcileInputs.push(options);
    if (reconcileThrows) throw reconcileThrows;
    return nextSummary;
  }),
}));

const { GET } = await import("./route");

beforeEach(() => {
  process.env.CRON_SECRET = "cron_test";
  reconcileInputs.length = 0;
  reconcileThrows = null;
  nextSummary = {
    scanned: 0,
    refundsFixed: 0,
    alreadySettled: 0,
    requiresManualReview: 0,
    pages: 0,
  };
});

function buildRequest(
  headers: Record<string, string> = {},
  url = "http://test.local/api/billing/cron/refunds",
): NextRequest {
  return new Request(url, { headers }) as unknown as NextRequest;
}

describe("GET /api/billing/cron/refunds (#299)", () => {
  it("requires CRON_SECRET to be configured", async () => {
    delete process.env.CRON_SECRET;
    const response = await GET(buildRequest({ authorization: "Bearer cron_test" }));
    expect(response.status).toBe(500);
  });

  it("rejects unauthorized requests", async () => {
    const response = await GET(buildRequest());
    expect(response.status).toBe(401);
    expect(reconcileInputs).toHaveLength(0);
  });

  it("runs the provider-neutral reconciler with no Waffo configuration", async () => {
    // Deliberately no WAFFO_* env — the pending-refund path must not depend on it.
    delete process.env.WAFFO_MERCHANT_ID;
    delete process.env.WAFFO_PRIVATE_KEY;
    nextSummary = { scanned: 3, refundsFixed: 2, alreadySettled: 1, requiresManualReview: 0, pages: 1 };

    const response = await GET(buildRequest({ authorization: "Bearer cron_test" }));

    expect(response.status).toBe(200);
    const body = (await response.json()) as { refundsFixed: number };
    expect(body.refundsFixed).toBe(2);
    expect(reconcileInputs).toHaveLength(1);
  });

  it("passes bounded page/limit params through", async () => {
    await GET(
      buildRequest(
        { authorization: "Bearer cron_test" },
        "http://test.local/api/billing/cron/refunds?pageLimit=50&maxPages=3",
      ),
    );
    expect(reconcileInputs.at(-1)).toMatchObject({ pageLimit: 50, maxPages: 3 });
  });

  it("returns 500 for an out-of-range param", async () => {
    const response = await GET(
      buildRequest(
        { authorization: "Bearer cron_test" },
        "http://test.local/api/billing/cron/refunds?pageLimit=0",
      ),
    );
    expect(response.status).toBe(500);
  });

  it("returns 207 when refunds still need manual review", async () => {
    nextSummary = { scanned: 2, refundsFixed: 1, alreadySettled: 0, requiresManualReview: 1, pages: 1 };
    const response = await GET(buildRequest({ authorization: "Bearer cron_test" }));
    expect(response.status).toBe(207);
  });

  it("returns 500 when the reconciler throws", async () => {
    reconcileThrows = new Error("ledger unreachable");
    const response = await GET(buildRequest({ authorization: "Bearer cron_test" }));
    expect(response.status).toBe(500);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("reconcile_failed");
  });
});
