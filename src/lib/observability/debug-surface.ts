import { NextResponse } from "next/server";
import { getRequestHostname } from "@/lib/auth/local-preview";
import type { ResolvedRequestAuth } from "@/lib/platform/server-auth";

type OkAuth = Extract<ResolvedRequestAuth, { ok: true }>;

export function isDebugSurfaceEnabled(): boolean {
  if (process.env.NODE_ENV !== "production") return true;
  const flag = process.env.MURMUR_ENABLE_DEBUG_SURFACE?.trim().toLowerCase();
  return flag === "1" || flag === "true";
}

export function canAccessDebugSurface(
  auth: OkAuth,
  request: Request,
): boolean {
  if (auth.source !== "guest" && auth.user.id !== "guest") return true;
  return allowsGuestDebugInLocalPreview(request);
}

export function allowsGuestDebugInLocalPreview(request: Request): boolean {
  if (process.env.NODE_ENV === "production") return false;
  const host = getRequestHostname(request);
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}


export function debugSurfaceDisabledResponse(): NextResponse {
  return NextResponse.json(
    { error: "forbidden", message: "Debug surface disabled" },
    { status: 403 },
  );
}

export function debugSurfaceUnauthorizedResponse(): NextResponse {
  return NextResponse.json(
    { error: "unauthorized", message: "Authentication required" },
    { status: 401 },
  );
}

export function debugSurfaceForbiddenResponse(): NextResponse {
  return NextResponse.json(
    { error: "forbidden", message: "Debug surface requires a signed-in session" },
    { status: 403 },
  );
}

export async function requireDebugSurfaceAccess(
  request: Request,
  resolveRequestAuth: (request: Request) => Promise<ResolvedRequestAuth>,
): Promise<NextResponse | null> {
  if (!isDebugSurfaceEnabled()) {
    return debugSurfaceDisabledResponse();
  }

  const auth = await resolveRequestAuth(request);
  if (!auth.ok) {
    return debugSurfaceUnauthorizedResponse();
  }

  if (!canAccessDebugSurface(auth, request)) {
    return debugSurfaceForbiddenResponse();
  }

  return null;
}
