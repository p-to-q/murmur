import { resolveApiUrl } from "./base-url";

const SHARE_INVITE_PATH = "/api/share/invite";

export function buildShareInviteUrl(origin: string): string {
  const base = origin.replace(/\/+$/, "");
  return `${base}/?ref=share`;
}

export function resolveShareInviteEndpoint(): string {
  return resolveApiUrl(SHARE_INVITE_PATH);
}

export async function getShareInviteUrl(origin: string): Promise<string> {
  try {
    const response = await fetch(resolveShareInviteEndpoint(), {
      headers: { accept: "application/json" },
    });
    if (!response.ok) throw new Error(`share invite ${response.status}`);

    const payload = (await response.json()) as { url?: unknown };
    if (typeof payload.url === "string" && payload.url.trim()) {
      return payload.url;
    }
  } catch {
    // Local/demo fallback. A production referral backend can replace the route
    // without changing the share entry UI.
  }

  return buildShareInviteUrl(origin);
}
