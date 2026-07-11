/**
 * Client-side reader for the shared error envelope every Murmur API
 * route returns (`docs/api-conventions.md` §3.2):
 * `{ error, message?, requestId }`.
 *
 * Screens use this to surface the server's stable error code and
 * request id inside user-facing support codes, so a screenshot of a
 * toast can be correlated with server logs.
 */

export type ApiErrorEnvelope = {
  status: number;
  /** Machine-readable error code; `fallbackCode` when the body has none. */
  code: string;
  requestId: string | null;
};

/** Never throws: non-JSON or malformed bodies fall back to `fallbackCode`. */
export async function readApiErrorEnvelope(
  response: Response,
  fallbackCode: string,
): Promise<ApiErrorEnvelope> {
  const body = (await response.json().catch(() => null)) as
    | { error?: unknown; requestId?: unknown }
    | null;
  return {
    status: response.status,
    code: typeof body?.error === "string" && body.error ? body.error : fallbackCode,
    requestId: typeof body?.requestId === "string" && body.requestId ? body.requestId : null,
  };
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
