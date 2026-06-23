import { createHash } from "crypto";

import type { ApiRateLimitInput } from "@/lib/api/rate-limit";
import { UNKNOWN_CLIENT_IP } from "@/lib/http/client-ip";

const ROUTE = "/api/auth/local-creator";
const LOCAL_CREATOR_FINGERPRINT_LIMIT = {
  capacity: 1,
  refillWindowMs: 24 * 60 * 60 * 1000,
};
const LOCAL_CREATOR_IP_LIMIT = {
  capacity: 10,
  refillWindowMs: 24 * 60 * 60 * 1000,
};

interface LocalCreatorLimitScope {
  headers: Headers;
  ip: string;
  requestId: string;
}

export function localCreatorFingerprintLimitInput(
  scope: LocalCreatorLimitScope,
): ApiRateLimitInput {
  return {
    route: ROUTE,
    bucket: "fingerprint:daily",
    userId: localCreatorFingerprint(scope.headers, scope.ip),
    requestId: scope.requestId,
    sessionId: null,
    options: LOCAL_CREATOR_FINGERPRINT_LIMIT,
  };
}

export function localCreatorIpLimitInput(
  scope: Omit<LocalCreatorLimitScope, "headers">,
): ApiRateLimitInput | null {
  if (scope.ip === UNKNOWN_CLIENT_IP) return null;
  return {
    route: ROUTE,
    bucket: "ip:daily",
    userId: scope.ip,
    requestId: scope.requestId,
    sessionId: null,
    options: LOCAL_CREATOR_IP_LIMIT,
  };
}

function localCreatorFingerprint(headers: Headers, ip: string): string {
  const userAgentHeader = headers.get("user-agent");
  const userAgent = userAgentHeader ? userAgentHeader.trim().slice(0, 512) : "unknown";
  const uaHash = createHash("sha256").update(userAgent, "utf8").digest("hex").slice(0, 16);
  return `${ip}:ua:${uaHash}`;
}
