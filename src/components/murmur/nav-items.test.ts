import { describe, expect, it } from "bun:test";

import { computeTrail } from "./nav-items";

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
