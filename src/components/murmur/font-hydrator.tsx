"use client";

import { useEffect } from "react";

const CHINESE_FONT_FACES = [
  '300 1em "LXGW WenKai TC"',
  '400 1em "LXGW WenKai TC"',
];
const CHINESE_FONT_SAMPLE = "脑海里的旋律，让它出来。什么调都可以，跑调也很好听。起调藏歌我";
const FONT_FALLBACK_DELAY_MS = 1600;

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
    const fallbackTimer = window.setTimeout(markReady, FONT_FALLBACK_DELAY_MS);

    Promise.allSettled(CHINESE_FONT_FACES.map((face) => fonts.load(face, CHINESE_FONT_SAMPLE)))
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
