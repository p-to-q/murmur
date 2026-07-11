import { afterEach, describe, expect, it } from "bun:test";
import {
  formatAppVersion,
  formatReleaseIdentifier,
  getAppVersionParts,
} from "./app-version";
import { APP_BUILD } from "./release-metadata";

const ENV_KEYS = [
  "NEXT_PUBLIC_APP_VERSION",
  "NEXT_PUBLIC_APP_BUILD",
  "NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA",
] as const;

describe("app-version", () => {
  afterEach(() => {
    for (const key of ENV_KEYS) {
      delete process.env[key];
    }
  });

  it("formats the product-facing version string", () => {
    process.env.NEXT_PUBLIC_APP_VERSION = "0.6.0";
    process.env.NEXT_PUBLIC_APP_BUILD = "181";
    expect(formatAppVersion(false)).toBe("v0.6.0 · 181");
  });

  it("expands build and git sha in developer mode", () => {
    process.env.NEXT_PUBLIC_APP_VERSION = "0.6.0";
    process.env.NEXT_PUBLIC_APP_BUILD = "181";
    process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA = "fbdd34b1234567890";
    expect(formatAppVersion(true)).toBe("v0.6.0 · build 181 · fbdd34b");
  });

  it("falls back to the calibrated release defaults", () => {
    expect(getAppVersionParts()).toEqual({
      semver: "0.6.0",
      build: APP_BUILD,
      gitSha: "local",
    });
    expect(formatAppVersion(false)).toBe(`v0.6.0 · ${APP_BUILD}`);
  });

  it("formats the structured release identifier for logs", () => {
    process.env.NEXT_PUBLIC_APP_VERSION = "0.6.0";
    process.env.NEXT_PUBLIC_APP_BUILD = "181";
    process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA = "fbdd34b1234567890";
    expect(formatReleaseIdentifier()).toBe("0.6.0+build.181.fbdd34b");
  });
});
