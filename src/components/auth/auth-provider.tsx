"use client";

import { SessionProvider } from "next-auth/react";
import { ReactNode } from "react";
import { OAuthSessionAdopter } from "./oauth-session-adopter";

export function AuthProvider({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <OAuthSessionAdopter />
      {children}
    </SessionProvider>
  );
}
