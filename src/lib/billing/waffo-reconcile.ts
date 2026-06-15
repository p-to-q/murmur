import { and, eq, inArray } from "drizzle-orm";
import { WaffoPancake } from "@waffo/pancake-ts";

import { displayAmountToCents } from "@/lib/billing/waffo";
import { db } from "@/lib/db/client";
import { notesLedger } from "@/lib/db/schema/notes-ledger";
import { purchases } from "@/lib/db/schema/purchases";

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

export interface WaffoReconcileReport {
  summary: WaffoReconcileSummary;
  issues: WaffoReconcileIssue[];
}

interface WaffoPayment {
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

interface WaffoRefund {
  id: string;
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
  const refundRefs = refunds.flatMap((refund) => {
    const refs = [`waffo-refund:${refund.id}`];
    if (refund.refundTicketMerchantExternalId) {
      refs.push(`waffo-refund:${refund.refundTicketMerchantExternalId}`);
    }
    return refs;
  });
  const ledgerRefs = [...orderIds, ...refundRefs];

  const localPurchases = orderIds.length
    ? await db
        .select()
        .from(purchases)
        .where(and(eq(purchases.provider, "waffo"), inArray(purchases.providerRef, orderIds)))
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

  const purchaseByOrder = new Map(localPurchases.map((purchase) => [purchase.providerRef, purchase]));
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

    const local = purchaseByOrder.get(orderId);
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

    if (local.status !== "succeeded" && local.status !== "refunded") {
      issues.push({
        severity: "error",
        code: "local_purchase_status_mismatch",
        message: `Local purchase status is ${local.status}, expected succeeded/refunded.`,
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

    const expectedLedgerRefs = [
      refund.refundTicketMerchantExternalId
        ? `waffo-refund:${refund.refundTicketMerchantExternalId}`
        : null,
      `waffo-refund:${refund.id}`,
    ].filter(isString);

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

  return { summary, issues };
}

function normalizeLimit(limit: number): number {
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    throw new Error("limit must be an integer between 1 and 500");
  }
  return limit;
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}
