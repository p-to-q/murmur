import { randomUUID } from "node:crypto";
import { and, eq, inArray, lt, or, sql } from "drizzle-orm";

import { COST } from "@murmur/core";
import { db } from "../client";
import {
  musicJobs,
  type MusicJob,
  type MusicJobInput,
  type MusicJobOutput,
  type MusicJobStatus,
} from "../schema/music-jobs";
import { spendNotesInTransaction, type SpendNotesResult } from "./notes-ledger";

const TERMINAL_STATUSES: MusicJobStatus[] = [
  "succeeded", "failed", "canceled", "expired", "submission_unknown",
];
const ACTIVE_STATUSES: MusicJobStatus[] = ["accepted", "queued", "running", "result_ready"];

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type CreateMusicJobResult =
  | { ok: true; job: MusicJob; duplicate: boolean; spend: SpendNotesResult | null }
  | { ok: false; reason: "idempotency_conflict"; job: MusicJob }
  | {
      ok: false;
      reason: "insufficient_notes" | "user_not_found";
      currentBalance: number;
    };

export interface CreateMusicJobInput {
  userId: string;
  operationId: string;
  requestHash: string;
  input: MusicJobInput;
  requestId: string;
  bill: boolean;
}

/**
 * Create the durable job and its paid ledger spend in one transaction.
 * Replays with the same request hash return the original job; a reused
 * operation id with different input is an explicit conflict.
 */
export async function createMusicJob(
  input: CreateMusicJobInput,
): Promise<CreateMusicJobResult> {
  return db.transaction(async (tx) => {
    const existing = await findByOperation(tx, input.userId, input.operationId);
    if (existing) return classifyReplay(existing, input.requestHash);

    const spend = input.bill
      ? await spendNotesInTransaction(tx, {
          userId: input.userId,
          cost: COST.music_generate,
          reason: "spend:music_generate",
          externalRef: `music_generate:${input.operationId}`,
          metadata: {
            requestId: input.requestId,
            route: "/api/music/jobs",
            phase: "job_accept",
            requestHash: input.requestHash,
          },
        })
      : null;

    if (spend && !spend.ok) {
      return {
        ok: false as const,
        reason: spend.reason,
        currentBalance: spend.currentBalance,
      };
    }

    const id = createMusicJobId();
    const inserted = await tx
      .insert(musicJobs)
      .values({
        id,
        userId: input.userId,
        operationId: input.operationId,
        requestHash: input.requestHash,
        input: input.input,
        spendLedgerId: spend?.ok && spend.ledgerId ? spend.ledgerId : null,
      })
      .onConflictDoNothing({
        target: [musicJobs.userId, musicJobs.operationId],
      })
      .returning();

    if (inserted[0]) {
      return { ok: true as const, job: inserted[0], duplicate: false, spend };
    }

    // A concurrent request won the operation key. The user-row lock used by
    // spend serialization ensures this transaction did not double-charge.
    const raced = await findByOperation(tx, input.userId, input.operationId);
    if (!raced) throw new Error("music_job_insert_race_without_winner");
    return classifyReplay(raced, input.requestHash, spend);
  });
}

export async function getMusicJobForUser(
  userId: string,
  jobId: string,
): Promise<MusicJob | null> {
  const [job] = await db
    .select()
    .from(musicJobs)
    .where(and(eq(musicJobs.id, jobId), eq(musicJobs.userId, userId)))
    .limit(1);
  return job ?? null;
}

export async function claimMusicJob(input: {
  userId: string;
  jobId: string;
  leaseMs: number;
}): Promise<MusicJob | null> {
  const now = new Date();
  const leaseUntil = new Date(now.getTime() + input.leaseMs);
  const [job] = await db
    .update(musicJobs)
    .set({
      status: sql`case when ${musicJobs.status} = 'cancel_requested' then 'cancel_requested' else 'running' end`,
      leaseUntil,
      startedAt: sql`coalesce(${musicJobs.startedAt}, ${now})`,
      attempt: sql`${musicJobs.attempt} + 1`,
      updatedAt: now,
    })
    .where(
      and(
        eq(musicJobs.id, input.jobId),
        eq(musicJobs.userId, input.userId),
        or(
          eq(musicJobs.status, "accepted"),
          eq(musicJobs.status, "result_ready"),
          and(
            inArray(musicJobs.status, ["queued", "running", "cancel_requested"]),
            or(lt(musicJobs.leaseUntil, now), sql`${musicJobs.leaseUntil} IS NULL`),
          ),
        ),
      ),
    )
    .returning();
  return job ?? null;
}

