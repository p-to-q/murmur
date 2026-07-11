import { afterEach, describe, expect, it } from "bun:test";
import { buildDemoFlowState } from "./demo-flow";

const originalRandom = Math.random;
const originalUuid = crypto.randomUUID;

afterEach(() => {
  Math.random = originalRandom;
  crypto.randomUUID = originalUuid;
});

describe("buildDemoFlowState", () => {
  it("hydrates a deterministic demo flow shape when randomness is fixed", () => {
    Math.random = () => 0.1;
    let nextId = 0;
    crypto.randomUUID = () =>
      `00000000-0000-4000-8000-${String(nextId++).padStart(12, "0")}`;

    const demo = buildDemoFlowState();

    expect(demo.draftId).toStartWith("demo-");
    expect(demo.flowId).toStartWith("demo-flow-");
    expect(demo.versions).toHaveLength(3);
    expect(demo.currentVersion.id).toBe(demo.versions[0]?.id);
    expect(demo.currentVersion.sourceType).toBe("demo");
    expect(demo.currentVersion.sourceMelodyKind).toBe("intent");
  });
});
