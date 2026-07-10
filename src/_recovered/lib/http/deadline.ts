/**
 * Deadline / timeout primitives for external IO.
 *
 * Background:
 * `AbortSignal.timeout(ms)` is built into the runtime and works for
 * the simple case (one fetch, one deadline). But every real call site
 * needs at least one of these things that the built-in doesn't give:
 *
 *   1. A typed error (`TimeoutError`) so handlers can distinguish
 *      "user cancelled" (DOMException name === "AbortError" with no
 *      timing info) from "we hit our deadline".
 *   2. Composition with caller-supplied signals — a user navigating
 *      away should cancel the request even if the deadline hasn't
 *      fired, and vice versa.
 *   3. Guaranteed timer cleanup on settle. A naive Promise.race
 *      with setTimeout leaks the timer until the test runner exits
 *      and noisily extends test runtime.
 *   4. A label for diagnostics — `transcribe.worker` vs `revenuecat.purchase`
 *      are very different deadlines; the error message should say which.
 *
 * Research footnotes:
 *   docs/research-2026-06.md §6 — RevenueCat Promises can hang forever
 *   docs/research-2026-06.md §4 — audio worker cold start ~10s P95
 */

export interface DeadlineOptions {
  /** Free-form label surfaced in TimeoutError.message and logs. */
  label?: string;
  /** Caller-supplied AbortSignal to compose with the deadline. */
  signal?: AbortSignal;
}

export class TimeoutError extends Error {
  readonly kind = "timeout" as const;
  readonly ms: number;
  readonly label: string | undefined;

  constructor(ms: number, label?: string) {
    super(
      label ? `Deadline exceeded after ${ms}ms (${label})` : `Deadline exceeded after ${ms}ms`,
    );
    this.name = "TimeoutError";
    this.ms = ms;
    this.label = label;
  }
}

/**
 * Race a Promise against a deadline. If the promise settles first,
 * the timer is cleared and the result/error propagates unchanged.
 * If the deadline fires first, reject with TimeoutError. If the
 * caller-supplied signal aborts first, reject with that abort
 * reason (or DOMException("AbortError") if no reason was given).
 *
 * The promise itself is NOT cancelled — JS has no way to cancel an
 * arbitrary Promise. For cancellation, use `deadlineSignal()` and
 * plumb the signal into the underlying API (fetch, etc.).
 */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  opts: DeadlineOptions = {},
): Promise<T> {
  if (!Number.isFinite(ms) || ms < 0) {
    throw new TypeError(`withTimeout: ms must be a non-negative finite number, got ${ms}`);
  }
  if (opts.signal?.aborted) {
    return Promise.reject(abortReasonOrError(opts.signal));
  }

  return new Promise<T>((resolve, reject) => {
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new TimeoutError(ms, opts.label));
    }, ms);

    const onAbort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(abortReasonOrError(opts.signal!));
    };

    const cleanup = () => {
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
    };

    opts.signal?.addEventListener("abort", onAbort, { once: true });

    promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(value);
      },
      (error) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      },
    );
  });
}

export interface DeadlineHandle {
  /** Signal that aborts when the deadline fires or `cancel()` is called. */
  readonly signal: AbortSignal;
  /** Stop the timer without aborting (call when the work finishes early). */
  cancel(): void;
}

/**
 * Build an AbortSignal that aborts when `ms` elapses or when any of
 * the supplied parent signals aborts. Pass `signal` into fetch /
 * DB clients to get real cancellation, not just a Promise reject.
 *
 * Always call `cancel()` when the work finishes, otherwise the timer
 * leaks (clears at next tick anyway in Node, but cleaner to be
 * explicit and helps tests detect open handles).
 */
export function deadlineSignal(
  ms: number,
  opts: DeadlineOptions = {},
): DeadlineHandle {
  if (!Number.isFinite(ms) || ms < 0) {
    throw new TypeError(`deadlineSignal: ms must be a non-negative finite number, got ${ms}`);
  }
  const controller = new AbortController();

  if (opts.signal?.aborted) {
    controller.abort(abortReasonOrError(opts.signal));
    return { signal: controller.signal, cancel: () => {} };
  }

  const timer = setTimeout(() => {
    controller.abort(new TimeoutError(ms, opts.label));
  }, ms);

  const onParentAbort = () => {
    clearTimeout(timer);
    controller.abort(abortReasonOrError(opts.signal!));
  };
  opts.signal?.addEventListener("abort", onParentAbort, { once: true });

  let cancelled = false;
  return {
    signal: controller.signal,
    cancel() {
      if (cancelled) return;
      cancelled = true;
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onParentAbort);
    },
  };
}

/**
 * Compose multiple AbortSignals into one that aborts on whichever
 * fires first. Mirrors AbortSignal.any (Node 20+, all major browsers)
 * but is small enough to keep portable and gives us a place to
 * attach a label or extra logging later if needed.
 *
 * If any input signal is already aborted, the returned signal is
 * also already aborted with that signal's reason.
 */
export function mergeSignals(...signals: ReadonlyArray<AbortSignal | undefined | null>): AbortSignal {
  const live = signals.filter((s): s is AbortSignal => Boolean(s));
  if (live.length === 0) return new AbortController().signal;
  if (live.length === 1) return live[0]!;

  const controller = new AbortController();
  const alreadyAborted = live.find((s) => s.aborted);
  if (alreadyAborted) {
    controller.abort(abortReasonOrError(alreadyAborted));
    return controller.signal;
  }

  const listeners: Array<{ signal: AbortSignal; handler: () => void }> = [];
  const cleanup = () => {
    for (const { signal, handler } of listeners) {
      signal.removeEventListener("abort", handler);
    }
  };

  for (const signal of live) {
    const handler = () => {
      controller.abort(abortReasonOrError(signal));
      cleanup();
    };
    signal.addEventListener("abort", handler, { once: true });
    listeners.push({ signal, handler });
  }

  return controller.signal;
}

/**
 * True when an error is either our TimeoutError or a DOMException
 * named "TimeoutError" (what `AbortSignal.timeout` produces in
 * browser-shaped runtimes). Use this to map errors to 504/408
 * responses without leaking implementation choice.
 */
export function isTimeoutError(error: unknown): boolean {
  if (error instanceof TimeoutError) return true;
  if (!error || typeof error !== "object") return false;
  const e = error as { name?: string };
  return e.name === "TimeoutError";
}

function abortReasonOrError(signal: AbortSignal): unknown {
  // `reason` is `unknown`; if it's undefined the platform synthesises
  // a DOMException("AbortError"). Prefer the supplied reason so
  // upstream code can attach typed cancellation info.
  const reason = (signal as AbortSignal & { reason?: unknown }).reason;
  if (reason !== undefined) return reason;
  return new DOMException("The operation was aborted.", "AbortError");
}
