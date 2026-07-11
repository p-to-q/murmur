import { and, eq, inArray } from "drizzle-orm";
import { WaffoPancake } from "@waffo/pancake-ts";

import { displayAmountToCents } from "@/lib/billing/waffo";
import { db } from "@/lib/db/client";
import { notesLedger } from "@/lib/db/schema/notes-ledger";
import { purchases, type Purchase } from "@/lib/db/schema/purchases";
import { grantNotes } from "@/lib/db/queries/notes-ledger";

export type WaffoReconcileSeverity = "warn" | "error";

export interface WaffoReconcileIssue {
  severity: WaffoReconcileSeverity;
  code: string;
  message: string;
  orderId?: string;
  paymentId?: string;
  refundId?: string;
}

export interface WaffoReconcileSummary {
  checkedAt: string;
  paymentsChecked: number;
  refundsChecked: number;
  localPurchasesMatched: number;
  issueCount: number;
  errorCount: number;
  warnCount: number;
}

/**
 * Auto-fix outcome (#238). Only present when `autoFix` was enabled. Focused on
 * purchase/top-up drift only (#299): re-granting a confirmed `purchase:topup`.
 * Every fix is idempotent — grants dedupe on (user, purchase:topup, orderId).
 * Durable spend `refund:pending` markers are recovered by the provider-neutral
 * reconciler (see `pending-refund-reconcile.ts`), not here.
 */
export interface WaffoAutoFixReport {
  enabled: boolean;
  /** `ledger_grant_missing` issues where the grant was (re)written. */
  grantsFixed: number;
  /** Grant fixes that still need a human. */
  requiresManualReview: number;
  /** Equal to grantsFixed (kept for a stable report shape). */
  fixed: number;
}

export interface WaffoReconcileReport {
  summary: WaffoReconcileSummary;
  issues: WaffoReconcileIssue[];
  autoFix?: WaffoAutoFixReport;
}

export interface WaffoPayment {
  id: string;
  orderId: string | null;
  orderMerchantExternalId: string | null;
  snapshotAmountDetails: {
    currency: string;
    total: string;
  } | null;
  onetimeOrder: {
    id: string;
  } | null;
}

export interface WaffoRefund {
  id: string;
  eventId: string | null;
  orderMerchantExternalId: string | null;
  refundTicketMerchantExternalId: string | null;
}

interface WaffoReconcileQuery {
  payments: WaffoPayment[];
  refunds: WaffoRefund[];
}

export type WaffoReconcileOptions = {
  merchantId: string;
  privateKey: string;
  limit?: number;
  /**
   * When true, reconciliation stops being report-only and idempotently repairs
   * the purchase drift it safely can (#238): re-grant a missing `purchase:topup`
   * for a confirmed payment. Gated off by default; the cron opts in via
   * env/param so drift-fixing is deliberate. Durable spend refunds are recovered
   * separately by the provider-neutral reconciler (#299).
   */
  autoFix?: boolean;
};

