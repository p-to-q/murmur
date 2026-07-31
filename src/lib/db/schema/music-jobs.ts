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
  | "submitting"
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
  /** Missing on jobs created before receipt v2 was introduced. */
  originRequestId?: string;
  prompt: string;
  duration: number;
  styleMix: number;
  melody: string;
  humStorageKey: string | null;
  /** Missing on jobs created before durable hum digests were introduced. */
  humDigest?: string | null;
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
  quality?: {
    version: string;
    passed: boolean;
    failures: string[];
    metrics: Record<string, number>;
  };
  diagnostics?: {
    version: number;
    gateVersion: string;
    evidence: "verified" | "legacy_missing";
    candidateCount: number;
    totalGenerationMs: number | null;
    workerWallMs: number | null;
    estimatedCostUsd: number | null;
    runtime: Record<string, string>;
    inputReceipt: {
      version: number;
      requestId: string;
      promptSha256: string;
      duration: number;
      styleMix: number;
      melodySha256: string | null;
      melodyAccepted: boolean;
      melodyValidNoteCount: number | null;
      humSha256: string | null;
      humAccepted: boolean | null;
    } | null;
    candidates: Array<{
      candidateId: string | null;
      attempt: number;
      audioSha256: string | null;
      duplicateOfAttempt: number | null;
      generationMs: number | null;
      sampling: {
        temperature: number | null;
        topK: number | null;
        seedControl: string;
      };
      conditioning: {
        styleMix: number | null;
        melodyConditioned: boolean | null;
        melodySegments: number | null;
        melodyOnsets: number | null;
        melodyCoverage: number | null;
        cfgNotes: number | null;
        preNormalizationPeak: number | null;
        preNormalizationRms: number | null;
        normalizationGainDb: number | null;
      };
      quality: {
        version: string;
        passed: boolean;
        failures: string[];
        metrics: Record<string, number>;
      } | null;
    }>;
  };
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
    // The physical column remains `attempt` for a no-risk compatibility
    // migration; semantically this is a fencing epoch, not a model retry.
    leaseEpoch: integer("attempt").notNull().default(0),
    leaseUntil: timestamp("lease_until"),
    providerSubmittedAt: timestamp("provider_submitted_at"),
    // Keep a DB default during the expand/contract window. The pre-dispatcher
    // app omits this column, so migrate-before-deploy and app-only rollback
    // remain write-compatible while new code still supplies an exact deadline.
    deadlineAt: timestamp("deadline_at")
      .notNull()
      .default(sql`now() + interval '15 minutes'`),
    // Old app versions omit this dispatcher column during migrate-before-deploy.
    // Keep the default through the compatibility window so accepted jobs remain runnable.
    nextRunAt: timestamp("next_run_at").defaultNow(),
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
    runnable: index("music_jobs_runnable_v2_idx").on(t.status, t.nextRunAt, t.leaseUntil),
    providerJob: uniqueIndex("music_jobs_provider_job_uidx")
      .on(t.provider, t.providerJobId)
      .where(sql`${t.providerJobId} IS NOT NULL`),
  }),
);

export type MusicJob = InferSelectModel<typeof musicJobs>;
