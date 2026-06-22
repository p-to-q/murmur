"use client";
/**
 * AudioUnlock — 全局音频解锁浮层
 *
 * 在 E2B iframe 里，浏览器要求 AudioContext 必须在
 * 用户手势的**同步调用栈**里被创建/恢复。
 *
 * On first-run Hum, onboarding owns clicks until it finishes. After that, this
 * component registers a global click/touchstart listener,
 * 只要用户点击页面上任何地方就会解锁 AudioContext，
 * 不需要单独的遮罩弹窗。解锁成功后自动移除监听。
 *
 * 如果 1.5s 内没有收到任何手势，就显示一个轻量的 toast 提示。
 */
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { startAudioContext } from "@/lib/music/tone-player";
import { useTranslator } from "@/lib/i18n";
import {
  HUM_ONBOARDING_COMPLETE_EVENT,
  hasSeenHumOnboarding,
} from "@/lib/onboarding";

const AUDIO_UNLOCK_STORAGE_KEY = "murmur_audio_ok";

export function AudioUnlock() {
  const t = useTranslator();
  const [showHint, setShowHint] = useState(false);
  const [done, setDone] = useState(false);
  const [onboardingComplete, setOnboardingComplete] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    if (sessionStorage.getItem(AUDIO_UNLOCK_STORAGE_KEY)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDone(true);
      return;
    }

    const refreshOnboardingComplete = () => {
      // If localStorage is unavailable, keep the audio hint usable rather than
      // hiding it forever behind a first-run storage check.
      try {
        setOnboardingComplete(hasSeenHumOnboarding());
      } catch {
        setOnboardingComplete(true);
      }
    };

    refreshOnboardingComplete();
    window.addEventListener(HUM_ONBOARDING_COMPLETE_EVENT, refreshOnboardingComplete);
    window.addEventListener("storage", refreshOnboardingComplete);

    return () => {
      window.removeEventListener(HUM_ONBOARDING_COMPLETE_EVENT, refreshOnboardingComplete);
      window.removeEventListener("storage", refreshOnboardingComplete);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || done || !onboardingComplete) return;

    // 延迟 1.5s 显示提示（只有在用户没有主动点击时）
    const hintTimer = setTimeout(() => {
      if (!sessionStorage.getItem(AUDIO_UNLOCK_STORAGE_KEY)) {
        setShowHint(true);
      }
    }, 1500);

    // 监听任意用户手势
    const unlock = () => {
      // startAudioContext 必须在这里直接调用——这是同步的手势回调
      startAudioContext();
      sessionStorage.setItem(AUDIO_UNLOCK_STORAGE_KEY, "1");
      setDone(true);
      setShowHint(false);
      clearTimeout(hintTimer);
      document.removeEventListener("click", unlock, true);
      document.removeEventListener("touchstart", unlock, true);
    };

    document.addEventListener("click", unlock, true);
    document.addEventListener("touchstart", unlock, true);

    return () => {
      clearTimeout(hintTimer);
      document.removeEventListener("click", unlock, true);
      document.removeEventListener("touchstart", unlock, true);
    };
  }, [done, onboardingComplete]);

  if (done) return null;

  return (
    <AnimatePresence>
      {showHint && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 20 }}
          transition={{ duration: 0.3 }}
          className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[100] pointer-events-none"
        >
          <div className="bg-[#22303A] text-white text-xs px-4 py-2.5 rounded-full shadow-lg whitespace-nowrap">
            {t("common.audio_unlock_hint") || "点击任意位置以启用音频播放"}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
