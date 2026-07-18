import { sql } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

import { notesLedger } from "./notes-ledger";
import { users } from "./users";

export type MusicJobStatus =
  | "accepted"
  | "queued"
  | "running"
  | "result_ready"
  | "cancel_requested"
  | "submission_unknown"
  | "succeeded"
  | "failed"
  | "canceled"
  | "expired";

export interface MusicJobInput {
  prompt: string;
  duration: number;
  styleMix: number;
  melody: string;
  humStorageKey: string | null;
  humContentType: string | null;
  generationBatchId: string | null;
}

export interface MusicJobOutput {
  storageKey: string;
  contentType: string;
  sizeBytes: number;
  digest: string;
  model: string;
  generationMs: number | null;
  styleMix: string;
}

export const musicJobs = pgTable(
  "music_jobs",
  {
    id: text("id").primaryKey(),
    userId: varchar("user_id", { length: 128 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    operationId: varchar("operation_id", { length: 128 }).notNull(),
    requestHash: varchar("request_hash", { length: 64 }).notNull(),
    status: varchar("status", { length: 32 })
      .notNull()
      .$type<MusicJobStatus>()
      .default("accepted"),
    input: jsonb("input").$type<MusicJobInput>().notNull(),
    output: jsonb("output").$type<MusicJobOutput | null>(),
    provider: varchar("provider", { length: 32 }),
    providerJobId: text("provider_job_id"),
    spendLedgerId: text("spend_ledger_id").references(() => notesLedger.id, {
      onDelete: "set null",
    }),
    attempt: integer("attempt").notNull().default(0),
    leaseUntil: timestamp("lease_until"),
    cancelRequestedAt: timestamp("cancel_requested_at"),
    errorCode: varchar("error_code", { length: 64 }),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    startedAt: timestamp("started_at"),
    finishedAt: timestamp("finished_at"),
  },
  (t) => ({
    operation: uniqueIndex("music_jobs_user_operation_uidx").on(t.userId, t.operationId),
    byUserTime: index("music_jobs_user_time_idx").on(t.userId, t.createdAt),
    runnable: index("music_jobs_runnable_idx").on(t.status, t.leaseUntil),
    providerJob: uniqueIndex("music_jobs_provider_job_uidx")
      .on(t.provider, t.providerJobId)
      .where(sql`${t.providerJobId} IS NOT NULL`),
  }),
);

export type MusicJob = InferSelectModel<typeof musicJobs>;
