import { and, asc, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { TOPUP_SKUS } from "@murmur/core";

import { db } from "@/lib/db/client";
import { notesLedger } from "@/lib/db/schema/notes-ledger";
import { purchases } from "@/lib/db/schema/purchases";
import { users } from "@/lib/db/schema/users";

export interface TopupSurfaceSnapshot {
  lifetimeTopupCents: number;
  latestPlanSkuId: string | null;
  balanceHistory: TopupBalanceHistoryRange[];
  notesInUse: number;
}

export type TopupHistoryRange = "1H" | "1D" | "7D" | "1M" | "All";

export interface TopupBalanceHistoryPoint {
  timestamp: string;
  balance: number;
}

export interface TopupBalanceHistoryRange {
  range: TopupHistoryRange;
  points: TopupBalanceHistoryPoint[];
  changeValue: number;
  changePercent: number;
}

const FIXED_PLAN_SKU_IDS = TOPUP_SKUS.map((sku) => sku.id);
const HISTORY_RANGES: Record<TopupHistoryRange, { points: number; stepMs: number }> = {
  "1H": { points: 12, stepMs: 5 * 60_000 },
  "1D": { points: 24, stepMs: 3_600_000 },
  "7D": { points: 7, stepMs: 86_400_000 },
  "1M": { points: 30, stepMs: 86_400_000 },
  "All": { points: 365, stepMs: 86_400_000 },
};

export async function getTopupSurfaceSnapshot(userId: string): Promise<TopupSurfaceSnapshot> {
  const now = new Date();
  const recentUsageStart = new Date(now.getTime() - 30 * 86_400_000);
  const oldestHistoryStart = new Date(
    now.getTime() - (HISTORY_RANGES.All.points - 1) * HISTORY_RANGES.All.stepMs,
  );

  const [purchaseTotalRows, latestFixedPlanRows, userRows, ledgerRows, recentUsageRows] = await Promise.all([
    db
      .select({
        totalCents: sql<number>`coalesce(sum(${purchases.amountCents}), 0)`,
      })
      .from(purchases)
      .where(
        and(
          eq(purchases.userId, userId),
          eq(purchases.status, "succeeded"),
        ),
      ),
    db
      .select({
        productId: purchases.productId,
      })
      .from(purchases)
      .where(
        and(
          eq(purchases.userId, userId),
          eq(purchases.status, "succeeded"),
          inArray(purchases.productId, FIXED_PLAN_SKU_IDS),
        ),
      )
      .orderBy(desc(purchases.createdAt))
      .limit(1),
    db
      .select({
        notesBalance: users.notesBalance,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1),
    db
      .select({
        delta: notesLedger.delta,
        createdAt: notesLedger.createdAt,
      })
      .from(notesLedger)
      .where(
        and(
          eq(notesLedger.userId, userId),
          gte(notesLedger.createdAt, oldestHistoryStart),
        ),
      )
      .orderBy(asc(notesLedger.createdAt)),
    db
      .select({
        notesInUse: sql<number>`coalesce(sum(abs(${notesLedger.delta})), 0)`,
      })
      .from(notesLedger)
      .where(
        and(
          eq(notesLedger.userId, userId),
          sql`${notesLedger.delta} < 0`,
          gte(notesLedger.createdAt, recentUsageStart),
        ),
      ),
  ]);

  const purchaseTotals = purchaseTotalRows[0];
  const currentBalance = Number(userRows[0]?.notesBalance ?? 0);

  return {
    lifetimeTopupCents: Number(purchaseTotals?.totalCents ?? 0),
    latestPlanSkuId: latestFixedPlanRows[0]?.productId ?? null,
    balanceHistory: buildTopupBalanceHistory({
      currentBalance,
      ledgerEntries: ledgerRows,
      now,
    }),
    notesInUse: Number(recentUsageRows[0]?.notesInUse ?? 0),
  };
}

export function buildTopupBalanceHistory(input: {
  currentBalance: number;
  ledgerEntries: Array<{ delta: number; createdAt: Date }>;
  now: Date;
}): TopupBalanceHistoryRange[] {
  return (Object.keys(HISTORY_RANGES) as TopupHistoryRange[]).map((range) => {
    const config = HISTORY_RANGES[range];
    const timestamps = Array.from({ length: config.points }, (_, index) => (
      new Date(input.now.getTime() - (config.points - 1 - index) * config.stepMs)
    ));
    const points = balancesAtTimestamps({
      currentBalance: input.currentBalance,
      ledgerEntries: input.ledgerEntries,
      timestamps,
    });
    const firstBalance = points[0]?.balance ?? 0;
    const lastBalance = points.at(-1)?.balance ?? firstBalance;
    const changeValue = lastBalance - firstBalance;

    return {
      range,
      points,
      changeValue,
      changePercent: firstBalance !== 0 ? (changeValue / firstBalance) * 100 : 0,
    };
  });
}

function balancesAtTimestamps(input: {
  currentBalance: number;
  ledgerEntries: Array<{ delta: number; createdAt: Date }>;
  timestamps: Date[];
}): TopupBalanceHistoryPoint[] {
  if (input.timestamps.length === 0) return [];

  const entries = input.ledgerEntries
    .map((entry) => ({
      delta: normalizeFiniteNumber(entry.delta),
      time: entry.createdAt.getTime(),
    }))
    .sort((a, b) => a.time - b.time);

  const firstTime = input.timestamps[0]!.getTime();
  let balance = normalizeFiniteNumber(input.currentBalance)
    - entries.reduce((sum, entry) => entry.time > firstTime ? sum + entry.delta : sum, 0);
  let entryIndex = entries.findIndex((entry) => entry.time > firstTime);
  if (entryIndex < 0) entryIndex = entries.length;

  return input.timestamps.map((timestamp, index) => {
    const time = timestamp.getTime();
    if (index > 0) {
      while (entryIndex < entries.length && entries[entryIndex]!.time <= time) {
        balance += entries[entryIndex]!.delta;
        entryIndex += 1;
      }
    }

    return {
      timestamp: timestamp.toISOString(),
      balance: Math.max(0, Math.round(balance)),
    };
  });
}

function normalizeFiniteNumber(value: number): number {
  return Number.isFinite(value) ? value : 0;
}