export async function attachMusicJobProvider(input: {
  userId: string;
  jobId: string;
  attempt: number;
  provider: string;
  providerJobId: string;
  leaseMs: number;
}): Promise<MusicJob | null> {
  const now = new Date();
  const [job] = await db
    .update(musicJobs)
    .set({
      status: sql`case when ${musicJobs.status} = 'cancel_requested' then 'cancel_requested' else 'queued' end`,
      provider: input.provider,
      providerJobId: input.providerJobId,
      leaseUntil: new Date(now.getTime() + input.leaseMs),
      updatedAt: now,
    })
    .where(
      and(
        eq(musicJobs.id, input.jobId),
        eq(musicJobs.userId, input.userId),
        eq(musicJobs.attempt, input.attempt),
        inArray(musicJobs.status, ["running", "cancel_requested"]),
      ),
    )
    .returning();
  return job ?? null;
}

export async function renewMusicJobLease(input: {
  userId: string;
  jobId: string;
  attempt: number;
  leaseMs: number;
}): Promise<void> {
  const now = new Date();
  await db
    .update(musicJobs)
    .set({ leaseUntil: new Date(now.getTime() + input.leaseMs), updatedAt: now })
    .where(
      and(
        eq(musicJobs.id, input.jobId),
        eq(musicJobs.userId, input.userId),
        eq(musicJobs.attempt, input.attempt),
        inArray(musicJobs.status, ["queued", "running", "cancel_requested"]),
      ),
    );
}

export async function releaseMusicJobLease(input: {
  userId: string;
  jobId: string;
  attempt: number;
}): Promise<void> {
  await db
    .update(musicJobs)
    .set({ leaseUntil: null, updatedAt: new Date() })
    .where(
      and(
        eq(musicJobs.id, input.jobId),
        eq(musicJobs.userId, input.userId),
        eq(musicJobs.attempt, input.attempt),
        inArray(musicJobs.status, ["queued", "running", "cancel_requested"]),
      ),
    );
}

export async function succeedMusicJob(input: {
  userId: string;
  jobId: string;
  output: MusicJobOutput;
}): Promise<MusicJob | null> {
  return finishMusicJob(input.userId, input.jobId, "succeeded", {
    output: input.output,
    errorCode: null,
    errorMessage: null,
  });
}

export async function recordMusicJobResult(input: {
  userId: string;
  jobId: string;
  attempt: number;
  output: MusicJobOutput;
}): Promise<MusicJob | null> {
  const now = new Date();
  const [job] = await db
    .update(musicJobs)
    .set({
      status: "result_ready",
      output: input.output,
      leaseUntil: null,
      errorCode: null,
      errorMessage: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(musicJobs.id, input.jobId),
        eq(musicJobs.userId, input.userId),
        eq(musicJobs.attempt, input.attempt),
        inArray(musicJobs.status, ["queued", "running", "cancel_requested", "result_ready"]),
      ),
    )
    .returning();
  return job ?? null;
}

export async function markMusicJobSubmissionUnknown(input: {
  userId: string;
  jobId: string;
  errorMessage: string;
}): Promise<MusicJob | null> {
  const now = new Date();
  const [job] = await db
    .update(musicJobs)
    .set({
      status: "submission_unknown",
      errorCode: "submission_unknown",
      errorMessage: input.errorMessage.slice(0, 2_000),
      leaseUntil: null,
      finishedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(musicJobs.id, input.jobId),
        eq(musicJobs.userId, input.userId),
        eq(musicJobs.status, "running"),
        sql`${musicJobs.providerJobId} IS NULL`,
      ),
    )
    .returning();
  return job ?? null;
}

