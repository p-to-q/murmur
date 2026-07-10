export function createSpendReference(
  kind: "hum" | "music_generate" | "llm_edit",
): string {
  return `${kind}:${crypto.randomUUID()}`;
}
