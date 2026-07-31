import { and, eq, sql } from "drizzle-orm";

import { COST } from "@murmur/core";
import type { TranscriptionResult } from "@/modules/shared/types";
import { db } from "../client";
import {
  transcriptionOperations,
  type TranscriptionOperation,
} from "../schema/transcription-operations";
import { notesLedger } from "../schema/notes-ledger";
import { users } from "../schema/users";
import {
  recordPendingRefundInTransaction,
  spendNotesInTransaction,
  type SpendNotesResult,
} from "./notes-ledger";

const OPERATION_LEASE_MS = 60_000;
type SuccessfulSpend = Extract<SpendNotesResult, { ok: true }>;
export type TranscriptionOperationSpend = SuccessfulSpend | {
  ok: true;
  ledgerId: string;
  balanceBefore: null;
  balanceAfter: null;
  duplicate: false;
};

export type BeginTranscriptionOperationResult =
  | {
      ok: true;
      kind: "proceed";
      operation: TranscriptionOperation;
      spend: TranscriptionOperationSpend | null;
      charged: boolean;
    }
  | {
      ok: true;
      kind: "replay" | "result_ready";
      operation: TranscriptionOperation & { result: TranscriptionResult };
    }
  | { ok: false; reason: "idempotency_conflict" | "operation_in_progress" }
  | {
      ok: false;
      reason: "insufficient_notes" | "user_not_found";
      currentBalance: number;
    };

