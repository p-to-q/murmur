import { randomUUID } from "crypto";
import { and, eq } from "drizzle-orm";
import { db } from "../client";
import { notesLedger } from "../schema/notes-ledger";
import { users } from "../schema/users";
import { DAILY_REFILL, MAX_FREE_BALANCE, type NotesReason } from "@murmur/core";
import {
  currentNotesRefillWindowStart,
  notesRefillWindowKey,
} from "@/lib/billing/notes-clock";
import {
  decideGrant,
  decideRefundPoolsForOriginalSpend,
  decideRefund,
  decideSpend,
  decideSpendPoolsForCost,
  refundReferenceFor,
  trimDailyFreeAfterTopupReversal,
  accountNotesFromTotal,
  type ExistingLedgerRow,
} from "@/lib/billing/notes-ledger-decisions";

// Re-export so existing imports `from "@/lib/db/queries/notes-ledger"`
// continue to work; tests that mock this module won't accidentally
// shadow the pure decisions, which live in their own module.
export {
  decideGrant,
  decideRefundPoolsForOriginalSpend,
  decideRefund,
  decideSpend,
  decideSpendPoolsForCost,
  refundReferenceFor,
  trimDailyFreeAfterTopupReversal,
  accountNotesFromTotal,
  type ExistingLedgerRow,
} from "@/lib/billing/notes-ledger-decisions";

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
      balanceAfter: number;
      amount: number;
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

    const decision = decideRefund({
      currentBalance: user.notesBalance,
      original,
      existingRefund,
    });

    if (decision.kind === "original_missing") {
      return { ok: false, reason: "original_not_found" };
    }
    if (decision.kind === "original_not_spend") {
      return { ok: false, reason: "original_not_a_spend" };
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

    if (existingRefund) {
      const reversedAmount = Math.abs(existingRefund.delta);
      return {
        ok: true,
        ledgerId: existingRefund.id,
        purchaseLedgerId: purchaseGrant.id,
        balanceBefore: user.notesBalance,
        balanceAfter: user.notesBalance,
        amount: reversedAmount,
        duplicate: true,
      };
    }

    const balanceAfter = Math.max(0, user.notesBalance - amount);
    const reversedAmount = user.notesBalance - balanceAfter;
    const ledgerId = createLedgerId();
    await tx.insert(notesLedger).values({
      id: ledgerId,
      userId: input.userId,
      delta: -reversedAmount,
      reason: "refund:topup",
      externalRef: input.refundExternalRef,
      metadata: {
        ...(input.metadata ?? {}),
        refunds: purchaseGrant.id,
        orderId: input.orderId,
      },
    });
    await tx
      .update(users)
      .set({
        notesBalance: balanceAfter,
        dailyFreeNotesBalance: trimDailyFreeAfterTopupReversal(
          user.dailyFreeNotesBalance,
          balanceAfter,
        ),
        updatedAt: new Date(),
      })
      .where(eq(users.id, input.userId));

    return {
      ok: true,
      ledgerId,
      purchaseLedgerId: purchaseGrant.id,
      balanceBefore: user.notesBalance,
      balanceAfter,
      amount: reversedAmount,
      duplicate: false,
    };
  });
}

export async function ensureBillingAccount(userId: string): Promise<void> {
  await ensureGuestBillingUser(userId);
  await ensureInitialLedgerForUser(userId);
  await ensureDailyFreeRefillForUser(userId);
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
          dailyFreeAfter: currentDaily + grantAmount,
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
      dailyFreeNotesBalance: currentDaily + grantAmount,
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
