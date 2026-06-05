import { describe, expect, it } from "bun:test";

import { getMelodyOriginCopy } from "./melody-origin";

const t = (key: string) => key;

describe("getMelodyOriginCopy", () => {
  it("returns intent-specific copy", () => {
    const copy = getMelodyOriginCopy("intent", t);
    expect(copy.label).toBe("melody_origin.intent.label");
    expect(copy.detailBody).toBe("melody_origin.intent.detail");
    expect(copy.studioBody).toBe("melody_origin.intent.studio");
    expect(copy.promptPlaceholder).toBe("melody_origin.intent.prompt");
  });

  it("defaults unknown or missing kind to corrected semantics", () => {
    const copy = getMelodyOriginCopy(undefined, t);
    expect(copy.label).toBe("melody_origin.corrected.label");
    expect(copy.detailBody).toBe("melody_origin.corrected.detail");
    expect(copy.studioBody).toBe("melody_origin.corrected.studio");
    expect(copy.promptPlaceholder).toBe("melody_origin.corrected.prompt");
  });
});
