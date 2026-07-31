import type { InferSelectModel } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";

import type { TranscriptionResult } from "@/modules/shared/types";
import { notesLedger } from "./notes-ledger";
import { users } from "./users";

export type TranscriptionOperationStatus =
  | "processing"
  | "result_ready"
  | "succeeded"
  | "retryable";

export const transcriptionOperations = pgTable(
  "transcription_operations",
  {
    userId: varchar("user_id", { length: 128 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    operationId: varchar("operation_id", { length: 128 }).notNull(),
    requestHash: varchar("request_hash", { length: 64 }).notNull(),
    status: varchar("status", { length: 24 })
      .notNull()
      .$type<TranscriptionOperationStatus>()
      .default("processing"),
    result: jsonb("result").$type<TranscriptionResult | null>(),
    spendLedgerId: text("spend_ledger_id").references(() => notesLedger.id, {
      onDelete: "set null",
    }),
    leaseEpoch: integer("lease_epoch").notNull().default(0),
    leaseUntil: timestamp("lease_until"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    finishedAt: timestamp("finished_at"),
  },
  (table) => ({
    primary: primaryKey({
      name: "transcription_operations_pkey",
      columns: [table.userId, table.operationId],
    }),
    byStatusLease: index("transcription_operations_status_lease_idx").on(
      table.status,
      table.leaseUntil,
    ),
  }),
);

export type TranscriptionOperation = InferSelectModel<typeof transcriptionOperations>;
