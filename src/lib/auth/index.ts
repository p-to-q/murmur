export {
  getRequestUser,
  getSessionToken,
  requireAuth,
  resolveRequestAuth,
  resolveUserId,
  SESSION_COOKIE_NAME,
} from "@/lib/platform/server-auth";
export type {
  AuthResult,
  RequestAuthSource,
  ResolvedRequestAuth,
  User,
} from "@/lib/platform/server-auth";
