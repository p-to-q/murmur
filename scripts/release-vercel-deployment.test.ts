import { describe, expect, test } from "bun:test";
import { assertVercelDeployment } from "./release-vercel-deployment";

const readyProduction = {
  id: "dpl_verified",
  url: "murmur-verified.vercel.app",
  target: "production",
  readyState: "READY",
};

describe("release Vercel deployment assertion", () => {
  test("accepts the expected ready production deployment", () => {
    expect(assertVercelDeployment(readyProduction, "dpl_verified")).toEqual({
      id: "dpl_verified",
      url: "murmur-verified.vercel.app",
    });
  });

  test("rejects a deployment that merely timed out while building", () => {
    expect(() =>
      assertVercelDeployment({ ...readyProduction, readyState: "BUILDING" }),
    ).toThrow("is not READY");
  });

  test("rejects preview targets and stale production aliases", () => {
    expect(() =>
      assertVercelDeployment({ ...readyProduction, target: null }),
    ).toThrow("unexpected target");
    expect(() => assertVercelDeployment(readyProduction, "dpl_old")).toThrow(
      "expected dpl_old",
    );
  });
});
