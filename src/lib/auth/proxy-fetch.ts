import { fetch as undiciFetch, ProxyAgent } from "undici";

function resolveProxyUrl(): string | undefined {
  return (
    process.env.HTTPS_PROXY?.trim() ||
    process.env.https_proxy?.trim() ||
    process.env.HTTP_PROXY?.trim() ||
    process.env.http_proxy?.trim()
  );
}

/** Routes Auth.js OAuth requests through HTTPS_PROXY when set (e.g. local Clash). */
export function createProxyFetch(): typeof fetch | undefined {
  const proxyUrl = resolveProxyUrl();
  if (!proxyUrl) return undefined;

  const dispatcher = new ProxyAgent(proxyUrl);

  const proxyFetch = (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ): ReturnType<typeof fetch> =>
    undiciFetch(input as Parameters<typeof undiciFetch>[0], {
      ...(init as Parameters<typeof undiciFetch>[1] | undefined),
      dispatcher,
    }) as unknown as Promise<Response>;

  return Object.assign(proxyFetch, {
    preconnect() {},
  });
}
