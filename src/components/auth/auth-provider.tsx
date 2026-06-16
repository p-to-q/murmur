"use client";

import { SessionProvider } from "next-auth/react";
import { ReactNode } from "react";
import { LocalCreatorBootstrap } from "./local-creator-bootstrap";

export function AuthProvider({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <LocalCreatorBootstrap />
      {children}
    </SessionProvider>
  );
}
