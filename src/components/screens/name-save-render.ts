import type { RenderedAudio } from "@/modules/export/render-mp3";

/**
 * Decide what a save should do given the render outcome (#291).
 *
 * A produced master saves normally. A failed render no longer saves silently:
 * it surfaces an explicit retry-render / save-as-draft choice, and only saves
 * without audio (a labeled incomplete draft) once the user has opted in.
 */
export type SaveRenderDecision =
  | { action: "save"; mp3DataUrl?: string; durationSec?: number }
  | { action: "prompt_render_failure" };

export function decideSaveRender(
  rendered: RenderedAudio | null,
  options: { allowWithoutAudio?: boolean } = {},
): SaveRenderDecision {
  if (rendered?.dataUrl) {
    return { action: "save", mp3DataUrl: rendered.dataUrl, durationSec: rendered.durationSec };
  }
  if (options.allowWithoutAudio) {
    // Explicit user choice: persist an incomplete draft (no audio artifact).
    return { action: "save" };
  }
  return { action: "prompt_render_failure" };
}
