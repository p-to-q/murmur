import { describe, expect, it } from "bun:test";

import { resolveMobileRailSteps } from "./bottom-nav";

describe("resolveMobileRailSteps", () => {
  it("lets major destinations jump directly without showing stale middle steps", () => {
    expect(resolveMobileRailSteps(0).map((step) => step.href)).toEqual(["/", "/gallery"]);
    expect(resolveMobileRailSteps(4).map((step) => step.href)).toEqual(["/", "/gallery"]);
  });

  it("shows the creation path only while the user is inside the middle flow", () => {
    expect(resolveMobileRailSteps(1).map((step) => step.href)).toEqual(["/", "/vibe", "/gallery"]);
    expect(resolveMobileRailSteps(2).map((step) => step.href)).toEqual(["/", "/vibe", "/studio", "/gallery"]);
    expect(resolveMobileRailSteps(3).map((step) => step.href)).toEqual([
      "/",
      "/vibe",
      "/studio",
      "/studio/name",
      "/gallery",
    ]);
  });
});