export async function reconcileWaffoBilling(options: WaffoReconcileOptions): Promise<WaffoReconcileReport> {
  const limit = normalizeLimit(options.limit ?? 100);
  const client = new WaffoPancake({
    merchantId: options.merchantId,
    privateKey: options.privateKey,
  });

  const waffo = await client.graphql.query<WaffoReconcileQuery>({
    query: `query ReconcileWaffoBilling($limit: Int!) {
      payments(limit: $limit, filter: { status: { eq: "succeeded" } }) {
        id
        orderId
        orderMerchantExternalId
        snapshotAmountDetails { currency total }
        onetimeOrder { id }
      }
      refunds(limit: $limit, filter: { status: { eq: "succeeded" } }) {
        id
        eventId
        orderMerchantExternalId
        refundTicketMerchantExternalId
      }
    }`,
    variables: { limit },
  });

  if (waffo.errors?.length) {
    throw new Error(`Waffo GraphQL errors: ${waffo.errors.map((e) => e.message).join("; ")}`);
  }

  const payments = waffo.data?.payments ?? [];
  const refunds = waffo.data?.refunds ?? [];
  const orderIds = Array.from(new Set(payments.map((payment) => payment.orderId ?? payment.onetimeOrder?.id).filter(isString)));
  const merchantOrderRefs = Array.from(
    new Set(
      payments
        .map((payment) => payment.orderMerchantExternalId)
        .filter(isString),
    ),
  );
  const refundRefs = refunds.flatMap((refund) => {
    return [
      refund.id,
      refund.eventId,
      refund.refundTicketMerchantExternalId,
      refund.orderMerchantExternalId,
    ]
      .filter(isString)
      .map((ref) => `waffo-refund:${ref}`);
  });
  const ledgerRefs = [...orderIds, ...refundRefs];

  const purchaseRefs = Array.from(new Set([...orderIds, ...merchantOrderRefs]));
  const localPurchases = purchaseRefs.length
    ? await db
        .select()
        .from(purchases)
        .where(and(eq(purchases.provider, "waffo"), inArray(purchases.providerRef, purchaseRefs)))
    : [];

  const localLedgers = ledgerRefs.length
    ? await db
        .select({
          userId: notesLedger.userId,
          delta: notesLedger.delta,
          reason: notesLedger.reason,
          externalRef: notesLedger.externalRef,
        })
        .from(notesLedger)
        .where(inArray(notesLedger.externalRef, ledgerRefs))
    : [];

  const purchaseByRef = new Map(localPurchases.map((purchase) => [purchase.providerRef, purchase]));
  const purchaseByOrder = new Map<string, Purchase>();
  const grantByOrder = new Map(
    localLedgers
      .filter((ledger) => ledger.reason === "purchase:topup" && ledger.externalRef)
      .map((ledger) => [ledger.externalRef!, ledger]),
  );
  const refundLedgerRefs = new Set(
    localLedgers
      .filter((ledger) => ledger.reason === "refund:topup" && ledger.externalRef)
      .map((ledger) => ledger.externalRef!),
  );
  const issues: WaffoReconcileIssue[] = [];

  for (const payment of payments) {
    const orderId = payment.orderId ?? payment.onetimeOrder?.id;
    if (!orderId) {
      issues.push({
        severity: "warn",
        code: "waffo_payment_missing_order",
        message: "Waffo payment has no order id.",
        paymentId: payment.id,
      });
      continue;
    }

    const local = findLocalPurchaseForWaffoPayment(payment, purchaseByRef);
    if (!local) {
      issues.push({
        severity: "error",
        code: "local_purchase_missing",
        message: "Succeeded Waffo payment has no local purchase row.",
        orderId,
        paymentId: payment.id,
      });
      continue;
    }
    purchaseByOrder.set(orderId, local);

    if (local.status !== "succeeded" && local.status !== "refunded") {
      issues.push({
        severity: "error",
        code:
          local.status === "pending"
            ? "local_purchase_pending_after_payment"
            : "local_purchase_status_mismatch",
        message:
          local.status === "pending"
            ? "Succeeded Waffo payment still has an unfulfilled pending local purchase."
            : `Local purchase status is ${local.status}, expected succeeded/refunded.`,
        orderId,
        paymentId: payment.id,
      });
    }

    const amount = payment.snapshotAmountDetails;
    if (amount && local.currency.toUpperCase() === amount.currency.toUpperCase()) {
      const cents = displayAmountToCents(amount.total, amount.currency);
      if (local.amountCents !== cents) {
        issues.push({
          severity: "error",
          code: "amount_mismatch",
          message: `Local amount ${local.amountCents} does not match Waffo amount ${cents}.`,
          orderId,
          paymentId: payment.id,
        });
      }
    }

    // A pending row is authoritative evidence for manual webhook replay, but
    // reconcile must not grant from it directly: only webhook fulfillment may
    // switch providerRef to the final order id and write the grant atomically.
    if (local.status !== "succeeded" && local.status !== "refunded") {
      continue;
    }

    const grant = grantByOrder.get(orderId);
    if (!grant) {
      issues.push({
        severity: "error",
        code: "ledger_grant_missing",
        message: "Local purchase has no purchase:topup ledger grant.",
        orderId,
        paymentId: payment.id,
      });
    } else if (grant.delta !== local.notesGranted) {
      issues.push({
        severity: "error",
        code: "ledger_grant_amount_mismatch",
        message: `Ledger grant ${grant.delta} does not match purchase notes ${local.notesGranted}.`,
        orderId,
        paymentId: payment.id,
      });
    }
  }

  for (const refund of refunds) {
    if (!refund.orderMerchantExternalId) {
      issues.push({
        severity: "warn",
        code: "refund_missing_order_ref",
        message: "Refund has no orderMerchantExternalId; rely on webhook/order detail for matching.",
        refundId: refund.id,
      });
      continue;
    }

    const refundOrderId = payments.find(
      (payment) =>
        payment.orderMerchantExternalId === refund.orderMerchantExternalId,
    );
    const providerOrderId =
      refundOrderId?.orderId ?? refundOrderId?.onetimeOrder?.id ?? null;
    const expectedLedgerRefs = waffoRefundLedgerRefs(refund, providerOrderId);

    if (!refund.refundTicketMerchantExternalId) {
      issues.push({
        severity: "warn",
        code: "refund_missing_ticket_ref",
        message: "Refund has no refundTicketMerchantExternalId; checking the provider refund id fallback.",
        refundId: refund.id,
      });
    }

    if (!expectedLedgerRefs.some((ref) => refundLedgerRefs.has(ref))) {
      issues.push({
        severity: "warn",
        code: "refund_ledger_not_observed",
        message: "Succeeded Waffo refund has no observed local refund:topup ledger row in the checked window.",
        refundId: refund.id,
      });
    }
  }

  const summary = {
    checkedAt: new Date().toISOString(),
    paymentsChecked: payments.length,
    refundsChecked: refunds.length,
    localPurchasesMatched: localPurchases.length,
    issueCount: issues.length,
    errorCount: issues.filter((issue) => issue.severity === "error").length,
    warnCount: issues.filter((issue) => issue.severity === "warn").length,
  };

  if (!options.autoFix) {
    return { summary, issues };
  }

  const autoFix = await runReconcileAutoFix({ issues, purchaseByOrder });

  return { summary, issues, autoFix };
}

