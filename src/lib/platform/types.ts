export type DevicePlatform = "web" | "ios" | "android" | "desktop" | "mini-program";

export interface AppUser {
  id: string;
  email?: string | null;
  name?: string | null;
  avatarUrl?: string | null;
  accountKind?: "local_creator" | "registered" | null;
}

export type AuthResult =
  | {
      ok: true;
      user: AppUser;
    }
  | {
      ok: false;
      response: Response;
    };

export interface MemoryActionParams {
  content: string;
  event_type?: string;
  page?: string;
  metadata?: Record<string, unknown>;
  session_id?: string;
  device_id?: string;
  app?: string;
  platform?: string;
  timestamp?: string;
}
