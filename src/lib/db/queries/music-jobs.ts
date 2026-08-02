import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, lt, lte, or, sql } from "drizzle-orm";

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
import { recordPendingRefundInTransaction } from "./notes-ledger";
import { musicJobDeadlineFrom } from "@/lib/music/music-job-policy";
import { users } from "../schema/users";
import { notesLedger } from "../schema/notes-ledger";

const TERMINAL_STATUSES: MusicJobStatus[] = [
  "succeeded", "failed", "canceled", "expired", "submission_unknown",
];
const ACTIVE_STATUSES: MusicJobStatus[] = [
  "accepted", "submitting", "queued", "running",
];

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type CreateMusicJobResult =
  | { ok: true; job: MusicJob; duplicate: boolean; spend: SpendNotesResult | null }
  | { ok: false; reason: "idempotency_conflict"; job: MusicJob | null }
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
    const [activeUser] = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, input.userId), sql`${users.deletedAt} IS NULL`))
      .limit(1)
      .for("update");
    if (!activeUser) {
      return { ok: false as const, reason: "user_not_found" as const, currentBalance: 0 };
    }

    const existing = await findByOperation(tx, input.userId, input.operationId);
    if (existing) return classifyReplay(existing, input.requestHash);

    const [orphanSpend] = await tx
      .select({ id: notesLedger.id })
      .from(notesLedger)
      .where(and(
        eq(notesLedger.userId, input.userId),
        eq(notesLedger.reason, "spend:music_generate"),
        eq(notesLedger.externalRef, `music_generate:${input.operationId}`),
      ))
      .limit(1);
    // A job and its spend are now atomic. A spend without a job came from the
    // legacy direct route and carries no trustworthy request receipt, so it
    // cannot be adopted by arbitrary new input under the same operation id.
    if (orphanSpend) {
      return { ok: false as const, reason: "idempotency_conflict" as const, job: null };
    }

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
    const now = new Date();
    const inserted = await tx
      .insert(musicJobs)
      .values({
        id,
        userId: input.userId,
        operationId: input.operationId,
        requestHash: input.requestHash,
        input: input.input,
        spendLedgerId: spend?.ok && spend.ledgerId ? spend.ledgerId : null,
        deadlineAt: musicJobDeadlineFrom(now),
        nextRunAt: now,
        createdAt: now,
        updatedAt: now,
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

export async function getMusicJobByOperationForUser(
  userId: string,
  operationId: string,
): Promise<MusicJob | null> {
  const [job] = await db
    .select()
    .from(musicJobs)
    .where(and(eq(musicJobs.userId, userId), eq(musicJobs.operationId, operationId)))
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
      status: sql`case
        when ${musicJobs.status} = 'cancel_requested' then 'cancel_requested'
        when ${musicJobs.status} = 'accepted' then 'submitting'
        else 'running'
      end`,
      leaseUntil,
      // A raw Date interpolated into a sql`` template is bound without the
      // timestamp mapper, so Postgres receives it as
      // "Sun Aug 02 2026 09:04:27 GMT+0000 (Coordinated Universal Time)"
      // and rejects the whole statement. Column assignments like updatedAt
      // are mapped by drizzle; values inside a template are not.
      startedAt: sql`coalesce(${musicJobs.startedAt}, ${now.toISOString()}::timestamp)`,
      leaseEpoch: sql`${musicJobs.leaseEpoch} + 1`,
      nextRunAt: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(musicJobs.id, input.jobId),
        eq(musicJobs.userId, input.userId),
        or(
          eq(musicJobs.status, "accepted"),
          and(
            inArray(musicJobs.status, ["queued", "running", "cancel_requested"]),
            sql`${musicJobs.providerJobId} IS NOT NULL`,
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
  leaseEpoch: number;
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
      providerSubmittedAt: now,
      leaseUntil: new Date(now.getTime() + input.leaseMs),
      nextRunAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(musicJobs.id, input.jobId),
        eq(musicJobs.userId, input.userId),
        eq(musicJobs.leaseEpoch, input.leaseEpoch),
        inArray(musicJobs.status, ["submitting", "cancel_requested"]),
        sql`${musicJobs.providerJobId} IS NULL`,
      ),
    )
    .returning();
  return job ?? null;
}

export async function refreshMusicJobSubmissionLease(input: {
  userId: string;
  jobId: string;
  leaseEpoch: number;
  leaseMs: number;
}): Promise<MusicJob | null> {
  const now = new Date();
  const [job] = await db
    .update(musicJobs)
    .set({
      leaseUntil: new Date(now.getTime() + input.leaseMs),
      updatedAt: now,
    })
    .where(and(
      eq(musicJobs.id, input.jobId),
      eq(musicJobs.userId, input.userId),
      eq(musicJobs.leaseEpoch, input.leaseEpoch),
      inArray(musicJobs.status, ["submitting", "cancel_requested"]),
      sql`${musicJobs.providerJobId} IS NULL`,
    ))
    .returning();
  return job ?? null;
}

export async function releaseMusicJobLease(input: {
  userId: string;
  jobId: string;
  leaseEpoch: number;
  nextRunAt?: Date;
}): Promise<void> {
  await db
    .update(musicJobs)
    .set({
      leaseUntil: null,
      nextRunAt: input.nextRunAt ?? new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(musicJobs.id, input.jobId),
        eq(musicJobs.userId, input.userId),
        eq(musicJobs.leaseEpoch, input.leaseEpoch),
        inArray(musicJobs.status, ["submitting", "queued", "running", "cancel_requested"]),
      ),
    );
}

export async function succeedMusicJob(input: {
  userId: string;
  jobId: string;
  output: MusicJobOutput;
}): Promise<MusicJob | null> {
  const now = new Date();
  const [job] = await db
    .update(musicJobs)
    .set({
      status: "succeeded",
      output: input.output,
      errorCode: null,
      errorMessage: null,
      leaseUntil: null,
      nextRunAt: null,
      finishedAt: now,
      updatedAt: now,
    })
    .where(and(
      eq(musicJobs.id, input.jobId),
      eq(musicJobs.userId, input.userId),
      eq(musicJobs.status, "result_ready"),
    ))
    .returning();
  return job ?? null;
}

export async function recordMusicJobResult(input: {
  userId: string;
  jobId: string;
  leaseEpoch: number;
  output: MusicJobOutput;
}): Promise<MusicJob | null> {
  const now = new Date();
  const [job] = await db
    .update(musicJobs)
    .set({
      status: "result_ready",
      output: input.output,
      leaseUntil: null,
      nextRunAt: now,
      errorCode: null,
      errorMessage: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(musicJobs.id, input.jobId),
        eq(musicJobs.userId, input.userId),
        eq(musicJobs.leaseEpoch, input.leaseEpoch),
        inArray(musicJobs.status, ["queued", "running", "cancel_requested"]),
      ),
    )
    .returning();
  return job ?? null;
}

export async function markMusicJobSubmissionUnknown(input: {
  userId: string;
  jobId: string;
  errorMessage: string;
  leaseEpoch?: number;
  leaseExpiredBefore?: Date;
}): Promise<MusicJob | null> {
  const now = new Date();
  return terminalizeMusicJobWithRefundIntent({
    userId: input.userId,
    jobId: input.jobId,
    leaseEpoch: input.leaseEpoch,
    status: "submission_unknown",
    errorCode: "submission_unknown",
    errorMessage: input.errorMessage,
    // `running` covers rows created before the explicit submitting state
    // existed. A missing provider id there is equally ambiguous and must never
    // be resubmitted during a rolling deployment.
    allowedStatuses: ["submitting", "running", "cancel_requested"],
    requireProviderMissing: true,
    leaseExpiredBefore: input.leaseExpiredBefore,
    now,
  });
}

export async function failMusicJob(input: {
  userId: string;
  jobId: string;
  leaseEpoch?: number;
  errorCode: string;
  errorMessage: string;
}): Promise<MusicJob | null> {
  return terminalizeMusicJobWithRefundIntent({
    userId: input.userId,
    jobId: input.jobId,
    leaseEpoch: input.leaseEpoch,
    status: "failed",
    errorCode: input.errorCode,
    errorMessage: input.errorMessage,
  });
}

export async function expireMusicJob(input: {
  userId: string;
  jobId: string;
  leaseEpoch?: number;
  errorCode: string;
  errorMessage: string;
}): Promise<MusicJob | null> {
  return terminalizeMusicJobWithRefundIntent({
    ...input,
    status: "expired",
  });
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
        // A submit in flight owns this lease until it attaches the provider or
        // becomes submission_unknown. Releasing it permits a second /run.
        leaseUntil: nextStatus === "cancel_requested" ? current.leaseUntil : null,
        nextRunAt: nextStatus === "cancel_requested" ? current.nextRunAt : null,
        finishedAt: nextStatus === "canceled" ? now : null,
        updatedAt: now,
      })
      .where(and(eq(musicJobs.id, jobId), eq(musicJobs.userId, userId)))
      .returning();
    if (job && nextStatus === "canceled" && job.spendLedgerId) {
      await recordPendingRefundInTransaction(tx, {
        userId: job.userId,
        originalLedgerId: job.spendLedgerId,
        amount: COST.music_generate,
        spendReason: "spend:music_generate",
        source: "music_job_terminal_state",
        metadata: { jobId: job.id, trigger: "user_canceled" },
      });
    }
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
  return job.providerJobId || job.status === "submitting" || job.status === "running"
    ? "cancel_requested"
    : "canceled";
}

