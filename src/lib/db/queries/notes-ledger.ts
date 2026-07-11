import { randomUUID } from "crypto";
import { and, asc, eq, gt, inArray, or, sql } from "drizzle-orm";
import { db } from "../client";
import { notesLedger } from "../schema/notes-ledger";
import { users } from "../schema/users";
import { DAILY_REFILL, MAX_FREE_BALANCE, type NotesReason } from "@murmur/core";
import { log } from "@/lib/observability/log";
import {
  currentNotesRefillWindowStart,
  notesRefillWindowKey,
} from "@/lib/billing/notes-clock";
import {
  decideBillingAccountMaintenance,
  decideGrant,
  decideOperationDelivery,
  decideRefundPoolsForOriginalSpend,
  decideRefund,
  decideSpend,
  decideSpendPoolsForCost,
  decideTopupReversal,
  dailyFreeAfterGrant,
  deliveredReferenceFor,
  deriveOperationState,
  rechargeReferenceFor,
  refundReferenceFor,
  pendingRefundReferenceFor,
  originalLedgerIdFromPendingRef,
  trimDailyFreeAfterTopupReversal,
  accountNotesFromTotal,
  type ExistingLedgerRow,
  type OperationState,
} from "@/lib/billing/notes-ledger-decisions";

// Re-export so existing imports `from "@/lib/db/queries/notes-ledger"`
// continue to work; tests that mock this module won't accidentally
// shadow the pure decisions, which live in their own module.
export {
  decideGrant,
  decideOperationDelivery,
  decideRefundPoolsForOriginalSpend,
  decideRefund,
  decideSpend,
  decideSpendPoolsForCost,
  decideTopupReversal,
  dailyFreeAfterGrant,
  deliveredReferenceFor,
  deriveOperationState,
  rechargeReferenceFor,
  refundReferenceFor,
  pendingRefundReferenceFor,
  originalLedgerIdFromPendingRef,
  trimDailyFreeAfterTopupReversal,
  accountNotesFromTotal,
  type ExistingLedgerRow,
  type OperationState,
} from "@/lib/billing/notes-ledger-decisions";

/** Ledger reason for the durable "a spend refund is owed" marker (#232). */
const PENDING_REFUND_REASON: NotesReason = "refund:pending";

/** Ledger reason for the durable "operation delivered" marker (#298). */
const OPERATION_DELIVERED_REASON: NotesReason = "operation:delivered";

export type SpendReason = Extract<NotesReason, `spend:${string}`>;
export type GrantReason = Exclude<NotesReason, SpendReason>;

export type BalanceResult =
  | {
      ok: true;
      userId: string;
      notes: number;
      accountNotes: number;
      dailyFreeNotes: number;
      planTier: "free" | "premium";
      freeNotesGrantedAt: Date;
    }
  | {
      ok: false;
      reason: "user_not_found";
      notes: 0;
    };

export type SpendNotesResult =
  | {
      ok: true;
      ledgerId: string;
      balanceBefore: number;
      balanceAfter: number;
      /**
       * True when this call hit an existing ledger row for the same
       * (userId, reason, externalRef) tuple and returned the prior
       * outcome without writing. Callers logging "user spent N notes"
       * should suppress the log when `duplicate === true`.
       */
      duplicate: boolean;
    }
  | {
      ok: false;
      reason: "insufficient_notes" | "user_not_found";
      currentBalance: number;
    };

export type GrantNotesResult =
  | {
      ok: true;
      ledgerId: string;
      balanceBefore: number;
      balanceAfter: number;
      duplicate: boolean;
    }
  | {
      ok: false;
      reason: "user_not_found";
    };

export type RefundNotesResult =
  | {
      ok: true;
      refundLedgerId: string;
      originalLedgerId: string;
      balanceBefore: number;
      balanceAfter: number;
      amount: number;
      duplicate: boolean;
      /**
       * True when the refund was skipped because the operation was already
       * delivered (#298). Reported as a no-op (duplicate: true) so callers
       * treat it as "nothing owed" — refunding delivered work is the exact bug
       * the operation state machine prevents.
       */
      delivered: boolean;
    }
  | {
      ok: false;
      reason: "original_not_found" | "original_not_a_spend" | "user_not_found";
    };

export type ReverseTopupGrantResult =
  | {
      ok: true;
      ledgerId: string;
      purchaseLedgerId: string;
      balanceBefore: number;
      /** Post-reversal balance, floored at 0 (#233 clamp-at-zero). */
      balanceAfter: number;
      /** Notes actually clawed back (may be < requested when clamped). */
      amount: number;
      /** True when the reversal was clamped because notes were already spent. */
      clamped: boolean;
      /** Requested reversal minus `amount`; the shortfall left un-reversed. */
      unrefunded: number;
      duplicate: boolean;
    }
  | {
      ok: false;
      reason: "purchase_grant_not_found" | "user_not_found";
    };

