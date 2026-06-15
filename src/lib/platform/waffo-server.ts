export function resolveWaffoPrivateKey(): string | null {
  const inline = process.env.WAFFO_PRIVATE_KEY?.trim();
  if (inline) return inline;

  const fromBase64 = process.env.WAFFO_PRIVATE_KEY_BASE64?.trim();
  if (!fromBase64) return null;

  const decoded = Buffer.from(fromBase64, "base64").toString("utf-8");
  if (decoded.includes("BEGIN")) return decoded;
  return fromBase64;
}
