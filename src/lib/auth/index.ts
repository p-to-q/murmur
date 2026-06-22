export {
  getRequestUser,
  getSessionToken,
  murmurSessionCookieOptions,
  requireAuth,
  resolveRequestAuth,
  resolveUserId,
  clearMurmurSessionCookieOptions,
  SESSION_COOKIE_NAME,
} from "@/lib/platform/server-auth";
export type {
  AuthResult,
  RequestAuthSource,
  ResolvedRequestAuth,
  User,
} from "@/lib/platform/server-auth";