export type SpendNotesInput = {
  userId: string;
  cost: number;
  reason: SpendReason;
  externalRef?: string;
  metadata?: Record<string, unknown>;
};

export type GrantNotesInput = {
  userId: string;
  amount: number;
  reason: GrantReason;
  externalRef?: string;
  metadata?: Record<string, unknown>;
};

export type RefundNotesInput = {
  originalLedgerId: string;
  /**
   * Optional override; defaults to `grant:refund`. Provided so
   * partial refunds tied to a specific provider event can carry a
   * narrower reason if you ever need to slice ledger queries by it.
   */
  reason?: GrantReason;
  metadata?: Record<string, unknown>;
};

export type ReverseTopupGrantInput = {
  userId: string;
  orderId: string;
  notesGranted: number;
  refundExternalRef: string;
  metadata?: Record<string, unknown>;
};

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

// ─── DB orchestration ──────────────────────────────────────────────

export async function getNotesBalance(userId: string): Promise<BalanceResult> {
  await ensureBillingAccount(userId);

  const [row] = await db
    .select({
      id: users.id,
      notesBalance: users.notesBalance,
      dailyFreeNotesBalance: users.dailyFreeNotesBalance,
      planTier: users.planTier,
      freeNotesGrantedAt: users.freeNotesGrantedAt,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!row) {
    return { ok: false, reason: "user_not_found", notes: 0 };
  }

  const dailyFreeNotes = trimDailyFreeAfterTopupReversal(
    row.dailyFreeNotesBalance,
    row.notesBalance,
  );

  return {
    ok: true,
    userId: row.id,
    notes: row.notesBalance,
    dailyFreeNotes,
    accountNotes: accountNotesFromTotal(row.notesBalance, dailyFreeNotes),
    planTier: normalizePlanTier(row.planTier),
    freeNotesGrantedAt: row.freeNotesGrantedAt,
  };
}

/**
 * Free-era no-op for zero-cost spends (see @murmur/core cost-table): no
 * row, no balance change, no DB round-trip. `duplicate: true` keeps the
 * routes' "notes.spent" logging and refund-on-failure paths quiet, which
 * is accurate — nothing was written, so there is nothing to undo.
 */
const ZERO_COST_SPEND: SpendNotesResult = Object.freeze({
  ok: true,
  ledgerId: "",
  balanceBefore: 0,
  balanceAfter: 0,
  duplicate: true,
});

export async function spendNotes(input: SpendNotesInput): Promise<SpendNotesResult> {
  if (input.cost === 0) return ZERO_COST_SPEND;
  await ensureBillingAccount(input.userId);

  return db.transaction((tx) => spendNotesInTransaction(tx, input));
}

export async function spendNotesInTransaction(
  tx: DbTransaction,
  input: SpendNotesInput,
): Promise<SpendNotesResult> {
  if (input.cost === 0) return ZERO_COST_SPEND;
  const cost = normalizePositiveNotes(input.cost, "cost");

  const user = await lockUserRow(tx, input.userId);
  if (!user) {
    return { ok: false, reason: "user_not_found", currentBalance: 0 };
  }

  const existing = input.externalRef
    ? await findIdempotentLedger(tx, input.userId, input.reason, input.externalRef)
    : null;

  const decision = decideSpend({
    currentBalance: user.notesBalance,
    cost,
    existing,
  });

  if (decision.kind === "insufficient") {
    return {
      ok: false,
      reason: "insufficient_notes",
      currentBalance: decision.currentBalance,
    };
  }
  if (decision.kind === "duplicate") {
    return {
      ok: true,
      ledgerId: decision.ledgerId,
      balanceBefore: decision.balanceBefore,
      balanceAfter: decision.balanceAfter,
      duplicate: true,
    };
  }

  const ledgerId = createLedgerId();
  const spendPools = decideSpendPoolsForCost(user, cost);
  await tx.insert(notesLedger).values({
    id: ledgerId,
    userId: input.userId,
    delta: -cost,
    reason: input.reason,
    externalRef: input.externalRef,
    metadata: {
      ...(input.metadata ?? {}),
      spendPools,
    },
  });
  await tx
    .update(users)
    .set({
      notesBalance: decision.balanceAfter,
      dailyFreeNotesBalance: spendPools.dailyFreeAfter,
      updatedAt: new Date(),
    })
    .where(eq(users.id, input.userId));

  return {
    ok: true,
    ledgerId,
    balanceBefore: user.notesBalance,
    balanceAfter: decision.balanceAfter,
    duplicate: false,
  };
}

export async function grantNotes(input: GrantNotesInput): Promise<GrantNotesResult> {
  return db.transaction((tx) => grantNotesInTransaction(tx, input));
}

export async function grantNotesInTransaction(
  tx: DbTransaction,
  input: GrantNotesInput,
): Promise<GrantNotesResult> {
  const amount = normalizePositiveNotes(input.amount, "amount");
  const user = await lockUserRow(tx, input.userId);
  if (!user) return { ok: false, reason: "user_not_found" };

  const existing = input.externalRef
    ? await findIdempotentLedger(tx, input.userId, input.reason, input.externalRef)
    : null;

  const decision = decideGrant({
    currentBalance: user.notesBalance,
    amount,
    existing,
  });

  if (decision.kind === "duplicate") {
    return {
      ok: true,
      ledgerId: decision.ledgerId,
      balanceBefore: decision.balanceBefore,
      balanceAfter: decision.balanceAfter,
      duplicate: true,
    };
  }

  const ledgerId = createLedgerId();
  await tx.insert(notesLedger).values({
    id: ledgerId,
    userId: input.userId,
    delta: amount,
    reason: input.reason,
    externalRef: input.externalRef,
    metadata: input.metadata ?? {},
  });
  await tx
    .update(users)
    .set({ notesBalance: decision.balanceAfter, updatedAt: new Date() })
    .where(eq(users.id, input.userId));

  return {
    ok: true,
    ledgerId,
    balanceBefore: user.notesBalance,
    balanceAfter: decision.balanceAfter,
    duplicate: false,
  };
}

/**
 * Reverse a prior spend by inserting a positive-delta ledger row tied
 * to the original spend's id. Idempotent — calling twice with the
 * same originalLedgerId returns the existing refund row.
 *
 * Refunds are never destructive: the original spend row stays in the
 * ledger. The invariant `SUM(delta WHERE user_id = U) = balance`
 * holds because the refund row's positive delta cancels the spend's
 * negative delta.
 */
export async function refundNotes(input: RefundNotesInput): Promise<RefundNotesResult> {
  const refundReason: GrantReason = input.reason ?? "refund:spend";
  const refundExternalRef = refundReferenceFor(input.originalLedgerId);

  return db.transaction(async (tx) => {
    const [original] = await tx
      .select({
        id: notesLedger.id,
        userId: notesLedger.userId,
        delta: notesLedger.delta,
        metadata: notesLedger.metadata,
      })
      .from(notesLedger)
      .where(eq(notesLedger.id, input.originalLedgerId))
      .limit(1);

    if (!original) return { ok: false, reason: "original_not_found" };

    const user = await lockUserRow(tx, original.userId);
    if (!user) return { ok: false, reason: "user_not_found" };

    const existingRefund = await findIdempotentLedger(
      tx,
      original.userId,
      refundReason,
      refundExternalRef,
    );

    // #298: a refund must never reverse an operation that already reached the
    // user. The delivered marker is read under the same user-row lock the
    // refund would take, so a reconcile refund and a concurrent delivery
    // settlement serialize — whichever wins, the operation ends at one net
    // charge. Only checked when refunding to the default `refund:spend` reason
    // (the delivered marker is keyed to that spend); custom-reason refunds are
    // unaffected.
    const deliveredMarker =
      refundReason === "refund:spend"
        ? await findIdempotentLedger(
            tx,
            original.userId,
            OPERATION_DELIVERED_REASON,
            deliveredReferenceFor(original.id),
          )
        : null;

    const decision = decideRefund({
      currentBalance: user.notesBalance,
      original,
      existingRefund,
      delivered: deliveredMarker !== null,
    });

    if (decision.kind === "original_missing") {
      return { ok: false, reason: "original_not_found" };
    }
    if (decision.kind === "original_not_spend") {
      return { ok: false, reason: "original_not_a_spend" };
    }

    if (decision.kind === "delivered") {
      // Operation already delivered — report a no-op so the reconciler counts it
      // as settled instead of refunding delivered work.
      return {
        ok: true,
        refundLedgerId: "",
        originalLedgerId: original.id,
        balanceBefore: user.notesBalance,
        balanceAfter: user.notesBalance,
        amount: decision.amount,
        duplicate: true,
        delivered: true,
      };
    }

    if (decision.kind === "duplicate") {
      return {
        ok: true,
        refundLedgerId: decision.ledgerId,
        originalLedgerId: original.id,
        balanceBefore: user.notesBalance,
        balanceAfter: decision.balanceAfter,
        amount: decision.amount,
        duplicate: true,
        delivered: false,
      };
    }

    const refundLedgerId = createLedgerId();
    const refundPools = decideRefundPoolsForOriginalSpend(
      original.metadata,
      user.dailyFreeNotesBalance,
      decision.balanceAfter,
      MAX_FREE_BALANCE,
    );
    await tx.insert(notesLedger).values({
      id: refundLedgerId,
      userId: original.userId,
      delta: decision.amount,
      reason: refundReason,
      externalRef: refundExternalRef,
      metadata: {
        ...(input.metadata ?? {}),
        refunds: original.id,
        refundPools,
      },
    });
    await tx
      .update(users)
      .set({
        notesBalance: decision.balanceAfter,
        dailyFreeNotesBalance: refundPools.dailyFreeAfter,
        updatedAt: new Date(),
      })
      .where(eq(users.id, original.userId));

    return {
      ok: true,
      refundLedgerId,
      originalLedgerId: original.id,
      balanceBefore: user.notesBalance,
      balanceAfter: decision.balanceAfter,
      amount: decision.amount,
      duplicate: false,
      delivered: false,
    };
  });
}

// ─── Operation delivery settlement (#298) ──────────────────────────

export type SettleOperationDeliveryInput = {
  userId: string;
  /** Ledger id of the operation's spend row (from spendNotes, fresh or duplicate). */
  spendLedgerId: string;
  metadata?: Record<string, unknown>;
};

export type SettleOperationDeliveryResult =
  | {
      ok: true;
      state: OperationState;
      /** True once the durable `operation:delivered` marker exists for the spend. */
      delivered: boolean;
      /** True when a re-charge was written to restore the net charge after a prior refund. */
      recharged: boolean;
      /** True when this call found the operation already settled (idempotent replay). */
      duplicate: boolean;
      rechargeLedgerId: string | null;
      balanceAfter: number;
    }
  | { ok: false; reason: "invalid_operation" | "user_not_found" };

/**
 * Settle a successfully delivered operation so it ends in exactly one net charge
 * and no reconcile pass will refund it (#298).
 *
 * Called when a charged operation's work reaches the user. It writes a durable
 * `operation:delivered` marker keyed to the spend, and — if a prior failed
 * attempt had already *refunded* the spend (failure → refund → retry succeeded)
 * — a re-charge that restores the single net charge. When the earlier failure
 * only left a `refund:pending` marker (the refund never actually applied), the
 * balance is already at one net charge, so no re-charge is written; the
 * delivered marker simply makes `refundNotes` / the reconciler skip the owed
 * refund for delivered work.
 *
 * Concurrency: everything runs under the user-row lock, so a delivery racing a
 * reconcile refund (or a concurrent retry) serializes to one coherent outcome.
 * Idempotent: the delivered marker and re-charge dedupe on their external_refs,
 * so a replayed delivery is a no-op.
 */
export async function settleOperationDelivery(
  input: SettleOperationDeliveryInput,
): Promise<SettleOperationDeliveryResult> {
  if (!input.spendLedgerId) return { ok: false, reason: "invalid_operation" };

  return db.transaction(async (tx) => {
    const [spend] = await tx
      .select({
        id: notesLedger.id,
        userId: notesLedger.userId,
        delta: notesLedger.delta,
        reason: notesLedger.reason,
        metadata: notesLedger.metadata,
      })
      .from(notesLedger)
      .where(eq(notesLedger.id, input.spendLedgerId))
      .limit(1);

    // The row must be this user's spend (negative delta). A grant/refund/marker
    // id, another user's row, or a missing id is never a settleable operation.
    if (!spend || spend.userId !== input.userId || spend.delta >= 0) {
      return { ok: false, reason: "invalid_operation" };
    }

    const user = await lockUserRow(tx, input.userId);
    if (!user) return { ok: false, reason: "user_not_found" };

    const refundRef = refundReferenceFor(spend.id);
    const pendingRef = pendingRefundReferenceFor(spend.id);
    const deliveredRef = deliveredReferenceFor(spend.id);
    const rechargeRef = rechargeReferenceFor(spend.id);

    // One locked read of every row keyed to this operation. external_refs are
    // role-distinct (refund: / refund_pending: / op_delivered: / recharge:), so
    // keying the result by external_ref classifies them unambiguously — and the
    // lookup runs under the user-row lock taken above, so a concurrent delivery
    // or reconcile refund sees a coherent snapshot.
    const relatedRows = await tx
      .select({ id: notesLedger.id, externalRef: notesLedger.externalRef })
      .from(notesLedger)
      .where(
        and(
          eq(notesLedger.userId, spend.userId),
          inArray(notesLedger.externalRef, [refundRef, pendingRef, deliveredRef, rechargeRef]),
        ),
      );
    const relatedByRef = new Map(
      relatedRows.filter((row) => row.externalRef).map((row) => [row.externalRef!, row]),
    );
    const existingRefund = relatedByRef.get(refundRef) ?? null;
    const existingPending = relatedByRef.get(pendingRef) ?? null;
    const existingDelivered = relatedByRef.get(deliveredRef) ?? null;
    const existingRecharge = relatedByRef.get(rechargeRef) ?? null;

    const state = deriveOperationState({
      hasSpend: true,
      hasRefund: existingRefund !== null,
      hasPending: existingPending !== null,
      hasDelivered: existingDelivered !== null,
    });

    const decision = decideOperationDelivery({
      spend: { delta: spend.delta, metadata: spend.metadata },
      hasRefund: existingRefund !== null,
      hasDelivered: existingDelivered !== null,
      hasRecharge: existingRecharge !== null,
      currentBalance: user.notesBalance,
      currentDailyFree: user.dailyFreeNotesBalance,
    });

    if (decision.kind === "already_delivered") {
      return {
        ok: true,
        state,
        delivered: true,
        recharged: existingRecharge !== null,
        duplicate: true,
        rechargeLedgerId: existingRecharge?.id ?? null,
        balanceAfter: user.notesBalance,
      };
    }

    // Record delivery. onConflictDoNothing keeps a racing/replayed settlement a
    // no-op against the (user, reason, external_ref) idempotency index.
    await tx
      .insert(notesLedger)
      .values({
        id: createLedgerId(),
        userId: spend.userId,
        delta: 0,
        reason: OPERATION_DELIVERED_REASON,
        externalRef: deliveredRef,
        metadata: {
          ...(input.metadata ?? {}),
          settles: spend.id,
          priorState: state,
        },
      })
      .onConflictDoNothing();

    let rechargeLedgerId: string | null = null;
    let balanceAfter = user.notesBalance;

    if (decision.writeRecharge) {
      const newRechargeId = createLedgerId();
      const inserted = await tx
        .insert(notesLedger)
        .values({
          id: newRechargeId,
          userId: spend.userId,
          delta: -decision.rechargeAmount,
          reason: spend.reason,
          externalRef: rechargeRef,
          metadata: {
            ...(input.metadata ?? {}),
            recharges: spend.id,
            spendPools: decision.rechargePools,
            reason: "operation_delivery_recharge",
          },
        })
        .onConflictDoNothing()
        .returning({ id: notesLedger.id });

      // Only move the balance when THIS call wrote the re-charge; a concurrent
      // settlement that already inserted it must not double-debit.
      if (inserted[0]) {
        rechargeLedgerId = newRechargeId;
        balanceAfter = decision.balanceAfter;
        await tx
          .update(users)
          .set({
            notesBalance: decision.balanceAfter,
            dailyFreeNotesBalance: decision.dailyFreeAfter,
            updatedAt: new Date(),
          })
          .where(eq(users.id, spend.userId));
      } else {
        rechargeLedgerId = existingRecharge?.id ?? null;
      }
    }

    return {
      ok: true,
      state: "delivered",
      delivered: true,
      recharged: rechargeLedgerId !== null,
      duplicate: false,
      rechargeLedgerId,
      balanceAfter,
    };
  });
}

/**
 * Reverse a provider-confirmed top-up after a successful provider refund.
 *
 * Unlike `refundNotes`, which refunds a negative spend row, this writes a
 * negative `refund:topup` row to offset the original positive
 * `purchase:topup` grant. The original grant remains immutable.
 */
export async function reverseTopupGrant(
  input: ReverseTopupGrantInput,
): Promise<ReverseTopupGrantResult> {
  const amount = normalizePositiveNotes(input.notesGranted, "notesGranted");

  return db.transaction(async (tx) => {
    const [purchaseGrant] = await tx
      .select({ id: notesLedger.id, delta: notesLedger.delta })
      .from(notesLedger)
      .where(
        and(
          eq(notesLedger.userId, input.userId),
          eq(notesLedger.reason, "purchase:topup"),
          eq(notesLedger.externalRef, input.orderId),
        ),
      )
      .limit(1);

    if (!purchaseGrant || purchaseGrant.delta <= 0) {
      return { ok: false, reason: "purchase_grant_not_found" };
    }

    const user = await lockUserRow(tx, input.userId);
    if (!user) return { ok: false, reason: "user_not_found" };

    const existingRefund = await findIdempotentLedger(
      tx,
      input.userId,
      "refund:topup",
      input.refundExternalRef,
    );

    const decision = decideTopupReversal({
      currentBalance: user.notesBalance,
      amount,
      existingRefund,
    });

    if (decision.kind === "duplicate") {
      return {
        ok: true,
        ledgerId: decision.ledgerId,
        purchaseLedgerId: purchaseGrant.id,
        balanceBefore: user.notesBalance,
        balanceAfter: decision.balanceAfter,
        amount: decision.amount,
        clamped: false,
        unrefunded: 0,
        duplicate: true,
      };
    }

    const ledgerId = createLedgerId();
    await tx.insert(notesLedger).values({
      id: ledgerId,
      userId: input.userId,
      delta: -decision.amount,
      reason: "refund:topup",
      externalRef: input.refundExternalRef,
      metadata: {
        ...(input.metadata ?? {}),
        refunds: purchaseGrant.id,
        orderId: input.orderId,
        // #233: record when the claw-back was floored so the shortfall is
        // auditable — the buyer was refunded `notesGranted` but only `amount`
        // was still on the balance to reverse.
        requestedAmount: amount,
        clamped: decision.clamped,
        unrefunded: decision.unrefunded,
      },
    });
    await tx
      .update(users)
      .set({
        notesBalance: decision.balanceAfter,
        dailyFreeNotesBalance: trimDailyFreeAfterTopupReversal(
          user.dailyFreeNotesBalance,
          decision.balanceAfter,
        ),
        updatedAt: new Date(),
      })
      .where(eq(users.id, input.userId));

    // A clamped reversal means real money was refunded but the notes were
    // already spent — never a hard error (the alternative is a negative balance
    // that locks the account), but it must be visible to reconciliation/support.
    if (decision.clamped) {
      log(
        "notes.topup_reversal_clamped",
        {
          orderId: input.orderId,
          purchaseLedgerId: purchaseGrant.id,
          refundLedgerId: ledgerId,
          requestedAmount: amount,
          appliedAmount: decision.amount,
          unrefunded: decision.unrefunded,
          balanceBefore: user.notesBalance,
          balanceAfter: decision.balanceAfter,
        },
        { userId: input.userId, level: "warn" },
      );
    }

    return {
      ok: true,
      ledgerId,
      purchaseLedgerId: purchaseGrant.id,
      balanceBefore: user.notesBalance,
      balanceAfter: decision.balanceAfter,
      amount: decision.amount,
      clamped: decision.clamped,
      unrefunded: decision.unrefunded,
      duplicate: false,
    };
  });
}

// ─── Durable refund-pending markers (#232) ─────────────────────────

export type RecordPendingRefundInput = {
  userId: string;
  /** Ledger id of the original spend whose refund could not be written in-request. */
  originalLedgerId: string;
  /** Notes owed back (audit only; the retry derives the real amount from the spend row). */
  amount?: number;
  /** Spend reason being reversed (e.g. "spend:hum"), for observability. */
  spendReason?: string;
  requestId?: string;
  /** Where the failure happened, e.g. "transcribe_worker_failed". */
  source: string;
  metadata?: Record<string, unknown>;
};

export type RecordPendingRefundResult =
  | { ok: true; pendingLedgerId: string; externalRef: string; duplicate: boolean }
  | { ok: false; reason: "invalid_original" };

/**
 * Persist a durable "a spend refund is owed" marker when an in-request refund
 * write fails, so the reconcile cron can retry the reversal idempotently
 * instead of the note being silently lost (#232).
 *
 * The marker is a zero-delta ledger row: it records intent without touching the
 * balance (SUM(delta)==balance still holds) and is a single unlocked insert, so
 * it can land even when the full refund transaction could not (lock contention,
 * a transient serialization failure, etc.). `onConflictDoNothing` against the
 * (user, reason, external_ref) idempotency index makes repeated failures a
 * no-op rather than a second marker.
 */
export async function recordPendingRefund(
  input: RecordPendingRefundInput,
): Promise<RecordPendingRefundResult> {
  if (!input.originalLedgerId) return { ok: false, reason: "invalid_original" };

  const externalRef = pendingRefundReferenceFor(input.originalLedgerId);
  const ledgerId = createLedgerId();
  const inserted = await db
    .insert(notesLedger)
    .values({
      id: ledgerId,
      userId: input.userId,
      delta: 0,
      reason: PENDING_REFUND_REASON,
      externalRef,
      metadata: {
        ...(input.metadata ?? {}),
        originalLedgerId: input.originalLedgerId,
        spendReason: input.spendReason ?? null,
        amountOwed: input.amount ?? null,
        source: input.source,
        requestId: input.requestId ?? null,
      },
    })
    .onConflictDoNothing()
    .returning({ id: notesLedger.id });

  if (!inserted[0]) {
    return { ok: true, pendingLedgerId: "", externalRef, duplicate: true };
  }
  return { ok: true, pendingLedgerId: inserted[0].id, externalRef, duplicate: false };
}

export interface PendingRefundMarker {
  id: string;
  userId: string;
  originalLedgerId: string;
  createdAt: Date;
  metadata: Record<string, unknown>;
}

export type PendingRefundCursor = { createdAt: Date; id: string };

/**
 * Page through `refund:pending` markers oldest-first for the reconcile retry
 * loop (#238). The cursor is (created_at, id) so pages stay stable even as new
 * markers land mid-scan. Markers whose external_ref can't be parsed back to a
 * spend id are dropped (defensive — the retry loop can't act on them).
 */
export async function listPendingRefundMarkers(input: {
  limit: number;
  after?: PendingRefundCursor | null;
}): Promise<PendingRefundMarker[]> {
  const limit = Math.max(1, Math.min(500, Math.trunc(input.limit)));
  const reasonFilter = eq(notesLedger.reason, PENDING_REFUND_REASON);
  const cursorFilter = input.after
    ? or(
        gt(notesLedger.createdAt, input.after.createdAt),
        and(
          eq(notesLedger.createdAt, input.after.createdAt),
          gt(notesLedger.id, input.after.id),
        ),
      )
    : undefined;

  const rows = await db
    .select({
      id: notesLedger.id,
      userId: notesLedger.userId,
      externalRef: notesLedger.externalRef,
      createdAt: notesLedger.createdAt,
      metadata: notesLedger.metadata,
    })
    .from(notesLedger)
    .where(cursorFilter ? and(reasonFilter, cursorFilter) : reasonFilter)
    .orderBy(asc(notesLedger.createdAt), asc(notesLedger.id))
    .limit(limit);

  return rows.flatMap((row) => {
    const originalLedgerId = originalLedgerIdFromPendingRef(row.externalRef);
    if (!originalLedgerId) return [];
    return [
      {
        id: row.id,
        userId: row.userId,
        originalLedgerId,
        createdAt: row.createdAt,
        metadata: row.metadata,
      },
    ];
  });
}

export async function ensureBillingAccount(userId: string): Promise<void> {
  await ensureGuestBillingUser(userId);

  // One non-locking read decides whether either maintenance transaction has
  // any work to do. On the hot path (every balance read and spend) both are
  // no-ops, and this skips their SELECT ... FOR UPDATE round trips — the
  // transactions still re-check under the row lock when they do run.
  const [snapshot] = await db
    .select({
      notesBalance: users.notesBalance,
      accountKind: users.accountKind,
      freeNotesGrantedAt: users.freeNotesGrantedAt,
      hasLedgerRows: sql<boolean>`exists (
        select 1 from ${notesLedger} where ${notesLedger.userId} = ${users.id}
      )`,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  const maintenance = decideBillingAccountMaintenance({
    userId,
    snapshot: snapshot ?? null,
    windowStart: currentNotesRefillWindowStart(),
  });

  if (maintenance.needsInitialLedger) {
    await ensureInitialLedgerForUser(userId);
  }
  if (maintenance.needsDailyFreeRefill) {
    await ensureDailyFreeRefillForUser(userId);
  }
}

async function ensureGuestBillingUser(userId: string): Promise<void> {
  if (userId !== "guest") return;

  await db
    .insert(users)
    .values({ id: "guest", name: "Local Creator" })
    .onConflictDoNothing();
}

async function ensureInitialLedgerForUser(userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const user = await lockUserRow(tx, userId);
    if (!user || user.notesBalance <= 0) return;

    const [existingLedger] = await tx
      .select({ id: notesLedger.id })
      .from(notesLedger)
      .where(eq(notesLedger.userId, userId))
      .limit(1);

    if (existingLedger) return;

    await tx.insert(notesLedger).values({
      id: createLedgerId(),
      userId,
      delta: user.notesBalance,
      reason: initialLedgerReasonForUser(userId, user.accountKind),
      externalRef: "initial_balance",
      metadata: { source: "ensure_initial_ledger" },
    });
  });
}

export async function ensureDailyFreeRefillForUser(userId: string): Promise<void> {
  if (userId === "guest") return;

  await db.transaction(async (tx) => {
    const user = await lockUserRow(tx, userId);
    if (!user || user.accountKind !== "registered") return;
    await grantDailyFreeRefillInTransaction(tx, user);
  });
}

async function grantDailyFreeRefillInTransaction(
  tx: DbTransaction,
  user: LockedUserRow,
): Promise<void> {
  const windowStart = currentNotesRefillWindowStart();
  const currentDaily = trimDailyFreeAfterTopupReversal(
    user.dailyFreeNotesBalance,
    user.notesBalance,
  );
  const externalRef = `daily_free:${notesRefillWindowKey()}`;
  const existingGrant = await findIdempotentLedger(
    tx,
    user.id,
    "grant:daily_free",
    externalRef,
  );

  if (existingGrant) {
    if (user.freeNotesGrantedAt < windowStart) {
      await tx
        .update(users)
        .set({ freeNotesGrantedAt: windowStart, updatedAt: new Date() })
        .where(eq(users.id, user.id));
    }
    return;
  }

  if (user.freeNotesGrantedAt >= windowStart) return;

  const dailyRoom = Math.max(0, MAX_FREE_BALANCE - currentDaily);
  const grantAmount = Math.min(DAILY_REFILL, dailyRoom);

  if (grantAmount > 0) {
    const dailyFreeAfter = dailyFreeAfterGrant({
      currentBalance: user.notesBalance,
      currentDailyFree: currentDaily,
      grantAmount,
      maxDailyFreeBalance: MAX_FREE_BALANCE,
    });

    const inserted = await tx
      .insert(notesLedger)
      .values({
        id: createLedgerId(),
        userId: user.id,
        delta: grantAmount,
        reason: "grant:daily_free",
        externalRef,
        metadata: {
          source: "ensure_daily_free_refill",
          dailyFreeBefore: currentDaily,
          dailyFreeAfter,
        },
      })
      .onConflictDoNothing()
      .returning({ id: notesLedger.id });

    if (!inserted[0]) {
      await tx
        .update(users)
        .set({ freeNotesGrantedAt: windowStart, updatedAt: new Date() })
        .where(eq(users.id, user.id));
      return;
    }
  }

  await tx
    .update(users)
    .set({
      notesBalance: user.notesBalance + grantAmount,
      dailyFreeNotesBalance: dailyFreeAfterGrant({
        currentBalance: user.notesBalance,
        currentDailyFree: currentDaily,
        grantAmount,
        maxDailyFreeBalance: MAX_FREE_BALANCE,
      }),
      freeNotesGrantedAt: windowStart,
      updatedAt: new Date(),
    })
    .where(eq(users.id, user.id));
}

type LockedUserRow = {
  id: string;
  notesBalance: number;
  dailyFreeNotesBalance: number;
  freeNotesGrantedAt: Date;
  accountKind: string;
};

async function lockUserRow(
  tx: DbTransaction,
  userId: string,
): Promise<LockedUserRow | null> {
  const [user] = await tx
    .select({
      id: users.id,
      notesBalance: users.notesBalance,
      dailyFreeNotesBalance: users.dailyFreeNotesBalance,
      freeNotesGrantedAt: users.freeNotesGrantedAt,
      accountKind: users.accountKind,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
    .for("update");
  return user ?? null;
}

function initialLedgerReasonForUser(
  userId: string,
  accountKind: string,
): GrantReason {
  if (userId === "guest") return "grant:signup_bonus";
  if (accountKind === "local_creator") return "grant:local_creator";
  return "grant:cutover_gift";
}

async function findIdempotentLedger(
  tx: DbTransaction,
  userId: string,
  reason: string,
  externalRef: string,
): Promise<ExistingLedgerRow | null> {
  const [row] = await tx
    .select({ id: notesLedger.id, delta: notesLedger.delta })
    .from(notesLedger)
    .where(
      and(
        eq(notesLedger.userId, userId),
        eq(notesLedger.reason, reason),
        eq(notesLedger.externalRef, externalRef),
      ),
    )
    .limit(1);
  return row ?? null;
}

function normalizePositiveNotes(value: number, name: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer note amount`);
  }
  return value;
}

function normalizePlanTier(value: string): "free" | "premium" {
  return value === "premium" ? "premium" : "free";
}

function createLedgerId(): string {
  return `nle_${Date.now().toString(36)}_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
}
