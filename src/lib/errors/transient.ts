/**
 * Shared error classification for retry and observability decisions.
 *
 * Centralizes the "is this safe to retry?" question so routes, workers,
 * and the client all agree on what counts as transient.
 */

export type ErrorClass =
  | "transient"
  | "client"
  | "auth"
  | "billing"
  | "validation"
  | "internal";

export interface ClassifiedError {
  class: ErrorClass;
  retryable: boolean;
  message: string;
  status: number;
}

export function isTransient(error: unknown): boolean {
  return classifyError(error).retryable;
}

export function classifyError(error: unknown): ClassifiedError {
  if (error instanceof Error && "status" in error) {
    const status = (error as { status: number }).status;
    const retryable = "retryable" in error
      ? !!(error as { retryable: boolean }).retryable
      : isTransientStatus(status);
    return {
      class: classFromStatus(status),
      retryable,
      message: error.message,
      status,
    };
  }

  if (error instanceof TypeError || error instanceof DOMException) {
    return {
      class: "transient",
      retryable: true,
      message: error.message,
      status: 502,
    };
  }

  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    if (
      msg.includes("timeout") ||
      msg.includes("econnrefused") ||
      msg.includes("econnreset") ||
      msg.includes("fetch failed") ||
      msg.includes("network")
    ) {
      return { class: "transient", retryable: true, message: error.message, status: 502 };
    }
    return { class: "internal", retryable: false, message: error.message, status: 500 };
  }

  return {
    class: "internal",
    retryable: false,
    message: String(error),
    status: 500,
  };
}

export function classifyHttpStatus(status: number): ClassifiedError {
  return {
    class: classFromStatus(status),
    retryable: isTransientStatus(status),
    message: `HTTP ${status}`,
    status,
  };
}

function isTransientStatus(status: number): boolean {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

function classFromStatus(status: number): ErrorClass {
  if (status === 401 || status === 403) return "auth";
  if (status === 402) return "billing";
  if (status === 400 || status === 413 || status === 422) return "validation";
  if (isTransientStatus(status)) return "transient";
  if (status >= 400 && status < 500) return "client";
  return "internal";
}
