"use client";
/**
 * AudioUnlock — 全局音频解锁浮层
 *
 * 在 E2B iframe 里，浏览器要求 AudioContext 必须在
 * 用户手势的**同步调用栈**里被创建/恢复。
 *
 * 这个组件在首次渲染时就注册一个全局 click/touchstart 监听，
 * 只要用户点击页面上任何地方（包括推进首屏引导的那一次点击）
 * 就会解锁 AudioContext——在每个页面、对每个用户都立即布网，
 * 不需要单独的遮罩弹窗。解锁成功后自动移除监听。
 *
 * 而「点击任意位置以启用音频」的 toast 提示，则要等到 Hum
 * 首屏引导结束后、且 1.5s 内没有任何手势时才出现，
 * 以免在首屏引导遮罩里弹出。
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

function hasStoredAudioUnlock() {
  try {
    return sessionStorage.getItem(AUDIO_UNLOCK_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function storeAudioUnlock() {
  try {
    sessionStorage.setItem(AUDIO_UNLOCK_STORAGE_KEY, "1");
  } catch (e) {
    console.warn("[audio-unlock] failed to persist unlock state:", e);
  }
}

export function AudioUnlock() {
  const t = useTranslator();
  const [showHint, setShowHint] = useState(true);
  const [done, setDone] = useState(false);
  const [onboardingComplete, setOnboardingComplete] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    if (hasStoredAudioUnlock()) {
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

  // 解锁监听：在每个页面、对每个用户都立即布网，只受 done 限制。
  // 即使首屏 Hum 引导尚未结束也照常注册——推进引导的那次点击顺手
  // 解锁/预热音频，既无害又有益。
  useEffect(() => {
    if (typeof window === "undefined" || done) return;

    // 监听任意用户手势
    const unlock = () => {
      // startAudioContext 必须在这里直接调用——这是同步的手势回调
      startAudioContext();
      storeAudioUnlock();
      setDone(true);
      setShowHint(false);
      document.removeEventListener("click", unlock, true);
      document.removeEventListener("touchstart", unlock, true);
    };

    document.addEventListener("click", unlock, true);
    document.addEventListener("touchstart", unlock, true);

    return () => {
      document.removeEventListener("click", unlock, true);
      document.removeEventListener("touchstart", unlock, true);
    };
  }, [done]);

  if (done) return null;
  const shouldShowHint = showHint && onboardingComplete;

  return (
    <AnimatePresence>
      {shouldShowHint && (
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
