"use client";

import { request } from "@/lib/api/request";

export class ApiTimeoutError extends Error {
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(`Request timed out after ${timeoutMs}ms`);
    this.name = "ApiTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

export function isApiTimeoutError(error: unknown): error is ApiTimeoutError {
  return error instanceof ApiTimeoutError;
}

export function timeoutSignal(timeoutMs: number, signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  if (!signal) return timeout;
  return AbortSignal.any([signal, timeout]);
}

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = 12_000,
): Promise<Response> {
  const deadline = createDeadlineSignal(timeoutMs, init.signal ?? undefined);
  try {
    return await fetch(input, {
      ...init,
      signal: deadline.signal,
    });
  } catch (error) {
    if (deadline.didTimeout() && isAbortError(error)) {
      throw new ApiTimeoutError(timeoutMs);
    }
    throw error;
  } finally {
    deadline.cleanup();
  }
}

export async function requestWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = 12_000,
): Promise<Response> {
  const deadline = createDeadlineSignal(timeoutMs, init.signal ?? undefined);
  try {
    return await request(input, {
      ...init,
      signal: deadline.signal,
    });
  } catch (error) {
    if (deadline.didTimeout() && isAbortError(error)) {
      throw new ApiTimeoutError(timeoutMs);
    }
    throw error;
  } finally {
    deadline.cleanup();
  }
}

export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message?: string,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new ApiTimeoutError(timeoutMs)),
          timeoutMs,
        );
      }),
    ]);
  } catch (error) {
    if (error instanceof ApiTimeoutError && message) {
      error.message = message;
    }
    throw error;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  );
}

function createDeadlineSignal(timeoutMs: number, callerSignal?: AbortSignal) {
  const controller = new AbortController();
  let cause: "caller" | "timeout" | null = null;

  const abortFromCaller = () => {
    if (cause !== null) return;
    cause = "caller";
    controller.abort(callerSignal?.reason);
  };

  if (callerSignal?.aborted) {
    abortFromCaller();
  } else {
    callerSignal?.addEventListener("abort", abortFromCaller, { once: true });
  }

  const timeoutId = setTimeout(() => {
    if (cause !== null) return;
    cause = "timeout";
    controller.abort(new DOMException("Request timed out", "TimeoutError"));
  }, timeoutMs);

  return {
    signal: controller.signal,
    didTimeout: () => cause === "timeout",
    cleanup: () => {
      clearTimeout(timeoutId);
      callerSignal?.removeEventListener("abort", abortFromCaller);
    },
  };
}
