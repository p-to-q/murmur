"use client";
import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useMurmurStore } from "@/lib/store/murmur-store";
import { generateVibeVersions } from "@/modules/strummer/generate-versions";
import { startAudioContext } from "@/lib/music/tone-player";
import { transcribeWithStainer } from "@/modules/stainer/transcribe";
import { useTranslator } from "@/lib/i18n";
import { memory } from "@eazo/sdk";
import { MurmurMark } from "@/components/murmur/murmur-mark";

const MAX_DURATION = 15;

export function HumScreen() {
  const {
    recordingState,
    setRecordingState,
    setVibeVersions,
    setProcessingMessage,
    processingMessage,
    resetFlow,
  } = useMurmurStore();
  const t = useTranslator();

  const [recordingTime, setRecordingTime] = useState(0);
  const [micFailed, setMicFailed] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const msgTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const msgIdxRef = useRef(0);

  const PROCESSING_MSGS = [
    t("hum.proc.listening"),
    t("hum.proc.polishing"),
    t("hum.proc.adding_drums"),
    t("hum.proc.three_vibes"),
  ];

  useEffect(() => {
    resetFlow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
    }
    if (timerRef.current) clearInterval(timerRef.current);
  }, []);

  useEffect(() => {
    if (recordingTime >= MAX_DURATION) stopRecording();
  }, [recordingTime, stopRecording]);

  const tickMessages = () => {
    msgIdxRef.current = 0;
    setProcessingMessage(PROCESSING_MSGS[0] ?? "");
    msgTimerRef.current = setInterval(() => {
      msgIdxRef.current = (msgIdxRef.current + 1) % PROCESSING_MSGS.length;
      setProcessingMessage(PROCESSING_MSGS[msgIdxRef.current] ?? "");
    }, 900);
  };
  const stopMessages = () => {
    if (msgTimerRef.current) clearInterval(msgTimerRef.current);
  };

  const transcribeAndGenerate = async (blob: Blob | undefined) => {
    setRecordingState("processing");
    tickMessages();
    try {
      const result = await transcribeWithStainer({ audioBlob: blob });
      const versions = generateVibeVersions(result.cleanMelody);
      setVibeVersions(versions);
      memory
        .reportAction({
          content: `Stainer ${result.provider} → ${result.cleanMelody.notes.length} notes → ${versions.length} versions`,
          event_type: "create",
          page: "hum",
          metadata: {
            type: "hum_transcribe",
            provider: result.provider,
            bpm: result.cleanMelody.bpm,
            key: result.cleanMelody.key,
            notes: result.cleanMelody.notes.length,
          },
        })
        .catch(() => {});
      setRecordingState("done");
    } catch (e) {
      console.error("[HumScreen] stainer failed:", e);
      setRecordingState("idle");
      setMicFailed(true);
    } finally {
      stopMessages();
    }
  };

  const startRecording = async () => {
    startAudioContext();
    setMicFailed(false);
    setRecordingTime(0);
    chunksRef.current = [];

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : "audio/mp4";

      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((tr) => tr.stop());
        const blob = new Blob(chunksRef.current, { type: mimeType });
        await transcribeAndGenerate(blob);
      };
      recorder.start(100);
      setRecordingState("recording");
      timerRef.current = setInterval(
        () => setRecordingTime((v) => v + 1),
        1000
      );
    } catch (err) {
      console.warn("[HumScreen] mic denied:", err);
      setMicFailed(true);
    }
  };

  const isIdle = recordingState === "idle";
  const isRecording = recordingState === "recording";
  const isProcessing = recordingState === "processing";

  return (
    <div className="murmur-grain min-h-svh flex flex-col items-center justify-center bg-[#F7F3EA] relative overflow-hidden px-6">
      {/* Top-right tagline (mobile only — sidebar holds the brand on desktop) */}
      <div
        className="absolute left-5 right-5 flex items-center justify-between md:hidden"
        style={{ top: "calc(env(safe-area-inset-top, 0px) + 16px)" }}
      >
        <MurmurMark />
        <span className="eyebrow opacity-60">{t("hum.eyebrow")}</span>
      </div>

      {/* Centered hero stack */}
      <div className="relative z-10 flex flex-col items-center w-full max-w-md">
        {/* Eyebrow (desktop) */}
        <motion.p
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="eyebrow hidden md:block mb-5"
        >
          {t("hum.eyebrow")}
        </motion.p>

        {/* Headline — giant serif italic, only when idle so it doesn't fight
            with recording timer / processing copy */}
        <AnimatePresence mode="wait">
          {isIdle && !micFailed && (
            <motion.h1
              key="hero"
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
              className="font-serif-italic text-[#22303A] text-center text-[44px] md:text-[64px] leading-[1.02] tracking-[-0.018em] mb-3"
              style={{ fontWeight: 500 }}
            >
              {t("hum.idle.headline")}
            </motion.h1>
          )}
        </AnimatePresence>

        {/* Subtitle (idle) */}
        <AnimatePresence>
          {isIdle && !micFailed && (
            <motion.p
              key="sub"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.5, delay: 0.18 }}
              className="text-[#8B8680] text-[15px] md:text-base text-center max-w-[320px] mb-10"
            >
              {t("hum.idle.sub")}
            </motion.p>
          )}
        </AnimatePresence>

        {/* Mic button — sticker-feel coral disc */}
        <div className="relative flex items-center justify-center w-32 h-32">
          {isIdle &&
            !micFailed &&
            [0, 1, 2].map((i) => (
              <motion.div
                key={i}
                className="absolute rounded-full bg-[#E9A06D]"
                style={{ width: 128, height: 128 }}
                initial={{ scale: 1, opacity: 0.18 }}
                animate={{ scale: 1.5 + i * 0.25, opacity: 0 }}
                transition={{
                  duration: 2.4,
                  repeat: Infinity,
                  delay: i * 0.65,
                  ease: "easeOut",
                }}
              />
            ))}
          {isRecording &&
            [0, 1].map((i) => (
              <motion.div
                key={i}
                className="absolute rounded-full border-2 border-[#E9A06D]"
                style={{ width: 128, height: 128 }}
                initial={{ scale: 1, opacity: 0.7 }}
                animate={{ scale: 1.6 + i * 0.3, opacity: 0 }}
                transition={{
                  duration: 1.0,
                  repeat: Infinity,
                  delay: i * 0.4,
                  ease: "easeOut",
                }}
              />
            ))}

          <motion.button
            whileTap={{ scale: 0.93 }}
            onClick={() => {
              startAudioContext();
              if (isIdle) startRecording();
              else stopRecording();
            }}
            disabled={isProcessing}
            className={[
              "relative z-10 w-32 h-32 rounded-full flex items-center justify-center transition-colors duration-300",
              isRecording ? "bg-[#d4855a]" : "bg-[#E9A06D]",
              isProcessing ? "opacity-60 cursor-not-allowed" : "",
            ].join(" ")}
            style={{
              border: "5px solid rgba(255,255,255,0.95)",
              boxShadow: isRecording
                ? "0 0 0 1px rgba(34,48,58,0.04), 0 10px 36px rgba(212,133,90,0.45)"
                : "0 0 0 1px rgba(34,48,58,0.04), 0 10px 30px rgba(233,160,109,0.35)",
            }}
            aria-label={isIdle ? t("hum.start") : t("hum.stop")}
          >
            <AnimatePresence mode="wait">
              {isIdle && (
                <motion.div
                  key="mic"
                  initial={{ scale: 0.7, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.7, opacity: 0 }}
                  transition={{ duration: 0.18 }}
                >
                  <svg width="34" height="34" viewBox="0 0 24 24" fill="none">
                    <rect
                      x="9"
                      y="2"
                      width="6"
                      height="12"
                      rx="3"
                      fill="white"
                      fillOpacity="0.95"
                    />
                    <path
                      d="M5 11A7 7 0 0 0 19 11"
                      stroke="white"
                      strokeWidth="2"
                      strokeLinecap="round"
                      fill="none"
                    />
                    <line
                      x1="12"
                      y1="18"
                      x2="12"
                      y2="22"
                      stroke="white"
                      strokeWidth="2"
                      strokeLinecap="round"
                    />
                    <line
                      x1="8"
                      y1="22"
                      x2="16"
                      y2="22"
                      stroke="white"
                      strokeWidth="2"
                      strokeLinecap="round"
                    />
                  </svg>
                </motion.div>
              )}
              {isRecording && (
                <motion.div
                  key="stop"
                  initial={{ scale: 0.5, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.5, opacity: 0 }}
                  className="w-12 h-12 rounded-2xl bg-white opacity-95"
                />
              )}
              {isProcessing && (
                <motion.div
                  key="spin"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="w-8 h-8 rounded-full border-[3px] border-white border-t-transparent animate-spin"
                />
              )}
            </AnimatePresence>
          </motion.button>
        </div>

        {/* Bottom hint area */}
        <div className="mt-8 min-h-[64px] flex flex-col items-center justify-start">
          <AnimatePresence mode="wait">
            {isIdle && !micFailed && (
              <motion.p
                key="hint"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ delay: 0.3 }}
                className="text-[#B8B0A2] text-[13px] tracking-[0.04em]"
              >
                {t("hum.idle.hint")}
              </motion.p>
            )}
            {isRecording && (
              <motion.div
                key="rec"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                className="text-center"
              >
                <p className="font-serif-italic text-[#22303A] text-[22px] mb-2">
                  {t("hum.recording")}
                </p>
                <div className="flex items-center justify-center gap-2 mb-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#E9A06D] animate-pulse" />
                  <span className="text-[#8B8680] text-xs tabular-nums tracking-wider">
                    {String(recordingTime).padStart(2, "0")} / {MAX_DURATION}s
                  </span>
                </div>
                <div className="mx-auto w-44 h-[2px] bg-[#E8E2D9] rounded-full overflow-hidden">
                  <motion.div
                    className="h-full bg-[#E9A06D] rounded-full"
                    animate={{ width: `${(recordingTime / MAX_DURATION) * 100}%` }}
                    transition={{ duration: 0.8 }}
                  />
                </div>
              </motion.div>
            )}
            {isProcessing && (
              <motion.div
                key="proc"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                className="text-center"
              >
                <AnimatePresence mode="wait">
                  <motion.p
                    key={processingMessage}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.25 }}
                    className="font-serif-italic text-[#22303A] text-[20px]"
                  >
                    {processingMessage}
                  </motion.p>
                </AnimatePresence>
                <p className="text-[#B8B0A2] text-xs tracking-[0.04em] mt-1.5">
                  {t("hum.proc.wait")}
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Mic-failed alternative */}
        <AnimatePresence>
          {isIdle && micFailed && (
            <motion.div
              key="mic-failed"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center gap-4 w-full text-center mt-6"
            >
              <div className="sticker-card rounded-2xl px-5 py-4 max-w-sm">
                <p className="text-[#22303A] text-sm font-medium mb-1">
                  {t("hum.mic.title")}
                </p>
                <p className="text-[#8B8680] text-xs leading-relaxed">
                  {t("hum.mic.detail")}
                </p>
              </div>

              <motion.button
                whileTap={{ scale: 0.95 }}
                onClick={() => {
                  startAudioContext();
                  transcribeAndGenerate(undefined);
                }}
                className="w-full max-w-sm h-12 rounded-2xl bg-[#E9A06D] text-white text-sm font-semibold"
                style={{ boxShadow: "0 6px 20px rgba(233,160,109,0.4)" }}
              >
                {t("hum.mic.cta_example")}
              </motion.button>

              <button
                onClick={() => {
                  startAudioContext();
                  startRecording();
                }}
                className="text-[#8B8680] text-xs underline underline-offset-4"
              >
                {t("hum.mic.cta_retry")}
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
