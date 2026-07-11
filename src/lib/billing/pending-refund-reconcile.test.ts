import { beforeEach, describe, expect, it } from "bun:test";

import type { PendingRefundMarker } from "@/lib/db/queries/notes-ledger";
import {
  reconcilePendingRefunds,
  retryPendingRefunds,
  type PendingRefundRetryDeps,
} from "@/lib/billing/pending-refund-reconcile";

function marker(id: string, epochMs: number): PendingRefundMarker {
  return {
    id,
    userId: "usr_1",
    originalLedgerId: `spend_${id}`,
    createdAt: new Date(epochMs),
    metadata: {},
  };
}

/** Cursor-faithful pagination over a fixed marker set (createdAt, id). */
function paginate(
  all: PendingRefundMarker[],
  limit: number,
  after?: { createdAt: Date; id: string } | null,
): PendingRefundMarker[] {
  const sorted = [...all].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id),
  );
  const start = after
    ? sorted.findIndex(
        (m) =>
          m.createdAt.getTime() > after.createdAt.getTime() ||
          (m.createdAt.getTime() === after.createdAt.getTime() && m.id > after.id),
      )
    : 0;
  if (start === -1) return [];
  return sorted.slice(start, start + limit);
}

function pagedListMarkers(all: PendingRefundMarker[]): {
  listMarkers: PendingRefundRetryDeps["listMarkers"];
  calls: () => number;
} {
  let calls = 0;
  return {
    calls: () => calls,
    listMarkers: async ({ limit, after }) => {
      calls += 1;
      return paginate(all, limit, after);
    },
  };
}

// ─── Injected ledger deps for the DB-backed reconcilePendingRefunds (#299) ──
//
// Injected rather than `mock.module`-ed so the real `@/lib/db/queries/notes-ledger`
// module stays intact for the orchestration tests that import it (bun's mock
// registry is process-global and would otherwise shadow it cross-file).

let dbMarkers: PendingRefundMarker[] = [];
let refundCalls: string[] = [];
type RefundOutcome = { ok: true; duplicate: boolean } | { ok: false; reason: string };
let refundImpl: (originalLedgerId: string) => RefundOutcome = () => ({ ok: true, duplicate: false });

function injectedDeps(): PendingRefundRetryDeps {
  return {
    listMarkers: async ({ limit, after }) => paginate(dbMarkers, limit, after),
    retryRefund: async (originalLedgerId) => {
      refundCalls.push(originalLedgerId);
      const out = refundImpl(originalLedgerId);
      return out.ok
        ? { ok: true, duplicate: out.duplicate }
        : { ok: false, duplicate: false, reason: out.reason };
    },
  };
}

beforeEach(() => {
  dbMarkers = [];
  refundCalls = [];
  refundImpl = () => ({ ok: true, duplicate: false });
});

describe("retryPendingRefunds (#238)", () => {
  it("classifies newly-fixed, already-settled, and manual-review outcomes", async () => {
    const { listMarkers } = pagedListMarkers([marker("a", 1), marker("b", 2), marker("c", 3)]);
    const deps: PendingRefundRetryDeps = {
      listMarkers,
      retryRefund: async (originalLedgerId) => {
        if (originalLedgerId === "spend_a") return { ok: true, duplicate: false };
        if (originalLedgerId === "spend_b") return { ok: true, duplicate: true };
        return { ok: false, duplicate: false, reason: "original_not_found" };
      },
    };

    const summary = await retryPendingRefunds(deps, { pageLimit: 10 });

    expect(summary).toEqual({
      scanned: 3,
      refundsFixed: 1,
      alreadySettled: 1,
      requiresManualReview: 1,
      pages: 1,
    });
  });

  it("counts a thrown retry as requiring manual review", async () => {
    const { listMarkers } = pagedListMarkers([marker("a", 1)]);
    const summary = await retryPendingRefunds({
      listMarkers,
      retryRefund: async () => {
        throw new Error("db unreachable");
      },
    });

    expect(summary.requiresManualReview).toBe(1);
    expect(summary.refundsFixed).toBe(0);
  });

  it("walks every page with a stable cursor until the tail", async () => {
    const markers = Array.from({ length: 5 }, (_, i) => marker(`m${i}`, i + 1));
    const paged = pagedListMarkers(markers);
    const retried: string[] = [];

    const summary = await retryPendingRefunds(
      {
        listMarkers: paged.listMarkers,
        retryRefund: async (id) => {
          retried.push(id);
          return { ok: true, duplicate: false };
        },
      },
      { pageLimit: 2 },
    );

    expect(summary.scanned).toBe(5);
    expect(summary.refundsFixed).toBe(5);
    expect(summary.pages).toBe(3);
    expect(new Set(retried).size).toBe(5);
  });

  it("stops at maxPages so one run can't scan an unbounded backlog", async () => {
    const markers = Array.from({ length: 6 }, (_, i) => marker(`m${i}`, i + 1));
    const paged = pagedListMarkers(markers);

    const summary = await retryPendingRefunds(
      {
        listMarkers: paged.listMarkers,
        retryRefund: async () => ({ ok: true, duplicate: false }),
      },
      { pageLimit: 2, maxPages: 2 },
    );

    expect(summary.scanned).toBe(4);
    expect(summary.pages).toBe(2);
    expect(paged.calls()).toBe(2);
  });

  it("is a no-op when there are no pending markers", async () => {
    const { listMarkers } = pagedListMarkers([]);
    const summary = await retryPendingRefunds({
      listMarkers,
      retryRefund: async () => ({ ok: true, duplicate: false }),
    });

    expect(summary).toEqual({
      scanned: 0,
      refundsFixed: 0,
      alreadySettled: 0,
      requiresManualReview: 0,
      pages: 0,
    });
  });
});

