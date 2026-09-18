import { describe, expect, test } from "bun:test";
import { isSoftwareWebGLRenderer } from "./murmur-tide";

describe("MurmurTide renderer selection", () => {
  test("falls back for common software WebGL renderers", () => {
    expect(
      isSoftwareWebGLRenderer(
        "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)))",
      ),
    ).toBe(true);
    expect(isSoftwareWebGLRenderer("llvmpipe (LLVM 18.1.8, 256 bits)")).toBe(
      true,
    );
    expect(isSoftwareWebGLRenderer("Microsoft Basic Render Driver")).toBe(
      true,
    );
  });

  test("keeps hardware renderers on the WebGL path", () => {
    expect(isSoftwareWebGLRenderer("ANGLE Metal Renderer: Apple M4 Pro")).toBe(
      false,
    );
    expect(isSoftwareWebGLRenderer("NVIDIA GeForce RTX 4090/PCIe/SSE2")).toBe(
      false,
    );
  });
});
