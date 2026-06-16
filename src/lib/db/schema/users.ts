import type { InferSelectModel } from "drizzle-orm";
import { index, integer, pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";

export const users = pgTable(
  "users",
  {
    id: varchar("id", { length: 128 }).primaryKey(),
    email: varchar("email", { length: 256 }).unique(),
    name: text("name"),
    avatarUrl: text("avatar_url"),
    regionId: varchar("region_id", { length: 8 }).notNull().default("intl"),
    accountKind: varchar("account_kind", { length: 32 }).notNull().default("registered"),
    notesBalance: integer("notes_balance").notNull().default(15),
    freeNotesGrantedAt: timestamp("free_notes_granted_at").notNull().defaultNow(),
    planTier: varchar("plan_tier", { length: 32 }).notNull().default("free"),
    promotedAt: timestamp("promoted_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    emailIdx: index("users_email_idx").on(table.email),
    accountKindIdx: index("users_account_kind_idx").on(table.accountKind),
    regionIdIdx: index("users_region_id_idx").on(table.regionId),
    createdAtIdx: index("users_created_at_idx").on(table.createdAt),
  })
);

export type User = InferSelectModel<typeof users>;
