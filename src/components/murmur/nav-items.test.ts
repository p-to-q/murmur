import { describe, expect, it } from "bun:test";

import {
  computeTrail,
  ownsJourneyNav,
  resolveMobileJourneyStage,
} from "./nav-items";

describe("computeTrail", () => {
  it("keeps Me landing free of exposed child rows", () => {
    expect(computeTrail("/me")).toBeNull();
  });

  it("shows only the active Me subpage under Me", () => {
    const trail = computeTrail("/me/payments");

    expect(trail?.rootHref).toBe("/me");
    expect(trail?.steps.map((step) => step.step.match)).toEqual(["/me/payments"]);
    expect(trail?.steps.map((step) => step.isActive)).toEqual([true]);
  });

  it("keeps create flow steps additive", () => {
    const trail = computeTrail("/studio/name");

    expect(trail?.rootHref).toBe("/");
    expect(trail?.steps.map((step) => step.step.match)).toEqual([
      "/vibe",
      "/studio",
      "/studio/name",
    ]);
  });

  it("shows song detail as a Gallery child row", () => {
    const trail = computeTrail("/song/song_123");

    expect(trail?.rootHref).toBe("/gallery");
    expect(trail?.steps.map((step) => step.step.match)).toEqual(["/song"]);
    expect(trail?.steps.map((step) => step.isActive)).toEqual([true]);
  });
});

describe("resolveMobileJourneyStage", () => {
  it("maps the compact journey rail stages", () => {
    expect(resolveMobileJourneyStage("/")).toBe(0);
    expect(resolveMobileJourneyStage("/vibe")).toBe(1);
    expect(resolveMobileJourneyStage("/studio")).toBe(2);
    expect(resolveMobileJourneyStage("/studio/name")).toBe(3);
    expect(resolveMobileJourneyStage("/gallery")).toBe(4);
    expect(resolveMobileJourneyStage("/song/song_123")).toBe(4);
    expect(resolveMobileJourneyStage("/me")).toBe(-1);
  });
});

describe("ownsJourneyNav", () => {
  it("claims the create → gallery journey routes", () => {
    for (const route of [
      "/",
      "/vibe",
      "/studio",
      "/studio/name",
      "/gallery",
      "/song/song_123",
    ]) {
      expect(ownsJourneyNav(route)).toBe(true);
    }
  });

  it("releases top-up + checkout so the bottom rail hides there", () => {
    expect(ownsJourneyNav("/topup")).toBe(false);
    expect(ownsJourneyNav("/topup/checkout")).toBe(false);
  });

  it("releases the /me account hub and its sub-pages", () => {
    expect(ownsJourneyNav("/me")).toBe(false);
    expect(ownsJourneyNav("/me/settings")).toBe(false);
    expect(ownsJourneyNav("/me/payments")).toBe(false);
  });

  it("releases other non-journey surfaces and empty paths", () => {
    expect(ownsJourneyNav("/privacy")).toBe(false);
    expect(ownsJourneyNav("/auth/error")).toBe(false);
    expect(ownsJourneyNav("/s/share_abc")).toBe(false);
    expect(ownsJourneyNav("")).toBe(false);
    expect(ownsJourneyNav(null)).toBe(false);
    expect(ownsJourneyNav(undefined)).toBe(false);
  });
});
