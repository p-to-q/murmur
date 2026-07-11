/**
 * Client-side reader for the shared error envelope every Murmur API
 * route returns (`docs/api-conventions.md` §3.2):
 * `{ error, message?, requestId }`.
 *
 * Screens use this to surface the server's stable error code and
 * request id inside user-facing support codes, so a screenshot of a
 * toast can be correlated with server logs.
 */
import { log } from "@/lib/observability/log";

export type ApiErrorEnvelope = {
  status: number;
  /** Machine-readable error code; `fallbackCode` when the body has none. */
  code: string;
  requestId: string | null;
};

export interface ReadApiErrorEnvelopeOptions {
  /**
   * When provided, the parsed `error` code must be a member of this set. A code
   * outside the set — or a body that doesn't match the `{ error, message?,
   * requestId? }` envelope shape — degrades to `fallbackCode` and emits
   * `api.error_envelope_invalid`, so an unmapped/rotated server code surfaces in
   * logs instead of being blindly trusted at the boundary (#223).
   *
   * Omitted by callers that don't (yet) enumerate their codes; those keep the
   * original silent-fallback behavior with no extra logging.
   */
  knownCodes?: ReadonlySet<string>;
  /** Boundary label included in the validation log (e.g. "auth"). */
  area?: string;
}

/**
 * Never throws: non-JSON or malformed bodies fall back to `fallbackCode`. When
 * `options.knownCodes` is supplied, the envelope is additionally validated at
 * runtime and anomalies are logged (see {@link ReadApiErrorEnvelopeOptions}).
 */
export async function readApiErrorEnvelope(
  response: Response,
  fallbackCode: string,
  options: ReadApiErrorEnvelopeOptions = {},
): Promise<ApiErrorEnvelope> {
  const status = response.status;
  const body = (await response.json().catch(() => null)) as unknown;

  const record =
    typeof body === "object" && body !== null
      ? (body as { error?: unknown; message?: unknown; requestId?: unknown })
      : null;

  const rawCode =
    record && typeof record.error === "string" && record.error
      ? record.error
      : null;
  const requestId =
    record && typeof record.requestId === "string" && record.requestId
      ? record.requestId
      : null;

  // Only strict callers (those declaring their known code set) trigger runtime
  // validation + logging; everyone else keeps the original silent fallback so
  // expected upstream failures (e.g. a proxy's HTML 502) don't spam logs.
  if (options.knownCodes) {
    const reason = envelopeValidationReason(record, rawCode, options.knownCodes);
    if (reason) {
      log(
        "api.error_envelope_invalid",
        {
          area: options.area ?? null,
          status,
          reason,
          receivedCode: rawCode,
          errorFieldType: record ? typeof record.error : "no_body",
        },
        { level: "warn" },
      );
      return { status, code: fallbackCode, requestId };
    }
  }

  return {
    status,
    code: rawCode ?? fallbackCode,
    requestId,
  };
}

/**
 * Classify why an error envelope failed strict validation, or `null` when it is
 * well-formed and carries a known code. Non-throwing and side-effect free.
 */
function envelopeValidationReason(
  record: { error?: unknown; message?: unknown } | null,
  rawCode: string | null,
  knownCodes: ReadonlySet<string>,
): "malformed_envelope" | "unknown_code" | null {
  // No JSON object, or no usable string `error` field.
  if (!record || rawCode === null) return "malformed_envelope";
  // `message` is optional but, when present, must be a string per the contract.
  if (record.message !== undefined && typeof record.message !== "string") {
    return "malformed_envelope";
  }
  if (!knownCodes.has(rawCode)) return "unknown_code";
  return null;
}

/** Thrown by screens when a fetch to a Murmur API route returns non-2xx. */
export class ApiEnvelopeError extends Error {
  constructor(public readonly envelope: ApiErrorEnvelope) {
    super(`API ${envelope.status} ${envelope.code}`);
    this.name = "ApiEnvelopeError";
  }
}

/** The envelope if `error` came from a non-2xx API response, else null. */
export function apiErrorEnvelopeFrom(error: unknown): ApiErrorEnvelope | null {
  return error instanceof ApiEnvelopeError ? error.envelope : null;
}