/**
 * Idempotently repair the purchase drift the read-only pass detected (#238):
 *   • `ledger_grant_missing` → re-grant the confirmed `purchase:topup`.
 * The grant dedupes on its external_ref, so a re-run (or a race with the
 * webhook) is a no-op rather than a double credit. Durable spend refunds are
 * handled by the provider-neutral reconciler (#299), keeping Waffo
 * reconciliation focused on purchase/top-up.
 */
async function runReconcileAutoFix(input: {
  issues: WaffoReconcileIssue[];
  purchaseByOrder: Map<string, Purchase>;
}): Promise<WaffoAutoFixReport> {
  let grantsFixed = 0;
  let requiresManualReview = 0;

  for (const issue of input.issues) {
    if (issue.code !== "ledger_grant_missing" || !issue.orderId) continue;
    const local = input.purchaseByOrder.get(issue.orderId);
    if (!local) {
      requiresManualReview += 1;
      continue;
    }
    try {
      const grant = await grantNotes({
        userId: local.userId,
        amount: local.notesGranted,
        reason: "purchase:topup",
        externalRef: issue.orderId,
        metadata: {
          source: "reconcile_autofix",
          paymentId: issue.paymentId ?? null,
          productId: local.productId,
        },
      });
      if (grant.ok) grantsFixed += 1;
      else requiresManualReview += 1;
    } catch {
      requiresManualReview += 1;
    }
  }

  return {
    enabled: true,
    grantsFixed,
    requiresManualReview,
    fixed: grantsFixed,
  };
}

function normalizeLimit(limit: number): number {
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    throw new Error("limit must be an integer between 1 and 500");
  }
  return limit;
}

export function findLocalPurchaseForWaffoPayment<T>(
  payment: Pick<
    WaffoPayment,
    "orderId" | "onetimeOrder" | "orderMerchantExternalId"
  >,
  purchaseByRef: ReadonlyMap<string, T>,
): T | undefined {
  const orderId = payment.orderId ?? payment.onetimeOrder?.id;
  if (orderId) {
    const finalized = purchaseByRef.get(orderId);
    if (finalized) return finalized;
  }
  return payment.orderMerchantExternalId
    ? purchaseByRef.get(payment.orderMerchantExternalId)
    : undefined;
}

export function waffoRefundLedgerRefs(
  refund: Pick<
    WaffoRefund,
    | "id"
    | "eventId"
    | "orderMerchantExternalId"
    | "refundTicketMerchantExternalId"
  >,
  providerOrderId: string | null,
): string[] {
  return [
    refund.refundTicketMerchantExternalId,
    refund.eventId,
    refund.id,
    providerOrderId,
    refund.orderMerchantExternalId,
  ]
    .filter(isString)
    .map((ref) => `waffo-refund:${ref}`);
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}
