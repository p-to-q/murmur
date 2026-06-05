/**
 * Resolves the base URL Murmur's client code uses to reach the API.
 *
 * Three shells need different answers and the same client code must
 * serve all three without conditionals at the call site:
 *
 * - **Web shell (Next.js, browser):** relative paths. The API routes
 *   live on the same origin; `""` keeps every `fetch("/api/...")`
 *   working unchanged.
 * - **Web shell (Next.js SSR / Node runtime):** relative paths too —
 *   Next.js handles same-origin routing internally during render.
 * - **Capacitor (iOS / Android):** must point at the deployed remote
 *   Next.js host because static-export builds strip every API route
 *   from the bundle. Origin is `capacitor://localhost` (iOS) or
 *   `http://localhost` (Android); relative fetches hit a 404.
 * - **微信小程序 (Taro shell, eventually):** must point at a 备案
 *   domain on the WeChat allow-list. Resolved by the MP runtime via
 *   the same env variable.
 *
 * The single source of truth is `NEXT_PUBLIC_MURMUR_API_BASE_URL`. The
 * web build leaves it unset (relative). Native + MP builds set it at
 * build time. We also detect Capacitor at runtime to surface a hard
 * failure when the env is missing — silent 404s under Capacitor are
 * the bug class that ate the most engineering hours in the planning
 * agent's prior research (`docs/research-2026-06.md` §2).
 */

const RAW_BASE_URL_ENV = process.env.NEXT_PUBLIC_MURMUR_API_BASE_URL;

let warnedAboutCapacitor = false;

export function apiBaseUrl(): string {
  const normalized = normalizeBaseUrl(RAW_BASE_URL_ENV);
  if (normalized) return normalized;

  if (isLikelyCapacitor() && !warnedAboutCapacitor) {
    warnedAboutCapacitor = true;
    console.warn(
      "[murmur/api] Capacitor runtime detected but NEXT_PUBLIC_MURMUR_API_BASE_URL is unset; relative /api fetches will 404. Set the env at build time to the deployed Next.js host.",
    );
  }

  return "";
}

/**
 * Compose a final URL the client can hand to `fetch`. Absolute URLs
 * pass through untouched; relative paths get the resolved base
 * prepended without doubling slashes.
 */
export function resolveApiUrl(input: string): string {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(input)) return input;
  const base = apiBaseUrl();
  if (!base) return input;
  if (input.startsWith("/")) return `${base}${input}`;
  return `${base}/${input}`;
}

function normalizeBaseUrl(raw: string | undefined): string {
  if (!raw) return "";
  const trimmed = raw.trim();
  if (!trimmed) return "";
  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
}

function isLikelyCapacitor(): boolean {
  if (typeof globalThis === "undefined") return false;
  const candidate = globalThis as { Capacitor?: { isNativePlatform?: () => boolean } };
  return typeof candidate.Capacitor === "object" && candidate.Capacitor !== null;
}

/**
 * Internal — test-only hook for resetting the "we already warned"
 * latch so suites can assert the warning fires exactly once.
 */
export function __resetCapacitorWarningForTesting(): void {
  warnedAboutCapacitor = false;
}
