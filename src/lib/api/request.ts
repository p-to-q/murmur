import { authClient } from "@/lib/platform/auth-client";
import { resolveApiUrl } from "./base-url";

/**
 * Fetch wrapper that attaches Murmur's standalone local user headers
 * and prefixes relative `/api/...` paths with the configured remote
 * API host. The base URL is resolved by `apiBaseUrl()`:
 *
 * - empty in the web shell (relative same-origin fetches);
 * - the deployed Next.js host inside Capacitor / 微信 MP, where
 *   relative paths would 404 against the local WebView origin.
 *
 * See `docs/research-2026-06.md` §2 for why this indirection is the
 * thing that has to exist before the native shells are built.
 */
export async function request(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  return fetch(rewriteRequestInput(input), {
    ...init,
    headers: {
      ...init.headers,
      ...authClient.getRequestHeaders(),
    },
  });
}

function rewriteRequestInput(input: RequestInfo | URL): RequestInfo | URL {
  if (typeof input === "string") return resolveApiUrl(input);
  if (input instanceof URL) return input;
  // Request objects: leave them alone. Callers that pass a Request
  // already chose the URL semantics they want; rewriting it would
  // require cloning the entire body stream.
  return input;
}
