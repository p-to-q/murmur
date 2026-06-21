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
    crypto.randomUUID = () => `demo-id-${nextId++}`;

    const demo = buildDemoFlowState();

    expect(demo.draftId).toBe("demo-fixture-draft");
    expect(demo.flowId).toBe("demo-fixture-flow");
    expect(demo.versions).toHaveLength(3);
    expect(demo.currentVersion.id).toBe(demo.versions[0]?.id);
    expect(demo.currentVersion.sourceType).toBe("demo");
    expect(demo.currentVersion.sourceMelodyKind).toBe("intent");
  });
});