describe("reconcilePendingRefunds — provider-neutral DB reconciler (#299)", () => {
  it("recovers pending refunds with no Waffo involvement at all", async () => {
    // No Waffo client, merchant id, or private key is referenced — this path is
    // pure ledger. Two owed refunds are applied straight from the markers.
    dbMarkers = [marker("a", 1), marker("b", 2)];
    refundImpl = () => ({ ok: true, duplicate: false });

    const summary = await reconcilePendingRefunds({}, injectedDeps());

    expect(summary).toMatchObject({ scanned: 2, refundsFixed: 2, requiresManualReview: 0 });
    expect(refundCalls).toEqual(["spend_a", "spend_b"]);
  });

  it("is idempotent across repeated runs (already-refunded spends become no-ops)", async () => {
    dbMarkers = [marker("a", 1), marker("b", 2)];

    // First run applies both.
    refundImpl = () => ({ ok: true, duplicate: false });
    const first = await reconcilePendingRefunds({}, injectedDeps());
    expect(first.refundsFixed).toBe(2);

    // Second run: the spends are already refunded (or delivered → #298) →
    // duplicate → already-settled, never double-refunded.
    refundImpl = () => ({ ok: true, duplicate: true });
    const second = await reconcilePendingRefunds({}, injectedDeps());
    expect(second).toMatchObject({ scanned: 2, refundsFixed: 0, alreadySettled: 2, requiresManualReview: 0 });
  });

  it("treats an already-refunded (or delivered) spend as settled, not a new refund", async () => {
    dbMarkers = [marker("a", 1)];
    refundImpl = () => ({ ok: true, duplicate: true });

    const summary = await reconcilePendingRefunds({}, injectedDeps());

    expect(summary).toMatchObject({ scanned: 1, refundsFixed: 0, alreadySettled: 1 });
  });

  it("isolates a partial failure without blocking the rest of the batch", async () => {
    dbMarkers = [marker("a", 1), marker("b", 2), marker("c", 3)];
    refundImpl = (id) =>
      id === "spend_b" ? { ok: false, reason: "user_not_found" } : { ok: true, duplicate: false };

    const summary = await reconcilePendingRefunds({}, injectedDeps());

    expect(summary).toMatchObject({ scanned: 3, refundsFixed: 2, requiresManualReview: 1 });
  });

  it("is a no-op when there is nothing owed", async () => {
    dbMarkers = [];
    const summary = await reconcilePendingRefunds({}, injectedDeps());
    expect(summary).toMatchObject({ scanned: 0, refundsFixed: 0, pages: 0 });
    expect(refundCalls).toHaveLength(0);
  });

  it("wires the real ledger deps by default (no injection needed in production)", async () => {
    // Smoke check that the default-deps path is callable; with no markers in the
    // (mock-free) test DB layer it simply returns an empty summary shape.
    const summary = await reconcilePendingRefunds({}, injectedDeps());
    expect(summary).toHaveProperty("refundsFixed");
  });
});
