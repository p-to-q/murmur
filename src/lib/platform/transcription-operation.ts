import {
  beginTranscriptionOperation,
  recordTranscriptionOperationResult,
  releaseTranscriptionOperation,
  succeedTranscriptionOperation,
  type TranscriptionOperationSpend,
} from "@/lib/db/queries/transcription-operations";
import { settleOperationDelivery } from "@/lib/db/queries/notes-ledger";
import { hashTranscriptionOperationRequest } from "@/lib/audio/transcription-operation-contract";
import type { TranscriptionResult } from "@/modules/shared/types";
import { createHash } from "node:crypto";

export type PreparedTranscriptionOperation =
  | {
      ok: true;
      kind: "legacy";
      spend: null;
      balanceBefore: null;
      requestHash: null;
    }
  | {
      ok: true;
      kind: "proceed";
      spend: TranscriptionOperationSpend | null;
      balanceBefore: number | null;
      requestHash: string;
      charged: boolean;
      leaseEpoch: number;
    }
  | {
      ok: true;
      kind: "replay" | "result_ready";
      result: TranscriptionResult;
      spendLedgerId: string | null;
    }
  | {
      ok: false;
      error: "idempotency_conflict" | "operation_in_progress" | "insufficient_notes" | "billing_unavailable";
      status: number;
      currentBalance?: number;
    };

export async function prepareTranscriptionOperation(input: {
  userId: string;
  operationId: string | null;
  requestId: string;
  audio: File;
  targetInstrument: string;
  bill: boolean;
}): Promise<PreparedTranscriptionOperation> {
  if (!input.operationId) {
    return {
      ok: true,
      kind: "legacy",
      spend: null,
      balanceBefore: null,
      requestHash: null,
    };
  }
  const requestHash = hashTranscriptionOperationRequest({
    audioSha256: createHash("sha256")
      .update(new Uint8Array(await input.audio.arrayBuffer()))
      .digest("hex"),
    targetInstrument: input.targetInstrument,
  });
  try {
    const result = await beginTranscriptionOperation({
      userId: input.userId,
      operationId: input.operationId,
      requestHash,
      requestId: input.requestId,
      targetInstrument: input.targetInstrument,
      bill: input.bill,
    });
    if (!result.ok) {
      if (result.reason === "idempotency_conflict") {
        return { ok: false, error: result.reason, status: 409 };
      }
      if (result.reason === "operation_in_progress") {
        return { ok: false, error: result.reason, status: 409 };
      }
      return result.reason === "insufficient_notes"
        ? { ok: false, error: result.reason, status: 402, currentBalance: result.currentBalance }
        : { ok: false, error: "billing_unavailable", status: 503 };
    }
    if (result.kind !== "proceed") {
      return {
        ok: true,
        kind: result.kind,
        result: result.operation.result,
        spendLedgerId: result.operation.spendLedgerId,
      };
    }
    return {
      ok: true,
      kind: "proceed",
      spend: result.spend,
      balanceBefore: result.spend?.balanceBefore ?? null,
      requestHash,
      charged: result.charged,
      leaseEpoch: result.operation.leaseEpoch,
    };
  } catch {
    return { ok: false, error: "billing_unavailable", status: 503 };
  }
}

export async function recordTranscriptionResult(input: {
  userId: string;
  operationId: string;
  requestHash: string;
  leaseEpoch: number;
  result: TranscriptionResult;
}): Promise<boolean> {
  return Boolean(await recordTranscriptionOperationResult(input));
}

export async function settleRecordedTranscriptionOperation(input: {
  userId: string;
  operationId: string;
  requestId: string;
  targetInstrument: string;
  spendLedgerId: string | null;
}): Promise<
  | { ok: true }
  | { ok: false; reason: "insufficient_notes" | "billing_unavailable"; currentBalance?: number }
> {
  if (input.spendLedgerId) {
    const settled = await settleOperationDelivery({
      userId: input.userId,
      spendLedgerId: input.spendLedgerId,
      metadata: {
        requestId: input.requestId,
        operationId: input.operationId,
        targetInstrument: input.targetInstrument,
        trigger: "transcription_delivered",
      },
    });
    if (!settled.ok) {
      return settled.reason === "insufficient_notes"
        ? { ok: false, reason: "insufficient_notes", currentBalance: settled.currentBalance }
        : { ok: false, reason: "billing_unavailable" };
    }
  }
  const succeeded = await succeedTranscriptionOperation({
    userId: input.userId,
    operationId: input.operationId,
  });
  return succeeded ? { ok: true } : { ok: false, reason: "billing_unavailable" };
}

export async function releaseTranscriptionAttempt(input: {
  userId: string;
  operationId: string;
  leaseEpoch: number;
  requestId: string;
  targetInstrument: string;
}): Promise<boolean> {
  return releaseTranscriptionOperation(input);
}
