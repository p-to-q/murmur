import { describe, expect, it } from "bun:test";

import { buildTopupBalanceHistory } from "@/lib/db/queries/topup-surface";

describe("buildTopupBalanceHistory", () => {
  it("derives balance series from ledger deltas and the current balance", () => {
    const history = buildTopupBalanceHistory({
      currentBalance: 11,
      now: new Date("2026-07-17T12:00:00.000Z"),
      ledgerEntries: [
        { delta: 10, createdAt: new Date("2026-07-17T00:00:00.000Z") },
        { delta: -4, createdAt: new Date("2026-07-17T06:00:00.000Z") },
      ],
    });

    const oneDay = history.find((range) => range.range === "1D");

    expect(oneDay?.points[0]).toEqual({
      timestamp: "2026-07-16T13:00:00.000Z",
      balance: 5,
    });
    expect(oneDay?.points.at(-1)).toEqual({
      timestamp: "2026-07-17T12:00:00.000Z",
      balance: 11,
    });
    expect(oneDay?.changeValue).toBe(6);
    expect(oneDay?.changePercent).toBe(120);
  });

  it("returns stable flat ranges when there are no ledger rows", () => {
    const history = buildTopupBalanceHistory({
      currentBalance: 7,
      now: new Date("2026-07-17T12:00:00.000Z"),
      ledgerEntries: [],
    });

    expect(history).toHaveLength(5);
    for (const range of history) {
      expect(range.points.every((point) => point.balance === 7)).toBe(true);
      expect(range.changeValue).toBe(0);
      expect(range.changePercent).toBe(0);
    }
  });
});
