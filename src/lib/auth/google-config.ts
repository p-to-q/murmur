import { customFetch } from "@auth/core";

import { createProxyFetch } from "@/lib/auth/proxy-fetch";

/** True when Google OAuth env vars are present and the provider is registered. */
export function isGoogleOAuthConfigured(): boolean {
  const id = process.env.GOOGLE_CLIENT_ID?.trim();
  const secret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  return Boolean(id && secret);
}

/**
 * Google OAuth options with static endpoints so Auth.js skips OIDC discovery.
 * Discovery hits accounts.google.com on every sign-in; when that fetch fails
 * (common on restricted networks) Auth.js surfaces a generic Configuration error.
 */
export function googleOAuthProviderOptions() {
  const proxyFetch = createProxyFetch();

  return {
    clientId: process.env.GOOGLE_CLIENT_ID!.trim(),
    clientSecret: process.env.GOOGLE_CLIENT_SECRET!.trim(),
    authorization: {
      url: "https://accounts.google.com/o/oauth2/v2/auth",
      params: {
        prompt: "consent",
        access_type: "offline",
        response_type: "code",
      },
    },
    token: "https://oauth2.googleapis.com/token",
    userinfo: "https://openidconnect.googleapis.com/v1/userinfo",
    ...(proxyFetch ? { [customFetch]: proxyFetch } : {}),
  };
}
