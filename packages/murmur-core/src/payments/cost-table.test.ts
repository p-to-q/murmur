import { describe, expect, it } from "bun:test";
import { COST, DAILY_REFILL, GRANTS, MAX_FREE_BALANCE, TOPUP_SKUS, asCostKey } from "./cost-table";

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
});