export async function failMusicJob(input: {
  userId: string;
  jobId: string;
  attempt?: number;
  errorCode: string;
  errorMessage: string;
}): Promise<MusicJob | null> {
  return finishMusicJob(input.userId, input.jobId, "failed", {
    errorCode: input.errorCode,
    errorMessage: input.errorMessage.slice(0, 2_000),
  }, input.attempt);
}

export type CancelMusicJobResult =
  | { kind: "not_found" }
  | { kind: "terminal"; job: MusicJob }
  | { kind: "canceled"; job: MusicJob }
  | { kind: "cancel_requested"; job: MusicJob };

export async function requestMusicJobCancellation(
  userId: string,
  jobId: string,
): Promise<CancelMusicJobResult> {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(musicJobs)
      .where(and(eq(musicJobs.id, jobId), eq(musicJobs.userId, userId)))
      .limit(1)
      .for("update");
    if (!current) return { kind: "not_found" as const };
    if (TERMINAL_STATUSES.includes(current.status)) {
      return { kind: "terminal" as const, job: current };
    }
    // Once output is durably recorded, delivery settlement owns the outcome.
    // Refunding here would give away completed provider work and race success.
    const cancellationStatus = nextMusicJobCancellationStatus(current);
    if (cancellationStatus === "terminal") {
      return { kind: "terminal" as const, job: current };
    }

    const now = new Date();
    // `running` with no provider id can mean submit is in flight. Preserve a
    // cancellation intent so the runner can attach then cancel the returned id.
    const nextStatus = cancellationStatus;
    const [job] = await tx
      .update(musicJobs)
      .set({
        status: nextStatus,
        cancelRequestedAt: now,
        leaseUntil: null,
        finishedAt: nextStatus === "canceled" ? now : null,
        updatedAt: now,
      })
      .where(and(eq(musicJobs.id, jobId), eq(musicJobs.userId, userId)))
      .returning();
    return nextStatus === "canceled"
      ? { kind: "canceled" as const, job: job! }
      : { kind: "cancel_requested" as const, job: job! };
  });
}

export function nextMusicJobCancellationStatus(
  job: Pick<MusicJob, "status" | "providerJobId" | "output">,
): "terminal" | "canceled" | "cancel_requested" {
  if (TERMINAL_STATUSES.includes(job.status) || job.status === "result_ready" || job.output) {
    return "terminal";
  }
  return job.providerJobId || job.status === "running"
    ? "cancel_requested"
    : "canceled";
}

export async function confirmMusicJobCanceled(
  userId: string,
  jobId: string,
  attempt?: number,
): Promise<MusicJob | null> {
  return finishMusicJob(userId, jobId, "canceled", {}, attempt);
}

async function finishMusicJob(
  userId: string,
  jobId: string,
  status: Extract<MusicJobStatus, "succeeded" | "failed" | "canceled">,
  values: Partial<Pick<MusicJob, "output" | "errorCode" | "errorMessage">>,
  attempt?: number,
): Promise<MusicJob | null> {
  const now = new Date();
  const [job] = await db
    .update(musicJobs)
    .set({ ...values, status, leaseUntil: null, finishedAt: now, updatedAt: now })
    .where(
      and(
        eq(musicJobs.id, jobId),
        eq(musicJobs.userId, userId),
        ...(attempt === undefined ? [] : [eq(musicJobs.attempt, attempt)]),
        inArray(musicJobs.status, [...ACTIVE_STATUSES, "cancel_requested"]),
      ),
    )
    .returning();
  return job ?? null;
}

async function findByOperation(
  tx: DbTransaction,
  userId: string,
  operationId: string,
): Promise<MusicJob | null> {
  const [job] = await tx
    .select()
    .from(musicJobs)
    .where(and(eq(musicJobs.userId, userId), eq(musicJobs.operationId, operationId)))
    .limit(1);
  return job ?? null;
}

function classifyReplay(
  job: MusicJob,
  requestHash: string,
  spend: SpendNotesResult | null = null,
): CreateMusicJobResult {
  return job.requestHash === requestHash
    ? { ok: true, job, duplicate: true, spend }
    : { ok: false, reason: "idempotency_conflict", job };
}

function createMusicJobId(): string {
  return `mjob_${randomUUID().replaceAll("-", "")}`;
}
