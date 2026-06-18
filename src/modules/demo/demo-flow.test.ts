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

    expect(demo.preset.id).toBe("moonstairs");
    expect(demo.draftId).toBe("demo-moonstairs-demo-id-0");
    expect(demo.flowId).toBe("demo-flow-moonstairs-demo-id-0");
    expect(demo.versions).toHaveLength(3);
    expect(demo.currentVersion.id).toBe(demo.versions[0]?.id);
    expect(demo.currentVersion.sourceType).toBe("demo");
    expect(demo.currentVersion.sourceMelodyKind).toBe("corrected");
    expect(demo.currentVersion.tags).toContain("demo");
  });

  it("can pick a named or random preset without backend services", () => {
    let nextId = 0;
    crypto.randomUUID = () => `demo-id-${nextId++}`;

    const named = buildDemoFlowState({ demoId: "rainwindow" });
    expect(named.preset.id).toBe("rainwindow");
    expect(named.currentVersion.vibe).toBe("rain");

    Math.random = () => 0.42;
    const random = buildDemoFlowState({ random: true });
    expect(random.preset.id).toBe("sunhop");
    expect(random.currentVersion.vibe).toBe("party");
  });
});
