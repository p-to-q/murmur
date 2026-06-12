import { describe, expect, it } from "bun:test";

import { assertProductionAuthConfig } from "./assert-config";

describe("assertProductionAuthConfig", () => {
  it("throws when Google OAuth is configured without AUTH_SECRET in production", () => {
    const prevNode = process.env.NODE_ENV;
    const prevPhase = process.env.NEXT_PHASE;
    const prevId = process.env.GOOGLE_CLIENT_ID;
    const prevSecret = process.env.GOOGLE_CLIENT_SECRET;
    const prevAuth = process.env.AUTH_SECRET;

    process.env.NODE_ENV = "production";
    delete process.env.NEXT_PHASE;
    process.env.GOOGLE_CLIENT_ID = "test-id";
    process.env.GOOGLE_CLIENT_SECRET = "test-secret";
    delete process.env.AUTH_SECRET;
    delete process.env.NEXTAUTH_SECRET;

    try {
      expect(() => assertProductionAuthConfig()).toThrow(/AUTH_SECRET/);
    } finally {
      process.env.NODE_ENV = prevNode;
      if (prevPhase === undefined) delete process.env.NEXT_PHASE;
      else process.env.NEXT_PHASE = prevPhase;
      if (prevId === undefined) delete process.env.GOOGLE_CLIENT_ID;
      else process.env.GOOGLE_CLIENT_ID = prevId;
      if (prevSecret === undefined) delete process.env.GOOGLE_CLIENT_SECRET;
      else process.env.GOOGLE_CLIENT_SECRET = prevSecret;
      if (prevAuth === undefined) delete process.env.AUTH_SECRET;
      else process.env.AUTH_SECRET = prevAuth;
    }
  });
});
