import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { TOPUP_SKUS } from "@murmur/core";

import { db } from "@/lib/db/client";
import { purchases } from "@/lib/db/schema/purchases";

export interface TopupSurfaceSnapshot {
  lifetimeTopupCents: number;
  latestPlanSkuId: string | null;
}

const FIXED_PLAN_SKU_IDS = TOPUP_SKUS.map((sku) => sku.id);

export async function getTopupSurfaceSnapshot(userId: string): Promise<TopupSurfaceSnapshot> {
  const [purchaseTotalRows, latestFixedPlanRows] = await Promise.all([
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
  ]);

  const purchaseTotals = purchaseTotalRows[0];

  return {
    lifetimeTopupCents: Number(purchaseTotals?.totalCents ?? 0),
    latestPlanSkuId: latestFixedPlanRows[0]?.productId ?? null,
  };
}
