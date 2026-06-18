import { createProxyFetch } from "@/lib/auth/proxy-fetch";
import { customFetch } from "@auth/core";

export function isGitHubOAuthConfigured(): boolean {
  const id = process.env.GITHUB_CLIENT_ID?.trim();
  const secret = process.env.GITHUB_CLIENT_SECRET?.trim();
  return Boolean(id && secret);
}

export function gitHubOAuthProviderOptions() {
  const proxyFetch = createProxyFetch();

  return {
    clientId: process.env.GITHUB_CLIENT_ID!.trim(),
    clientSecret: process.env.GITHUB_CLIENT_SECRET!.trim(),
    ...(proxyFetch ? { [customFetch]: proxyFetch } : {}),
  };
}
