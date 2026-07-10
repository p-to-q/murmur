import { describe, expect, it } from "bun:test";

import {
  TimeoutError,
  deadlineSignal,
  isTimeoutError,
  mergeSignals,
  withTimeout,
} from "./deadline";

function defer<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("TimeoutError", () => {
  it("carries the timeout duration and optional label", () => {
    const err = new TimeoutError(250, "worker.transcribe");
    expect(err).toBeInstanceOf(TimeoutError);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("TimeoutError");
    expect(err.kind).toBe("timeout");
    expect(err.ms).toBe(250);
    expect(err.label).toBe("worker.transcribe");
    expect(err.message).toContain("250ms");
    expect(err.message).toContain("worker.transcribe");
  });

  it("omits label from the message when not provided", () => {
    const err = new TimeoutError(100);
    expect(err.label).toBeUndefined();
    expect(err.message).toBe("Deadline exceeded after 100ms");
  });
});

describe("withTimeout", () => {
  it("resolves with the inner value when the promise settles before the deadline", async () => {
    const value = await withTimeout(Promise.resolve(42), 1_000);
    expect(value).toBe(42);
  });

  it("rejects with TimeoutError when the deadline fires first", async () => {
    const pending = defer<number>();
    try {
      await withTimeout(pending.promise, 20, { label: "test.slow" });
      throw new Error("expected timeout");
    } catch (error) {
      expect(error).toBeInstanceOf(TimeoutError);
      expect((error as TimeoutError).ms).toBe(20);
      expect((error as TimeoutError).label).toBe("test.slow");
    } finally {
      pending.resolve(0);
    }
  });

  it("forwards the inner rejection unchanged when it fires before the deadline", async () => {
    const inner = new Error("boom");
    await expect(withTimeout(Promise.reject(inner), 1_000)).rejects.toBe(inner);
  });

  it("rejects immediately when the caller signal is already aborted", async () => {
    const controller = new AbortController();
    const reason = new Error("caller cancelled");
    controller.abort(reason);
    await expect(
      withTimeout(Promise.resolve(1), 1_000, { signal: controller.signal }),
    ).rejects.toBe(reason);
  });

  it("rejects with the abort reason when the caller signal aborts mid-flight", async () => {
    const controller = new AbortController();
    const pending = defer<number>();
    const promise = withTimeout(pending.promise, 1_000, { signal: controller.signal });
    const reason = new Error("user navigated away");
    setTimeout(() => controller.abort(reason), 5);
    await expect(promise).rejects.toBe(reason);
    pending.resolve(0);
  });

  it("does not leak the timer when the promise resolves early", async () => {
    // Bun's test runner reports open handles when the process exits
    // with an unsettled timer. We can't directly assert that here,
    // but we can assert behaviour: resolving first should not cause
    // the timeout to fire later (which would attempt to reject an
    // already-settled promise and throw an unhandled rejection).
    const value = await withTimeout(Promise.resolve("ok"), 5);
    expect(value).toBe("ok");
    await new Promise((r) => setTimeout(r, 20));
  });

  it("rejects synchronously on an invalid ms argument", () => {
    expect(() => withTimeout(Promise.resolve(1), Number.NaN)).toThrow(TypeError);
    expect(() => withTimeout(Promise.resolve(1), -1)).toThrow(TypeError);
    expect(() => withTimeout(Promise.resolve(1), Number.POSITIVE_INFINITY)).toThrow(TypeError);
  });
});

describe("deadlineSignal", () => {
  it("returns a signal that aborts after ms with a TimeoutError reason", async () => {
    const handle = deadlineSignal(15, { label: "fetch.test" });
    await new Promise((r) => setTimeout(r, 30));
    expect(handle.signal.aborted).toBe(true);
    const reason = (handle.signal as AbortSignal & { reason?: unknown }).reason;
    expect(reason).toBeInstanceOf(TimeoutError);
    expect((reason as TimeoutError).ms).toBe(15);
    expect((reason as TimeoutError).label).toBe("fetch.test");
  });

  it("cancel() prevents the deadline from aborting the signal later", async () => {
    const handle = deadlineSignal(15);
    handle.cancel();
    await new Promise((r) => setTimeout(r, 30));
    expect(handle.signal.aborted).toBe(false);
  });

  it("aborts immediately with the caller's reason when the parent signal is already aborted", () => {
    const controller = new AbortController();
    const reason = new Error("parent done");
    controller.abort(reason);
    const handle = deadlineSignal(1_000, { signal: controller.signal });
    expect(handle.signal.aborted).toBe(true);
    expect((handle.signal as AbortSignal & { reason?: unknown }).reason).toBe(reason);
  });

  it("propagates parent abort that happens before the deadline", async () => {
    const controller = new AbortController();
    const handle = deadlineSignal(1_000, { signal: controller.signal });
    const reason = new Error("parent late");
    setTimeout(() => controller.abort(reason), 5);
    await new Promise((r) => setTimeout(r, 20));
    expect(handle.signal.aborted).toBe(true);
    expect((handle.signal as AbortSignal & { reason?: unknown }).reason).toBe(reason);
  });

  it("rejects synchronously on an invalid ms argument", () => {
    expect(() => deadlineSignal(-5)).toThrow(TypeError);
    expect(() => deadlineSignal(Number.NaN)).toThrow(TypeError);
  });
});

describe("mergeSignals", () => {
  it("returns a fresh non-aborted signal when given nothing", () => {
    const signal = mergeSignals(undefined, null);
    expect(signal.aborted).toBe(false);
  });

  it("returns the input signal directly when only one is provided", () => {
    const controller = new AbortController();
    expect(mergeSignals(controller.signal)).toBe(controller.signal);
  });

  it("aborts with the first-aborted parent's reason", async () => {
    const a = new AbortController();
    const b = new AbortController();
    const signal = mergeSignals(a.signal, b.signal);
    const reason = new Error("a fired first");
    setTimeout(() => a.abort(reason), 5);
    setTimeout(() => b.abort(new Error("b fired second")), 20);
    await new Promise((r) => setTimeout(r, 40));
    expect(signal.aborted).toBe(true);
    expect((signal as AbortSignal & { reason?: unknown }).reason).toBe(reason);
  });

  it("is already-aborted when any input was already aborted", () => {
    const a = new AbortController();
    const b = new AbortController();
    const reason = new Error("pre-aborted");
    a.abort(reason);
    const signal = mergeSignals(a.signal, b.signal);
    expect(signal.aborted).toBe(true);
    expect((signal as AbortSignal & { reason?: unknown }).reason).toBe(reason);
  });
});

describe("isTimeoutError", () => {
  it("recognises our TimeoutError", () => {
    expect(isTimeoutError(new TimeoutError(100))).toBe(true);
  });

  it("recognises a DOMException-shaped TimeoutError from AbortSignal.timeout", () => {
    // Construct a faux DOMException-shape; we can't always construct
    // a real DOMException in every runtime, so test by name.
    const fake = Object.assign(new Error("timed out"), { name: "TimeoutError" });
    expect(isTimeoutError(fake)).toBe(true);
  });

  it("rejects other errors and non-errors", () => {
    expect(isTimeoutError(new Error("oops"))).toBe(false);
    expect(isTimeoutError(null)).toBe(false);
    expect(isTimeoutError(undefined)).toBe(false);
    expect(isTimeoutError("nope")).toBe(false);
    expect(isTimeoutError(42)).toBe(false);
  });
});
