import { describe, expect, it } from "bun:test";

import {
  findLocalPurchaseForWaffoPayment,
  retryPendingRefunds,
  waffoRefundLedgerRefs,
  type PendingRefundRetryDeps,
} from "@/lib/billing/waffo-reconcile";
import type { PendingRefundMarker } from "@/lib/db/queries/notes-ledger";

function marker(id: string, epochMs: number): PendingRefundMarker {
  return {
    id,
    userId: "usr_1",
    originalLedgerId: `spend_${id}`,
    createdAt: new Date(epochMs),
    metadata: {},
  };
}

/**
 * A paginated fake of `listPendingRefundMarkers`: hands out `all` in
 * (createdAt, id) order, honouring the (limit, after) cursor exactly like the
 * real query so the retry loop's pagination is exercised end to end.
 */
function pagedListMarkers(all: PendingRefundMarker[]): {
  listMarkers: PendingRefundRetryDeps["listMarkers"];
  calls: () => number;
} {
  const sorted = [...all].sort((a, b) =>
    a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id),
  );
  let calls = 0;
  return {
    calls: () => calls,
    listMarkers: async ({ limit, after }) => {
      calls += 1;
      const start = after
        ? sorted.findIndex(
            (m) =>
              m.createdAt.getTime() > after.createdAt.getTime() ||
              (m.createdAt.getTime() === after.createdAt.getTime() && m.id > after.id),
          )
        : 0;
      if (start === -1) return [];
      return sorted.slice(start, start + limit);
    },
  };
}

describe("retryPendingRefunds (#238)", () => {
  it("classifies newly-fixed, already-settled, and manual-review outcomes", async () => {
    const { listMarkers } = pagedListMarkers([
      marker("a", 1),
      marker("b", 2),
      marker("c", 3),
    ]);
    const deps: PendingRefundRetryDeps = {
      listMarkers,
      retryRefund: async (originalLedgerId) => {
        if (originalLedgerId === "spend_a") return { ok: true, duplicate: false };
        if (originalLedgerId === "spend_b") return { ok: true, duplicate: true };
        return { ok: false, duplicate: false, reason: "original_not_found" };
      },
    };

    const summary = await retryPendingRefunds(deps, { pageLimit: 10 });

    expect(summary).toEqual({
      scanned: 3,
      refundsFixed: 1,
      alreadySettled: 1,
      requiresManualReview: 1,
      pages: 1,
    });
  });

  it("counts a thrown retry as requiring manual review", async () => {
    const { listMarkers } = pagedListMarkers([marker("a", 1)]);
    const summary = await retryPendingRefunds({
      listMarkers,
      retryRefund: async () => {
        throw new Error("db unreachable");
      },
    });

    expect(summary.requiresManualReview).toBe(1);
    expect(summary.refundsFixed).toBe(0);
  });

  it("walks every page with a stable cursor until the tail", async () => {
    const markers = Array.from({ length: 5 }, (_, i) => marker(`m${i}`, i + 1));
    const paged = pagedListMarkers(markers);
    const retried: string[] = [];

    const summary = await retryPendingRefunds(
      {
        listMarkers: paged.listMarkers,
        retryRefund: async (id) => {
          retried.push(id);
          return { ok: true, duplicate: false };
        },
      },
      { pageLimit: 2 },
    );

    // 5 markers, page size 2 → pages of 2, 2, 1 (the short page ends the walk).
    expect(summary.scanned).toBe(5);
    expect(summary.refundsFixed).toBe(5);
    expect(summary.pages).toBe(3);
    expect(retried).toHaveLength(5);
    // Every marker seen exactly once (no cursor overlap or gap).
    expect(new Set(retried).size).toBe(5);
  });

  it("stops at maxPages so one run can't scan an unbounded backlog", async () => {
    const markers = Array.from({ length: 6 }, (_, i) => marker(`m${i}`, i + 1));
    const paged = pagedListMarkers(markers);

    const summary = await retryPendingRefunds(
      {
        listMarkers: paged.listMarkers,
        retryRefund: async () => ({ ok: true, duplicate: false }),
      },
      { pageLimit: 2, maxPages: 2 },
    );

    // Capped at 2 pages × 2 = 4, even though 6 markers exist.
    expect(summary.scanned).toBe(4);
    expect(summary.pages).toBe(2);
    expect(paged.calls()).toBe(2);
  });

  it("is a no-op when there are no pending markers", async () => {
    const { listMarkers } = pagedListMarkers([]);
    const summary = await retryPendingRefunds({
      listMarkers,
      retryRefund: async () => ({ ok: true, duplicate: false }),
    });

    expect(summary).toEqual({
      scanned: 0,
      refundsFixed: 0,
      alreadySettled: 0,
      requiresManualReview: 0,
      pages: 0,
    });
  });
});

describe("Waffo purchase correlation (#237)", () => {
  it("finds an unfulfilled pending purchase by merchant external id", () => {
    const pending = { id: "pur_pending", status: "pending" };
    const purchases = new Map([
      ["waffo-pending:pur_pending", pending],
    ]);

    expect(
      findLocalPurchaseForWaffoPayment(
        {
          orderId: "ORD_final",
          onetimeOrder: { id: "ORD_final" },
          orderMerchantExternalId: "waffo-pending:pur_pending",
        },
        purchases,
      ),
    ).toBe(pending);
  });

  it("prefers the finalized order id after webhook fulfillment", () => {
    const final = { id: "pur_final", status: "succeeded" };
    const stale = { id: "pur_stale", status: "pending" };
    const purchases = new Map([
      ["ORD_final", final],
      ["waffo-pending:pur_pending", stale],
    ]);

    expect(
      findLocalPurchaseForWaffoPayment(
        {
          orderId: "ORD_final",
          onetimeOrder: null,
          orderMerchantExternalId: "waffo-pending:pur_pending",
        },
        purchases,
      ),
    ).toBe(final);
  });

  it("keeps refund reconciliation compatible with every webhook fallback", () => {
    expect(
      waffoRefundLedgerRefs(
        {
          id: "REF_provider",
          eventId: "REF_event",
          orderMerchantExternalId: "waffo-pending:pur_pending",
          refundTicketMerchantExternalId: "REF_ticket",
        },
        "ORD_final",
      ),
    ).toEqual([
      "waffo-refund:REF_ticket",
      "waffo-refund:REF_event",
      "waffo-refund:REF_provider",
      "waffo-refund:ORD_final",
      "waffo-refund:waffo-pending:pur_pending",
    ]);
  });
});
