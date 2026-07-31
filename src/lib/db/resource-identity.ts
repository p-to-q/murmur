import { createHash } from "node:crypto";

/** Canonical, credential-free identity shared by release DB proofs. */
export function databaseIdentity(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") return null;
    const database = url.pathname.replace(/^\/+/, "").toLowerCase();
    if (!url.hostname || !database) return null;
    const hostname = url.hostname.toLowerCase().replace(/-pooler(?=\.|$)/, "");
    const port = url.port || "5432";
    return `${hostname}:${port}/${database}`;
  } catch {
    return null;
  }
}

export function databaseResourceIdFromDsn(value: string): string | null {
  const identity = databaseIdentity(value);
  return identity
    ? `sha256:${createHash("sha256").update(identity).digest("hex")}`
    : null;
}
