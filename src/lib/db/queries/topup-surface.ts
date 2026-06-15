import { and, eq, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { purchases } from "@/lib/db/schema/purchases";

export interface TopupSurfaceSnapshot {
  lifetimeTopupCents: number;
}

export async function getTopupSurfaceSnapshot(userId: string): Promise<TopupSurfaceSnapshot> {
  const [purchaseTotals] = await db
    .select({
      totalCents: sql<number>`coalesce(sum(${purchases.amountCents}), 0)`,
    })
    .from(purchases)
    .where(
      and(
        eq(purchases.userId, userId),
        eq(purchases.status, "succeeded"),
      ),
    );

  return {
    lifetimeTopupCents: Number(purchaseTotals?.totalCents ?? 0),
  };
}
