#!/usr/bin/env bun
/**
 * Read-only Waffo ↔ local billing reconciliation.
 *
 * Usage:
 *   bun run waffo:reconcile
 *
 * This script does not mutate Waffo or the local database. It compares Waffo
 * GraphQL payment/refund facts against local `purchases` + `notes_ledger`.
 */

import { config as loadEnv } from "dotenv";
import { and, eq, inArray } from "drizzle-orm";
import { resolve } from "node:path";
import { WaffoPancake } from "@waffo/pancake-ts";

import { displayAmountToCents } from "@/lib/billing/waffo";
import { db } from "@/lib/db/client";
import { notesLedger } from "@/lib/db/schema/notes-ledger";
import { purchases } from "@/lib/db/schema/purchases";

const ROOT = resolve(import.meta.dir, "..");
loadEnv({ path: resolve(ROOT, ".env.local") });
loadEnv({ path: resolve(ROOT, ".env") });

type Severity = "warn" | "error";

interface ReconcileIssue {
  severity: Severity;
  code: string;
  message: string;
  orderId?: string;
  paymentId?: string;
  refundId?: string;
}

interface WaffoPayment {
  id: string;
  orderId: string | null;
  status: string;
  orderMerchantExternalId: string | null;
  snapshotAmountDetails: {
    currency: string;
    total: string;
  } | null;
  onetimeOrder: {
    id: string;
    status: string;
    buyerEmail: string | null;
  } | null;
}

interface WaffoRefund {
  id: string;
  status: string;
  orderMerchantExternalId: string | null;
  refundTicketMerchantExternalId: string | null;
  pspAmountDetails: {
    amount: string;
    currency: string;
  } | null;
}

interface WaffoReconcileQuery {
  payments: WaffoPayment[];
  refunds: WaffoRefund[];
}

function resolvePrivateKey(): string | null {
  const inline = process.env.WAFFO_PRIVATE_KEY?.trim();
  if (inline) return inline;

  const fromBase64 = process.env.WAFFO_PRIVATE_KEY_BASE64?.trim();
  if (!fromBase64) return null;

  const decoded = Buffer.from(fromBase64, "base64").toString("utf-8");
  return decoded.includes("BEGIN") ? decoded : fromBase64;
}

function parseLimit(): number {
  const raw = process.argv.find((arg) => arg.startsWith("--limit="))?.split("=")[1];
  const value = raw ? Number(raw) : 100;
  if (!Number.isInteger(value) || value < 1 || value > 500) {
    throw new Error("--limit must be an integer between 1 and 500");
  }
  return value;
}

function formatIssue(issue: ReconcileIssue): string {
  const ref = [issue.orderId, issue.paymentId, issue.refundId].filter(Boolean).join(" ");
  return `${issue.severity.toUpperCase()} ${issue.code}${ref ? ` ${ref}` : ""}: ${issue.message}`;
}

async function main() {
  const merchantId = process.env.WAFFO_MERCHANT_ID?.trim();
  const privateKey = resolvePrivateKey();
  if (!merchantId || !privateKey) {
    throw new Error("Set WAFFO_MERCHANT_ID and WAFFO_PRIVATE_KEY in .env.local first.");
  }

  const limit = parseLimit();
  const client = new WaffoPancake({ merchantId, privateKey });
  const waffo = await client.graphql.query<WaffoReconcileQuery>({
    query: `query ReconcileWaffoBilling($limit: Int!) {
      payments(limit: $limit, filter: { status: { eq: "succeeded" } }) {
        id
        orderId
        status
        orderMerchantExternalId
        snapshotAmountDetails { currency total }
        onetimeOrder { id status buyerEmail }
      }
      refunds(limit: $limit, filter: { status: { eq: "succeeded" } }) {
        id
        status
        orderMerchantExternalId
        refundTicketMerchantExternalId
        pspAmountDetails { amount currency }
      }
    }`,
    variables: { limit },
  });

  if (waffo.errors?.length) {
    throw new Error(`Waffo GraphQL errors: ${waffo.errors.map((e) => e.message).join("; ")}`);
  }

  const payments = waffo.data?.payments ?? [];
  const refunds = waffo.data?.refunds ?? [];
  const orderIds = Array.from(new Set(payments.map((p) => p.orderId).filter(isString)));
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

  const purchaseByOrder = new Map(localPurchases.map((p) => [p.providerRef, p]));
  const grantByOrder = new Map(
    localLedgers
      .filter((l) => l.reason === "purchase:topup" && l.externalRef)
      .map((l) => [l.externalRef!, l]),
  );
  const refundLedgerRefs = new Set(
    localLedgers
      .filter((l) => l.reason === "refund:topup" && l.externalRef)
      .map((l) => l.externalRef!),
  );
  const issues: ReconcileIssue[] = [];

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
    if (amount) {
      const cents = displayAmountToCents(amount.total, amount.currency);
      if (local.currency.toUpperCase() === amount.currency.toUpperCase() && local.amountCents !== cents) {
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
    errorCount: issues.filter((i) => i.severity === "error").length,
    warnCount: issues.filter((i) => i.severity === "warn").length,
  };

  console.log(JSON.stringify({ summary, issues }, null, 2));
  for (const issue of issues) {
    console.error(formatIssue(issue));
  }
  if (summary.errorCount > 0) process.exitCode = 1;
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

await main();
