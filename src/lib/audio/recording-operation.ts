const CLIENT_OPERATION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Mint one stable id for the lifetime of a single recorded take. */
export function createRecordingOperationId(): string {
  return crypto.randomUUID();
}

/**
 * Accept only UUID-shaped ids. The value is client-minted, but constraining it
 * keeps ledger references bounded and prevents arbitrary strings from becoming
 * billing keys.
 */
export function parseRecordingOperationId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return CLIENT_OPERATION_ID_PATTERN.test(normalized) ? normalized : null;
}
