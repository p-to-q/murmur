"use client";

import { useEffect } from "react";
import {
  BRAND_FONT_LOAD_TARGETS,
  FONT_READY_TIMEOUT_MS,
} from "@/lib/fonts/font-assets";

export function FontHydrator() {
  useEffect(() => {
    const html = document.documentElement;
    html.dataset.fonts = "loading";

    const fonts = document.fonts;
    if (!fonts) {
      html.dataset.fonts = "ready";
      return;
    }

    let cancelled = false;
    const markReady = () => {
      if (!cancelled) html.dataset.fonts = "ready";
    };
    const fallbackTimer = window.setTimeout(markReady, FONT_READY_TIMEOUT_MS);

    Promise.allSettled(
      BRAND_FONT_LOAD_TARGETS.map(({ face, sample }) => fonts.load(face, sample)),
    )
      .finally(() => {
        window.clearTimeout(fallbackTimer);
        markReady();
      });

    return () => {
      cancelled = true;
      window.clearTimeout(fallbackTimer);
    };
  }, []);

  return null;
}
