export interface LogoutSessionResult {
  revoked: boolean;
  disabledPushSubscriptions: number;
}

type RevokeSession = (token: string) => Promise<LogoutSessionResult>;

export async function revokeLogoutSession(
  token: string | null,
  revokeSession: RevokeSession,
): Promise<LogoutSessionResult> {
  if (!token) return { revoked: false, disabledPushSubscriptions: 0 };
  return revokeSession(token);
}