export async function beginTranscriptionOperation(input: {
  userId: string;
  operationId: string;
  requestHash: string;
  requestId: string;
  targetInstrument: string;
  bill: boolean;
  now?: Date;
}): Promise<BeginTranscriptionOperationResult> {
  return db.transaction(async (tx) => {
    const now = input.now ?? new Date();
    const [activeUser] = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, input.userId), sql`${users.deletedAt} IS NULL`))
      .limit(1)
      .for("update");
    if (!activeUser) {
      return { ok: false as const, reason: "user_not_found" as const, currentBalance: 0 };
    }

    const existing = await findOperation(tx, input.userId, input.operationId);
    if (existing) {
      if (existing.requestHash !== input.requestHash) {
        return { ok: false as const, reason: "idempotency_conflict" as const };
      }
      if (existing.status === "succeeded" && existing.result) {
        return { ok: true as const, kind: "replay" as const, operation: withResult(existing) };
      }
      if (existing.status === "result_ready" && existing.result) {
        return { ok: true as const, kind: "result_ready" as const, operation: withResult(existing) };
      }
      if (
        existing.status === "processing"
        && existing.leaseUntil
        && existing.leaseUntil.getTime() >= now.getTime()
      ) {
        return { ok: false as const, reason: "operation_in_progress" as const };
      }
      const [claimed] = await tx
        .update(transcriptionOperations)
        .set({
          status: "processing",
          leaseEpoch: sql`${transcriptionOperations.leaseEpoch} + 1`,
          leaseUntil: new Date(now.getTime() + OPERATION_LEASE_MS),
          updatedAt: now,
        })
        .where(and(
          eq(transcriptionOperations.userId, input.userId),
          eq(transcriptionOperations.operationId, input.operationId),
          eq(transcriptionOperations.leaseEpoch, existing.leaseEpoch),
          sql`(
            ${transcriptionOperations.status} = 'retryable'
            OR (
              ${transcriptionOperations.status} = 'processing'
              AND (
                ${transcriptionOperations.leaseUntil} IS NULL
                OR ${transcriptionOperations.leaseUntil} < ${now}
              )
            )
          )`,
        ))
        .returning();
      if (!claimed) {
        return { ok: false as const, reason: "operation_in_progress" as const };
      }
      if (existing.status === "processing" && claimed.spendLedgerId) {
        // The fenced claim and its refund intent must commit together. Writing
        // this before the CAS can refund a result that the previous worker won.
        await recordPendingRefundInTransaction(tx, {
          userId: input.userId,
          originalLedgerId: claimed.spendLedgerId,
          amount: COST.hum,
          spendReason: "spend:hum",
          requestId: input.requestId,
          source: "transcription_operation_lease_expired",
          metadata: { operationId: input.operationId },
        });
      }
      return {
        ok: true as const,
        kind: "proceed" as const,
        operation: claimed,
        spend: spendFromOperation(claimed),
        charged: false,
      };
    }

    if (input.bill) {
      const [orphanSpend] = await tx
        .select({ id: notesLedger.id })
        .from(notesLedger)
        .where(and(
          eq(notesLedger.userId, input.userId),
          eq(notesLedger.reason, "spend:hum"),
          eq(notesLedger.externalRef, `hum:op:${input.operationId}`),
        ))
        .limit(1);
      // Receipts and spends are created atomically. A spend without a receipt
      // therefore predates request hashing and cannot prove this audio matches.
      if (orphanSpend) {
        return { ok: false as const, reason: "idempotency_conflict" as const };
      }
    }

    const spend = input.bill
      ? await spendNotesInTransaction(tx, {
          userId: input.userId,
          cost: COST.hum,
          reason: "spend:hum",
          externalRef: `hum:op:${input.operationId}`,
          metadata: {
            requestId: input.requestId,
            route: "/api/transcribe",
            phase: "operation_accept",
            requestHash: input.requestHash,
            targetInstrument: input.targetInstrument,
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

    const [operation] = await tx
      .insert(transcriptionOperations)
      .values({
        userId: input.userId,
        operationId: input.operationId,
        requestHash: input.requestHash,
        spendLedgerId: spend?.ok && spend.ledgerId ? spend.ledgerId : null,
        leaseUntil: new Date(now.getTime() + OPERATION_LEASE_MS),
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    return {
      ok: true as const,
      kind: "proceed" as const,
      operation: operation!,
      spend: spend?.ok ? spend : null,
      charged: Boolean(spend?.ok && !spend.duplicate),
    };
  });
}

export async function recordTranscriptionOperationResult(input: {
  userId: string;
  operationId: string;
  requestHash: string;
  leaseEpoch: number;
  result: TranscriptionResult;
}): Promise<TranscriptionOperation | null> {
  const [operation] = await db
    .update(transcriptionOperations)
    .set({
      status: "result_ready",
      result: input.result,
      leaseUntil: null,
      updatedAt: new Date(),
    })
    .where(and(
      eq(transcriptionOperations.userId, input.userId),
      eq(transcriptionOperations.operationId, input.operationId),
      eq(transcriptionOperations.requestHash, input.requestHash),
      eq(transcriptionOperations.leaseEpoch, input.leaseEpoch),
      eq(transcriptionOperations.status, "processing"),
    ))
    .returning();
  return operation ?? null;
}

export async function succeedTranscriptionOperation(input: {
  userId: string;
  operationId: string;
}): Promise<boolean> {
  const now = new Date();
  const [operation] = await db
    .update(transcriptionOperations)
    .set({ status: "succeeded", finishedAt: now, updatedAt: now })
    .where(and(
      eq(transcriptionOperations.userId, input.userId),
      eq(transcriptionOperations.operationId, input.operationId),
      eq(transcriptionOperations.status, "result_ready"),
    ))
    .returning({ operationId: transcriptionOperations.operationId });
  if (operation) return true;
  const [existing] = await db
    .select({ status: transcriptionOperations.status })
    .from(transcriptionOperations)
    .where(and(
      eq(transcriptionOperations.userId, input.userId),
      eq(transcriptionOperations.operationId, input.operationId),
    ))
    .limit(1);
  return existing?.status === "succeeded";
}

export async function releaseTranscriptionOperation(input: {
  userId: string;
  operationId: string;
  leaseEpoch: number;
  requestId: string;
  targetInstrument: string;
}): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [released] = await tx
      .update(transcriptionOperations)
      .set({ status: "retryable", leaseUntil: null, updatedAt: new Date() })
      .where(and(
        eq(transcriptionOperations.userId, input.userId),
        eq(transcriptionOperations.operationId, input.operationId),
        eq(transcriptionOperations.leaseEpoch, input.leaseEpoch),
        eq(transcriptionOperations.status, "processing"),
      ))
      .returning({
        operationId: transcriptionOperations.operationId,
        spendLedgerId: transcriptionOperations.spendLedgerId,
      });
    if (!released) return false;
    if (released.spendLedgerId) {
      await recordPendingRefundInTransaction(tx, {
        userId: input.userId,
        originalLedgerId: released.spendLedgerId,
        amount: COST.hum,
        spendReason: "spend:hum",
        requestId: input.requestId,
        source: "transcription_operation_retryable",
        metadata: {
          operationId: input.operationId,
          targetInstrument: input.targetInstrument,
          leaseEpoch: input.leaseEpoch,
        },
      });
    }
    return true;
  });
}

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function findOperation(
  tx: DbTransaction,
  userId: string,
  operationId: string,
): Promise<TranscriptionOperation | null> {
  const [operation] = await tx
    .select()
    .from(transcriptionOperations)
    .where(and(
      eq(transcriptionOperations.userId, userId),
      eq(transcriptionOperations.operationId, operationId),
    ))
    .limit(1);
  return operation ?? null;
}

function withResult(
  operation: TranscriptionOperation,
): TranscriptionOperation & { result: TranscriptionResult } {
  return operation as TranscriptionOperation & { result: TranscriptionResult };
}

function spendFromOperation(
  operation: TranscriptionOperation,
): TranscriptionOperationSpend | null {
  return operation.spendLedgerId
    ? {
        ok: true,
        ledgerId: operation.spendLedgerId,
        balanceBefore: null,
        balanceAfter: null,
        // This retry owns the operation lease, so a worker failure may safely
        // invoke the idempotent refund path for the original spend.
        duplicate: false,
      }
    : null;
}
