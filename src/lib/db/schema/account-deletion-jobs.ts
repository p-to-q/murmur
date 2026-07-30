import type { InferSelectModel } from "drizzle-orm";
import {
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";

import { users } from "./users";

export type AccountDeletionJobStatus = "pending" | "processing" | "completed";

/**
 * Durable account-deletion outbox. The user row remains as a pseudonymous
 * billing tombstone; this job owns removal of identity and creative data.
 */
export const accountDeletionJobs = pgTable(
  "account_deletion_jobs",
  {
    userId: varchar("user_id", { length: 128 })
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    status: varchar("status", { length: 24 })
      .notNull()
      .$type<AccountDeletionJobStatus>()
      .default("pending"),
    requestedAt: timestamp("requested_at").notNull(),
    purgeAfter: timestamp("purge_after").notNull(),
    nextAttemptAt: timestamp("next_attempt_at").notNull(),
    leaseUntil: timestamp("lease_until"),
    attempts: integer("attempts").notNull().default(0),
    objectsDeleted: integer("objects_deleted").notNull().default(0),
    lastError: text("last_error"),
    completedAt: timestamp("completed_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    due: index("account_deletion_jobs_due_idx").on(
      table.status,
      table.nextAttemptAt,
      table.leaseUntil,
    ),
  }),
);

/** Per-object deletion receipts. Missing objects count as successfully deleted. */
export const accountDeletionObjects = pgTable(
  "account_deletion_objects",
  {
    userId: varchar("user_id", { length: 128 })
      .notNull()
      .references(() => accountDeletionJobs.userId, { onDelete: "cascade" }),
    storageKey: text("storage_key").notNull(),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at").notNull().defaultNow(),
    lastError: text("last_error"),
    deletedAt: timestamp("deleted_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.userId, table.storageKey] }),
    due: index("account_deletion_objects_due_idx").on(
      table.userId,
      table.deletedAt,
      table.nextAttemptAt,
    ),
  }),
);

export type AccountDeletionJob = InferSelectModel<typeof accountDeletionJobs>;
export type AccountDeletionObject = InferSelectModel<typeof accountDeletionObjects>;
