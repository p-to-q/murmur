"use client";

import { SessionProvider } from "next-auth/react";
import { ReactNode } from "react";
import { LocalCreatorBootstrap } from "./local-creator-bootstrap";
import { OAuthSessionAdopter } from "./oauth-session-adopter";

export function AuthProvider({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <OAuthSessionAdopter />
      <LocalCreatorBootstrap />
      {children}
    </SessionProvider>
  );
}
