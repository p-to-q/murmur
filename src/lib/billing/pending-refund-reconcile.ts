/**
 * Provider-neutral, DB-backed pending-spend-refund reconciler (#299).
 *
 * Durable `refund:pending` markers are written (#232) when an in-request refund
 * for a failed hum/music spend could not complete. Recovering them must NOT
 * depend on Waffo: a product spend refund is a pure ledger operation with no
 * payment provider involved, so it recovers here — reading the markers straight
 * from the ledger and retrying `refundNotes` idempotently on the original spend
 * ledger id — instead of riding along with Waffo purchase reconciliation (which
 * needs Waffo credentials and only ran refunds when auto-fix was enabled).
 *
 * Idempotency: every retry keys on the original spend's ledger id. `refundNotes`
 * dedupes on `refund:<spendId>`, so a marker whose spend was already refunded
 * reports `duplicate` and is counted as already-settled — never double-refunded.
 * A delivered operation (#298) is likewise skipped, so a retry can never refund
 * work the user received. Safe to run repeatedly and concurrently with the
 * in-request refund path.
 */
import {
  listPendingRefundMarkers,
  refundNotes,
  type PendingRefundCursor,
  type PendingRefundMarker,
} from "@/lib/db/queries/notes-ledger";

export interface PendingRefundRetryDeps {
  listMarkers: (input: {
    limit: number;
    after?: PendingRefundCursor | null;
  }) => Promise<PendingRefundMarker[]>;
  retryRefund: (
    originalLedgerId: string,
  ) => Promise<{ ok: boolean; duplicate: boolean; reason?: string }>;
}

export interface PendingRefundRetrySummary {
  scanned: number;
  refundsFixed: number;
  alreadySettled: number;
  requiresManualReview: number;
  pages: number;
}

/**
 * Walk the durable `refund:pending` markers with a stable (created_at, id)
 * cursor and retry each reversal. Dependencies are injected so the pagination +
 * classification can be unit-tested without a database. The retry itself is
 * idempotent, so a marker for an already-refunded (or delivered) spend simply
 * reports `duplicate` and is counted as already-settled rather than
 * double-refunded.
 */
export async function retryPendingRefunds(
  deps: PendingRefundRetryDeps,
  options: { pageLimit?: number; maxPages?: number } = {},
): Promise<PendingRefundRetrySummary> {
  const pageLimit = clampInt(options.pageLimit ?? 100, 1, 500);
  const maxPages = clampInt(options.maxPages ?? 20, 1, 1000);
  const summary: PendingRefundRetrySummary = {
    scanned: 0,
    refundsFixed: 0,
    alreadySettled: 0,
    requiresManualReview: 0,
    pages: 0,
  };
  let after: PendingRefundCursor | null = null;

  for (let page = 0; page < maxPages; page += 1) {
    const markers = await deps.listMarkers({ limit: pageLimit, after });
    if (markers.length === 0) break;
    summary.pages += 1;

    for (const marker of markers) {
      summary.scanned += 1;
      try {
        const res = await deps.retryRefund(marker.originalLedgerId);
        if (res.ok && !res.duplicate) summary.refundsFixed += 1;
        else if (res.ok) summary.alreadySettled += 1;
        else summary.requiresManualReview += 1;
      } catch {
        summary.requiresManualReview += 1;
      }
    }

    const last = markers[markers.length - 1];
    after = { createdAt: last.createdAt, id: last.id };
    // A short page means the cursor reached the tail — nothing left to walk.
    if (markers.length < pageLimit) break;
  }

  return summary;
}

export interface PendingRefundReconcileOptions {
  /** Page size for the durable pending-refund scan (default 100, max 500). */
  pageLimit?: number;
  /** Max pages to walk in one run (default 20). */
  maxPages?: number;
}

/**
 * The real ledger-backed dependencies. Factored out so tests can inject fakes
 * without `mock.module`-ing `@/lib/db/queries/notes-ledger` (which would leak
 * across bun's shared module registry into the orchestration tests that import
 * the real module).
 */
export function defaultPendingRefundDeps(): PendingRefundRetryDeps {
  return {
    listMarkers: listPendingRefundMarkers,
    retryRefund: async (originalLedgerId) => {
      const res = await refundNotes({ originalLedgerId });
      return res.ok
        ? { ok: true, duplicate: res.duplicate }
        : { ok: false, duplicate: false, reason: res.reason };
    },
  };
}

/**
 * Reconcile durable pending spend refunds directly against the ledger (#299).
 * No provider client, credentials, or auto-fix flag required — this is the
 * standalone recovery path for product spend refunds.
 */
export async function reconcilePendingRefunds(
  options: PendingRefundReconcileOptions = {},
  deps: PendingRefundRetryDeps = defaultPendingRefundDeps(),
): Promise<PendingRefundRetrySummary> {
  return retryPendingRefunds(deps, options);
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}
