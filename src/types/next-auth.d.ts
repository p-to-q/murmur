import "next-auth";
import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface User {
    id?: string;
    accountKind?: "local_creator" | "registered";
    authProvider?: string;
  }

  interface Session {
    user?: {
      id?: string;
      accountKind?: "local_creator" | "registered";
      authProvider?: string;
    } & DefaultSession["user"];
  }
}
