import { describe, expect, it } from "bun:test";
import { decideSaveRender } from "./name-save-render";

describe("decideSaveRender (#291)", () => {
  it("saves with audio when the render produced a master", () => {
    const decision = decideSaveRender({
      dataUrl: "data:audio/mpeg;base64,AAAA",
      mime: "audio/mpeg",
      durationSec: 10,
      sizeBytes: 4,
    });
    expect(decision).toEqual({
      action: "save",
      mp3DataUrl: "data:audio/mpeg;base64,AAAA",
      durationSec: 10,
    });
  });

  it("prompts an explicit retry/draft choice when the render produced nothing", () => {
    expect(decideSaveRender(null)).toEqual({ action: "prompt_render_failure" });
  });

  it("saves an incomplete draft (no audio) only once the user opts in", () => {
    expect(decideSaveRender(null, { allowWithoutAudio: true })).toEqual({ action: "save" });
  });
});
