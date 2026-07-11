export function createSpendReference(
  kind: "hum" | "music_generate" | "llm_edit",
): string {
  return `${kind}:${crypto.randomUUID()}`;
}

/**
 * Client-stable operation ids are namespaced under `<kind>:op:` so a retry of
 * the SAME operation reuses one spend externalRef (deduping into one spend row
 * via the ledger idempotency index), while random per-request refs from
 * `createSpendReference` can never collide with them (#298).
 */
const OPERATION_SPEND_REF_INFIX = ":op:";

/** Bounded, opaque token: keeps a hostile/oversized operation id out of the ledger. */
const OPERATION_ID_PATTERN = /^[A-Za-z0-9._-]{8,128}$/;

/**
 * Validate a client-supplied stable operation id. Legacy clients omit it
 * entirely (callers fall back to `createSpendReference`); this only guards the
 * shape of an id that IS supplied so it is a safe, bounded external_ref.
 */
export function isValidOperationId(value: unknown): value is string {
  return typeof value === "string" && OPERATION_ID_PATTERN.test(value);
}

/**
 * Deterministic spend externalRef for a stable operation id. Two requests
 * carrying the same operation id produce the same ref, so the second dedupes
 * onto the first's spend row instead of double-charging (#298).
 */
export function operationSpendReference(
  kind: "hum" | "music_generate" | "llm_edit",
  operationId: string,
): string {
  return `${kind}${OPERATION_SPEND_REF_INFIX}${operationId}`;
}
