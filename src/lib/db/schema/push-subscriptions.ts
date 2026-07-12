import type { InferSelectModel } from "drizzle-orm";
import { sql } from "drizzle-orm";
import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

import { users } from "./users";

export type PushSubscriptionKeys = {
  p256dh: string;
  auth: string;
};

export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: text("id").primaryKey(),
    userId: varchar("user_id", { length: 128 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sessionId: text("session_id"),
    endpoint: text("endpoint").notNull(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    expirationTime: timestamp("expiration_time"),
    shell: varchar("shell", { length: 16 }).notNull().default("web"),
    userAgent: text("user_agent"),
    metadata: jsonb("metadata")
      .$type<{ locale?: string; timezone?: string }>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    lastSeenAt: timestamp("last_seen_at").notNull().defaultNow(),
    disabledAt: timestamp("disabled_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    byUser: index("push_subscriptions_user_idx").on(table.userId),
    byActiveUser: index("push_subscriptions_active_user_idx").on(
      table.userId,
      table.disabledAt,
    ),
    byActive: index("push_subscriptions_active_idx")
      .on(table.lastSeenAt)
      .where(sql`${table.disabledAt} IS NULL`),
    byActiveId: index("push_subscriptions_active_id_idx")
      .on(table.id)
      .where(sql`${table.disabledAt} IS NULL`),
    byEndpoint: uniqueIndex("push_subscriptions_endpoint_idx").on(table.endpoint),
  }),
);

export type PushSubscriptionRecord = InferSelectModel<typeof pushSubscriptions>;
