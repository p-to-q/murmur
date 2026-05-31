import type { AppUser, AuthResult } from "./types";

const DEFAULT_USER: AppUser = {
  id: "guest",
  email: null,
  name: "Local Creator",
  avatarUrl: null,
};

function readHeader(request: Request, key: string): string | null {
  return request.headers.get(key)?.trim() || null;
}

export function getRequestUser(request: Request): AppUser {
  return {
    id: readHeader(request, "x-murmur-user-id") ?? DEFAULT_USER.id,
    email: readHeader(request, "x-murmur-user-email"),
    name: readHeader(request, "x-murmur-user-name") ?? DEFAULT_USER.name,
    avatarUrl: readHeader(request, "x-murmur-user-avatar"),
  };
}

export function resolveUserId(request: Request): string {
  return getRequestUser(request).id;
}

export function requireAuth(request: Request): AuthResult {
  return { ok: true, user: getRequestUser(request) };
}

export type { AppUser as User, AuthResult };
