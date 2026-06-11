import { describe, expect, it } from "bun:test";
import {
  COST,
  CUSTOM_TOPUP_ID,
  CUSTOM_TOPUP_MAX_USD,
  CUSTOM_TOPUP_MIN_USD,
  CUSTOM_TOPUP_NOTES_PER_USD,
  DAILY_REFILL,
  GRANTS,
  MAX_FREE_BALANCE,
  TOPUP_SKUS,
  asCostKey,
  getCustomTopupQuote,
  getTopupSku,
  isValidCustomTopupAmount,
  topupNotesGranted,
} from "./cost-table";

describe("cost-table", () => {
  it("defines positive note costs for every action", () => {
    expect(Object.values(COST).every((value) => value > 0)).toBe(true);
  });

  it("exposes the expected refill invariants", () => {
    expect(DAILY_REFILL).toBeLessThanOrEqual(MAX_FREE_BALANCE);
    expect(GRANTS.signup_bonus).toBeGreaterThan(0);
  });

  it("maps valid cost keys and rejects unknown ones", () => {
    expect(asCostKey("hum")).toBe("hum");
    expect(asCostKey("unknown")).toBeNull();
  });

  it("keeps top-up SKUs ordered by note count", () => {
    expect(TOPUP_SKUS.map((sku) => sku.notes)).toEqual([30, 120, 400]);
  });

  it("looks up SKUs by id and rejects unknown ids", () => {
    expect(getTopupSku("topup_120_notes")?.defaultPriceCents).toBe(599);
    expect(getTopupSku("not_a_sku")).toBeNull();
  });

  it("grants base + bonus notes per SKU", () => {
    expect(topupNotesGranted(getTopupSku("topup_30_notes")!)).toBe(30);
    expect(topupNotesGranted(getTopupSku("topup_120_notes")!)).toBe(130);
    expect(topupNotesGranted(getTopupSku("topup_400_notes")!)).toBe(450);
  });

  it("quotes valid custom topups with stable server-side math", () => {
    const quote = getCustomTopupQuote(12);
    expect(quote).toEqual({
      id: CUSTOM_TOPUP_ID,
      amountUsd: 12,
      amountCents: 1200,
      notesGranted: 12 * CUSTOM_TOPUP_NOTES_PER_USD,
      display: "$12",
      defaultCurrency: "USD",
    });
  });

  it("rejects invalid custom topup amounts", () => {
    expect(isValidCustomTopupAmount(CUSTOM_TOPUP_MIN_USD)).toBe(true);
    expect(isValidCustomTopupAmount(CUSTOM_TOPUP_MAX_USD)).toBe(true);
    expect(isValidCustomTopupAmount(0)).toBe(false);
    expect(isValidCustomTopupAmount(1000)).toBe(false);
    expect(isValidCustomTopupAmount(4.5)).toBe(false);
    expect(isValidCustomTopupAmount("12")).toBe(false);
    expect(getCustomTopupQuote(0)).toBeNull();
  });
});