export async function confirmMusicJobCanceled(
  userId: string,
  jobId: string,
  leaseEpoch?: number,
): Promise<MusicJob | null> {
  return terminalizeMusicJobWithRefundIntent({
    userId,
    jobId,
    leaseEpoch,
    status: "canceled",
    errorCode: "user_canceled",
    errorMessage: "Music generation was canceled",
  });
}

export async function listRunnableMusicJobs(input: {
  limit: number;
  now?: Date;
}): Promise<Array<{ id: string; userId: string }>> {
  const now = input.now ?? new Date();
  const limit = Math.max(1, Math.min(100, Math.trunc(input.limit)));
  return db
    .select({ id: musicJobs.id, userId: musicJobs.userId })
    .from(musicJobs)
    .where(and(
      inArray(musicJobs.status, [
        "accepted", "queued", "running", "cancel_requested", "result_ready",
      ]),
      or(lte(musicJobs.nextRunAt, now), sql`${musicJobs.nextRunAt} IS NULL`),
      or(lt(musicJobs.leaseUntil, now), sql`${musicJobs.leaseUntil} IS NULL`),
    ))
    .orderBy(asc(musicJobs.nextRunAt), asc(musicJobs.createdAt))
    .limit(limit);
}

export async function terminalizeExpiredSubmittingJobs(input: {
  limit: number;
  now?: Date;
}): Promise<MusicJob[]> {
  const now = input.now ?? new Date();
  const rows = await db
    .select({ id: musicJobs.id, userId: musicJobs.userId, leaseEpoch: musicJobs.leaseEpoch })
    .from(musicJobs)
    .where(and(
      inArray(musicJobs.status, ["submitting", "running", "cancel_requested"]),
      sql`${musicJobs.providerJobId} IS NULL`,
      or(lt(musicJobs.leaseUntil, now), sql`${musicJobs.leaseUntil} IS NULL`),
    ))
    .orderBy(asc(musicJobs.leaseUntil))
    .limit(Math.max(1, Math.min(100, Math.trunc(input.limit))));
  const terminalized: Array<MusicJob | null> = [];
  for (const row of rows) {
    terminalized.push(await markMusicJobSubmissionUnknown({
      userId: row.userId,
      jobId: row.id,
      leaseEpoch: row.leaseEpoch,
      leaseExpiredBefore: now,
      errorMessage: "Provider submission lease expired before a job id was recorded",
    }));
  }
  return terminalized.filter((job): job is MusicJob => Boolean(job));
}

