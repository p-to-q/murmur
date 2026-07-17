import { describe, expect, it } from "bun:test";
import {
  InvalidTopupPurchaseError,
  isWaffoPendingProviderRef,
  resolveWaffoTopupPurchase,
  waffoPendingProviderRef,
} from "./topup-purchase";

describe("topup purchase resolution", () => {
  it("resolves fixed CNY SKU purchases against the regional price", () => {
    const purchase = resolveWaffoTopupPurchase({
      orderId: "order_cny",
      orderMetadata: {
        userId: "usr_1",
        skuId: "topup_120_notes",
        notesGranted: "130",
      },
      amountDisplay: "42.90",
      currency: "CNY",
      paymentId: "pay_1",
    });

    expect(purchase).toMatchObject({
      userId: "usr_1",
      productId: "topup_120_notes",
      notesGranted: 130,
      amountCents: 4290,
      currency: "CNY",
      paymentIntentId: "pay_1",
      metadata: { skuId: "topup_120_notes" },
    });
  });

  it("resolves custom CNY purchases with server-side notes math", () => {
    const purchase = resolveWaffoTopupPurchase({
      orderId: "order_custom_cny",
      orderMetadata: {
        userId: "usr_custom",
        skuId: "topup_custom",
        customAmountCny: "88",
        notesGranted: "264",
      },
      amountDisplay: "88.00",
      currency: "CNY",
    });

    expect(purchase).toMatchObject({
      userId: "usr_custom",
      productId: "topup_custom",
      notesGranted: 264,
      amountCents: 8800,
      currency: "CNY",
      metadata: { skuId: "topup_custom", customAmountCny: 88 },
    });
  });

  it("resolves custom USD purchases and rejects mismatched notes", () => {
    const purchase = resolveWaffoTopupPurchase({
      orderId: "order_custom_usd",
      orderMetadata: {
        userId: "usr_usd",
        skuId: "topup_custom",
        customAmountUsd: "12",
      },
      amountDisplay: "12.00",
      currency: "USD",
    });

    expect(purchase.notesGranted).toBe(240);
    expect(purchase.amountCents).toBe(1200);
    expect(purchase.metadata).toEqual({
      skuId: "topup_custom",
      customAmountUsd: 12,
    });

    expect(() =>
      resolveWaffoTopupPurchase({
        orderId: "order_custom_bad_notes",
        orderMetadata: {
          userId: "usr_usd",
          skuId: "topup_custom",
          customAmountUsd: "12",
          notesGranted: "239",
        },
        amountDisplay: "12.00",
        currency: "USD",
      }),
    ).toThrow(InvalidTopupPurchaseError);
  });

  it("rejects invalid SKU and invalid custom amount metadata", () => {
    expect(() =>
      resolveWaffoTopupPurchase({
        orderId: "order_unknown",
        orderMetadata: {
          userId: "usr_1",
          skuId: "missing_sku",
        },
        amountDisplay: "1.99",
        currency: "USD",
      }),
    ).toThrow(InvalidTopupPurchaseError);

    expect(() =>
      resolveWaffoTopupPurchase({
        orderId: "order_bad_custom",
        orderMetadata: {
          userId: "usr_1",
          skuId: "topup_custom",
          customAmountUsd: "0",
        },
        amountDisplay: "0.00",
        currency: "USD",
      }),
    ).toThrow(InvalidTopupPurchaseError);
  });

  it("keeps pending Waffo provider refs recognizable", () => {
    const ref = waffoPendingProviderRef("purchase_123");

    expect(ref).toBe("waffo-pending:purchase_123");
    expect(isWaffoPendingProviderRef(ref)).toBe(true);
    expect(isWaffoPendingProviderRef("stripe:purchase_123")).toBe(false);
    expect(isWaffoPendingProviderRef(null)).toBe(false);
  });
});
