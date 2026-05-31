import { authClient } from "@/lib/platform/auth-client";

/**
 * Fetch wrapper that attaches Murmur's standalone local user headers.
 * Native shells and mini-program bridges can replace authClient later without
 * leaking platform details into feature components.
 */
export async function request(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  return fetch(input, {
    ...init,
    headers: {
      ...init.headers,
      ...authClient.getRequestHeaders(),
    },
  });
}