async function terminalizeMusicJobWithRefundIntent(input: {
  userId: string;
  jobId: string;
  leaseEpoch?: number;
  status: Extract<MusicJobStatus, "failed" | "canceled" | "expired" | "submission_unknown">;
  errorCode: string;
  errorMessage: string;
  allowedStatuses?: MusicJobStatus[];
  requireProviderMissing?: boolean;
  leaseExpiredBefore?: Date;
  now?: Date;
}): Promise<MusicJob | null> {
  return db.transaction(async (tx) => {
    const now = input.now ?? new Date();
    const [job] = await tx
      .update(musicJobs)
      .set({
        status: input.status,
        errorCode: input.errorCode,
        errorMessage: input.errorMessage.slice(0, 2_000),
        leaseUntil: null,
        nextRunAt: null,
        finishedAt: now,
        updatedAt: now,
      })
      .where(and(
        eq(musicJobs.id, input.jobId),
        eq(musicJobs.userId, input.userId),
        ...(input.leaseEpoch === undefined
          ? []
          : [eq(musicJobs.leaseEpoch, input.leaseEpoch)]),
        inArray(musicJobs.status, input.allowedStatuses ?? [
          ...ACTIVE_STATUSES, "cancel_requested",
        ]),
        sql`${musicJobs.output} IS NULL`,
        ...(input.requireProviderMissing
          ? [sql`${musicJobs.providerJobId} IS NULL`]
          : []),
        ...(input.leaseExpiredBefore
          ? [or(
              lt(musicJobs.leaseUntil, input.leaseExpiredBefore),
              sql`${musicJobs.leaseUntil} IS NULL`,
            )]
          : []),
      ))
      .returning();
    if (!job) return null;
    if (job.spendLedgerId) {
      await recordPendingRefundInTransaction(tx, {
        userId: job.userId,
        originalLedgerId: job.spendLedgerId,
        amount: COST.music_generate,
        spendReason: "spend:music_generate",
        source: "music_job_terminal_state",
        metadata: { jobId: job.id, trigger: input.errorCode },
      });
    }
    return job;
  });
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
