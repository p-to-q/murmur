import type { InferSelectModel } from "drizzle-orm";
import { doublePrecision, index, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const rateLimits = pgTable(
  "rate_limits",
  {
    bucketKey: text("bucket_key").primaryKey(),
    tokens: doublePrecision("tokens").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
  },
  (table) => ({
    expiresAtIdx: index("rate_limits_expires_at_idx").on(table.expiresAt),
  }),
);

export type RateLimitRow = InferSelectModel<typeof rateLimits>;
