import { describe, expect, it } from "bun:test";

import {
  findLocalPurchaseForWaffoPayment,
  waffoRefundLedgerRefs,
} from "@/lib/billing/waffo-reconcile";

// The provider-neutral pending-refund retry loop moved to
// pending-refund-reconcile.ts (#299); its tests live in
// pending-refund-reconcile.test.ts. Waffo reconciliation now covers only
// purchase/top-up correlation.

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
