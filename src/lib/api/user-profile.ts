import type { AppUser } from "@/lib/platform/types";
import { request } from "./request";

export async function fetchUserProfile(): Promise<AppUser | null> {
  try {
    const res = await request("/api/user/profile");
    if (!res.ok) return null;
    const json = (await res.json()) as { ok: boolean; user: AppUser };
    return json.ok ? json.user : null;
  } catch {
    return null;
  }
}
