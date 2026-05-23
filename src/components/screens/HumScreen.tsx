"use client";
import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { motion, AnimatePresence, useMotionValue, useSpring, useTransform } from "framer-motion";
import { useMurmurStore } from "@/lib/store/murmur-store";
import { generateVibeVersions } from "@/modules/strummer/generate-versions";
import { startAudioContext } from "@/lib/music/tone-player";
import { transcribeWithStainer } from "@/modules/stainer/transcribe";
import { useTranslator } from "@/lib/i18n";
import { memory } from "@eazo/sdk";

const MAX_DURATION = 15;
// Idle headline rotation interval (ms)
const IDLE_ROTATE_INTERVAL = 5000;

export function HumScreen() {
  // This screen is deliberately doing two jobs at once:
  // 1) technically capture audio robustly enough for transcription
  // 2) emotionally lower the activation barrier so a user feels safe
  //    starting with an imperfect hum rather than a "performance"
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
  const [idleIndex, setIdleIndex] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const msgTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const idleTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const msgIdxRef = useRef(0);

  // Audio-reactive aurora — AnalyserNode drives amplitude (0-1)
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number>(0);
  // Raw amplitude motion value → spring-smoothed for silky blob animation
  const amplitudeMv = useMotionValue(0);
  const amplitudeSpring = useSpring(amplitudeMv, { stiffness: 30, damping: 12 });
  // Derived: scale and opacity intensifiers for the three blobs
  const blob1Scale = useTransform(amplitudeSpring, [0, 1], [1, 1.35]);
  const blob2Scale = useTransform(amplitudeSpring, [0, 1], [1, 1.28]);
  const blob3Scale = useTransform(amplitudeSpring, [0, 1], [1, 1.22]);
  const blobOpacity = useTransform(amplitudeSpring, [0, 1], [1, 2.2]);

  const IDLE_HEADLINES = useMemo(
    () => [
      t("hum.idle.h1"),
      t("hum.idle.h2"),
      t("hum.idle.h3"),
      t("hum.idle.h4"),
      t("hum.idle.h5"),
    ],
    [t],
  );

  const PROCESSING_MSGS = useMemo(
    () => [
      t("hum.proc.listening"),
      t("hum.proc.polishing"),
      t("hum.proc.adding_drums"),
      t("hum.proc.three_vibes"),
    ],
    [t],
  );

  useEffect(() => {
    resetFlow();
    return () => {
      // Clean up audio analyser RAF loop on unmount
      cancelAnimationFrame(rafRef.current);
      if (audioCtxRef.current) {
        audioCtxRef.current.close().catch(() => {});
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Rotate idle headlines
  useEffect(() => {
    if (recordingState !== "idle" || micFailed) {
      if (idleTimerRef.current) clearInterval(idleTimerRef.current);
      return;
    }
    idleTimerRef.current = setInterval(() => {
      setIdleIndex((i) => (i + 1) % IDLE_HEADLINES.length);
    }, IDLE_ROTATE_INTERVAL);
    return () => {
      if (idleTimerRef.current) clearInterval(idleTimerRef.current);
    };
  }, [recordingState, micFailed, IDLE_HEADLINES.length]);

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

  const stopAudioAnalyser = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    analyserRef.current = null;
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    amplitudeMv.set(0);
  }, [amplitudeMv]);

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

      // Set up audio analyser for aurora reactivity
      const audioCtx = new AudioContext();
      audioCtxRef.current = audioCtx;
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;
      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      const tick = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteTimeDomainData(dataArray);
        // RMS amplitude, scaled up so speaking/humming reaches ~0.8-1.0
        let sum = 0;
        for (const v of dataArray) sum += ((v - 128) / 128) ** 2;
        const rms = Math.sqrt(sum / dataArray.length);
        amplitudeMv.set(Math.min(rms * 5, 1));
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);

      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((tr) => tr.stop());
        stopAudioAnalyser();
        const blob = new Blob(chunksRef.current, { type: mimeType });
        await transcribeAndGenerate(blob);
      };
      recorder.start(100);
      setRecordingState("recording");
      timerRef.current = setInterval(
        () => setRecordingTime((v) => v + 1),
        1000,
      );
    } catch (err) {
      console.warn("[HumScreen] mic denied:", err);
      setMicFailed(true);
    }
  };

  const isIdle = recordingState === "idle";
  const isRecording = recordingState === "recording";
  const isProcessing = recordingState === "processing";

  // Ring progress SVG values
  const ringRadius = 140;
  const ringCircumference = 2 * Math.PI * ringRadius;
  const ringOffset =
    ringCircumference - (recordingTime / MAX_DURATION) * ringCircumference;

  return (
    <div className="relative min-h-svh overflow-hidden bg-[#F5F1EB]">
      {/* ─── Aurora background blobs — audio-reactive ───────────── */}
      {/* scale and opacity are driven by amplitudeSpring (0→1 RMS).
          CSS drift animations still run; framer-motion adds a reactivity
          layer on top via the `style` prop — seamless composition. */}
      <div className="absolute inset-0 overflow-hidden" aria-hidden>
        {/* Pink/magenta blob — left side */}
        <motion.div
          className="aurora-blob-1 absolute rounded-full"
          style={{
            width: "min(65vw, 600px)",
            height: "min(55vw, 500px)",
            left: "-5%",
            bottom: "10%",
            background:
              "radial-gradient(ellipse at center, rgba(255,105,210,0.38) 0%, rgba(255,80,180,0.12) 50%, transparent 75%)",
            filter: "blur(60px)",
            scale: blob1Scale,
            opacity: blobOpacity,
          }}
        />
        {/* Yellow/gold blob — right side */}
        <motion.div
          className="aurora-blob-2 absolute rounded-full"
          style={{
            width: "min(55vw, 520px)",
            height: "min(50vw, 460px)",
            right: "-8%",
            top: "8%",
            background:
              "radial-gradient(ellipse at center, rgba(255,224,64,0.35) 0%, rgba(255,200,40,0.10) 50%, transparent 75%)",
            filter: "blur(55px)",
            scale: blob2Scale,
            opacity: blobOpacity,
          }}
        />
        {/* Lavender/blue blob — top center */}
        <motion.div
          className="aurora-blob-3 absolute rounded-full"
          style={{
            width: "min(45vw, 420px)",
            height: "min(40vw, 380px)",
            left: "30%",
            top: "-5%",
            background:
              "radial-gradient(ellipse at center, rgba(170,190,255,0.22) 0%, rgba(200,180,240,0.08) 50%, transparent 75%)",
            filter: "blur(50px)",
            scale: blob3Scale,
            opacity: blobOpacity,
          }}
        />
        {/* Subtle green iridescence — bottom right */}
        <motion.div
          className="aurora-blob-1 absolute rounded-full"
          style={{
            width: "min(30vw, 300px)",
            height: "min(25vw, 250px)",
            right: "15%",
            bottom: "20%",
            background:
              "radial-gradient(ellipse at center, rgba(140,230,200,0.15) 0%, transparent 60%)",
            filter: "blur(45px)",
            animationDelay: "-8s",
            scale: blob2Scale,
            opacity: blobOpacity,
          }}
        />
      </div>

      {/* ─── Content layout ──────────────────────────────────────── */}
      <div className="relative z-10 min-h-svh flex flex-col">
        {/* ── Desktop: side-by-side layout / Mobile: stacked ──── */}
        <div className="flex-1 flex flex-col md:flex-row items-center justify-center px-6 md:px-16 lg:px-24 gap-6 md:gap-16 lg:gap-24">
          {/* ── Left column: headline text ────────────────────── */}
          <div className="flex-shrink-0 w-full md:w-auto md:max-w-[420px] lg:max-w-[480px] text-center md:text-left pt-[calc(env(safe-area-inset-top,0px)+60px)] md:pt-0">
            <AnimatePresence mode="wait">
              {isIdle && !micFailed && (
                <motion.h1
                  key={`idle-${idleIndex}`}
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -12 }}
                  transition={{
                    duration: 0.7,
                    ease: [0.22, 1, 0.36, 1],
                  }}
                  className="hero-serif text-[#1A1A1A] text-[36px] md:text-[52px] lg:text-[60px] whitespace-pre-line leading-[1.1]"
                >
                  {IDLE_HEADLINES[idleIndex]}
                </motion.h1>
              )}

              {isRecording && (
                <motion.div
                  key="recording-text"
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -12 }}
                  transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                >
                  <h1 className="hero-serif text-[#1A1A1A] text-[36px] md:text-[52px] lg:text-[60px] leading-[1.1]">
                    {t("hum.recording")}
                  </h1>
                  <div className="flex items-center justify-center md:justify-start gap-2 mt-4">
                    <span className="w-2 h-2 rounded-full bg-[#FF5924] animate-pulse" />
                    <span className="text-[#8C8780] text-[13px] tabular-nums tracking-[0.12em] font-mono">
                      {String(recordingTime).padStart(2, "0")}s /{" "}
                      {MAX_DURATION}s
                    </span>
                  </div>
                </motion.div>
              )}

              {isProcessing && (
                <motion.div
                  key="processing-text"
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -12 }}
                  transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                >
                  <AnimatePresence mode="wait">
                    <motion.h1
                      key={processingMessage}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8 }}
                      transition={{ duration: 0.3 }}
                      className="hero-serif text-[#1A1A1A] text-[28px] md:text-[42px] lg:text-[48px] leading-[1.15]"
                    >
                      {processingMessage}
                    </motion.h1>
                  </AnimatePresence>
                  <p className="text-[#B6B0A4] text-[12px] tracking-[0.2em] uppercase mt-4">
                    {t("hum.proc.wait")}
                  </p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* ── Right column: the orb ─────────────────────────── */}
          <div className="relative flex items-center justify-center flex-shrink-0">
            {/* Orb container — responsive sizing */}
            <div
              className="relative"
              style={{
                width: "min(60vw, 320px)",
                height: "min(60vw, 320px)",
              }}
            >
              {/* Rotating conic glow behind the orb */}
              <div
                className="glow-spin absolute rounded-full"
                style={{
                  inset: "-18%",
                  background: isRecording
                    ? "conic-gradient(from 0deg, #FF8A5C, #FF5924, #FF69D2, #FFE040, #FF8A5C)"
                    : "conic-gradient(from 0deg, #FF8A5C88, #FF69D266, #A7B8C844, #FFE04066, #C9B6E444, #FF8A5C88)",
                  filter: isRecording ? "blur(36px)" : "blur(44px)",
                  opacity: isRecording ? 0.8 : 0.45,
                  transition: "opacity 0.8s ease, filter 0.8s ease",
                }}
              />

              {/* Ring progress SVG (recording state) */}
              <AnimatePresence>
                {isRecording && (
                  <motion.svg
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.4 }}
                    className="absolute z-20 pointer-events-none"
                    style={{ inset: "-4%" }}
                    viewBox="0 0 300 300"
                  >
                    {/* Track */}
                    <circle
                      cx="150"
                      cy="150"
                      r={ringRadius}
                      fill="none"
                      stroke="rgba(255,255,255,0.25)"
                      strokeWidth="2.5"
                    />
                    {/* Progress */}
                    <circle
                      cx="150"
                      cy="150"
                      r={ringRadius}
                      fill="none"
                      stroke="#FF5924"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeDasharray={ringCircumference}
                      strokeDashoffset={ringOffset}
                      className="ring-progress"
                      style={{
                        transformOrigin: "center",
                        transform: "rotate(-90deg)",
                      }}
                    />
                  </motion.svg>
                )}
              </AnimatePresence>

              {/* White orb button */}
              <motion.button
                onPointerDown={() => {
                  if (isIdle && !micFailed) {
                    startAudioContext();
                    startRecording();
                  }
                }}
                onPointerUp={() => {
                  if (isRecording) stopRecording();
                }}
                onPointerLeave={() => {
                  if (isRecording) stopRecording();
                }}
                disabled={isProcessing}
                animate={{
                  scale: isRecording ? 0.92 : 1,
                }}
                whileHover={isIdle ? { scale: 1.03 } : undefined}
                transition={{
                  type: "spring",
                  stiffness: 200,
                  damping: 24,
                }}
                className={[
                  "relative z-10 w-full h-full rounded-full flex items-center justify-center",
                  "bg-white cursor-pointer select-none",
                  isProcessing ? "opacity-80 cursor-wait" : "",
                ].join(" ")}
                style={{
                  boxShadow:
                    "0 4px 40px rgba(255,255,255,0.6), 0 0 0 1px rgba(255,255,255,0.8)",
                }}
                aria-label={isIdle ? t("hum.start") : t("hum.stop")}
              >
                <AnimatePresence mode="wait">
                  {isIdle && !micFailed && (
                    <motion.svg
                      key="mic-icon"
                      width="40"
                      height="40"
                      viewBox="0 0 24 24"
                      fill="none"
                      initial={{ scale: 0.6, opacity: 0 }}
                      animate={{ scale: 1, opacity: 0.12 }}
                      exit={{ scale: 0.6, opacity: 0 }}
                      transition={{ duration: 0.25 }}
                    >
                      <rect
                        x="9"
                        y="2"
                        width="6"
                        height="12"
                        rx="3"
                        fill="#1A1A1A"
                      />
                      <path
                        d="M5 11A7 7 0 0 0 19 11"
                        stroke="#1A1A1A"
                        strokeWidth="2"
                        strokeLinecap="round"
                        fill="none"
                      />
                      <line
                        x1="12"
                        y1="18"
                        x2="12"
                        y2="22"
                        stroke="#1A1A1A"
                        strokeWidth="2"
                        strokeLinecap="round"
                      />
                    </motion.svg>
                  )}
                  {isRecording && (
                    <motion.div
                      key="recording-pulse"
                      initial={{ scale: 0.5, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0.5, opacity: 0 }}
                      className="w-5 h-5 rounded-full bg-[#FF5924]"
                    />
                  )}
                  {isProcessing && (
                    <motion.div
                      key="processing-spin"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="w-8 h-8 rounded-full border-[2.5px] border-[#B6B0A4] border-t-transparent animate-spin"
                    />
                  )}
                </AnimatePresence>
              </motion.button>

              {/* Particle burst when recording — subtle dots expanding outward */}
              <AnimatePresence>
                {isRecording &&
                  [0, 1, 2].map((i) => (
                    <motion.div
                      key={`particle-${i}`}
                      className="absolute left-1/2 top-1/2 w-1.5 h-1.5 rounded-full bg-white/60"
                      initial={{ x: "-50%", y: "-50%", scale: 0, opacity: 0.8 }}
                      animate={{
                        x: `calc(-50% + ${Math.cos((i * 2 * Math.PI) / 3) * 180}px)`,
                        y: `calc(-50% + ${Math.sin((i * 2 * Math.PI) / 3) * 180}px)`,
                        scale: [0, 1.2, 0],
                        opacity: [0.8, 0.4, 0],
                      }}
                      transition={{
                        duration: 2.5,
                        repeat: Infinity,
                        delay: i * 0.7,
                        ease: "easeOut",
                      }}
                    />
                  ))}
              </AnimatePresence>
            </div>
          </div>
        </div>

        {/* ── Bottom bar: brand + CTA ─────────────────────────── */}
        <div className="relative z-10 flex items-end justify-between px-6 md:px-16 lg:px-24 pb-6 md:pb-10"
          style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 24px)" }}
        >
          {/* Brand mark — bottom left */}
          <span className="text-[#8C8780] text-[11px] tracking-[0.2em] uppercase font-medium select-none">
            murmur
          </span>

          {/* CTA pill — bottom right */}
          <AnimatePresence mode="wait">
            {isIdle && !micFailed && (
              <motion.button
                key="cta"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                onClick={() => {
                  startAudioContext();
                  startRecording();
                }}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-[#FF5924] text-white text-[13px] font-medium tracking-[0.04em] hover:bg-[#D9421A] transition-colors duration-200"
                style={{
                  boxShadow: "0 4px 16px rgba(255,89,36,0.25)",
                }}
              >
                {t("hum.cta")}
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                >
                  <path d="M5 12h14M13 6l6 6-6 6" />
                </svg>
              </motion.button>
            )}
            {isRecording && (
              <motion.span
                key="release"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="text-[#8C8780] text-[12px] tracking-[0.15em] uppercase"
              >
                {t("hum.cta.release")}
              </motion.span>
            )}
          </AnimatePresence>
        </div>

        {/* ── Mic failed fallback ─────────────────────────────── */}
        <AnimatePresence>
          {isIdle && micFailed && (
            <motion.div
              key="mic-failed"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-20 flex items-center justify-center px-6"
            >
              <div className="mm-card px-6 py-8 max-w-sm w-full text-center">
                <p className="text-[#1A1A1A] text-[15px] font-medium mb-2">
                  {t("hum.mic.title")}
                </p>
                <p className="text-[#8C8780] text-[13px] leading-relaxed mb-6">
                  {t("hum.mic.detail")}
                </p>
                <button
                  onClick={() => {
                    startAudioContext();
                    transcribeAndGenerate(undefined);
                  }}
                  className="mm-btn-primary w-full justify-center mb-3"
                >
                  {t("hum.mic.cta_example")}
                </button>
                <button
                  onClick={() => {
                    startAudioContext();
                    setMicFailed(false);
                    startRecording();
                  }}
                  className="text-[#8C8780] text-[13px] underline-mm"
                >
                  {t("hum.mic.cta_retry")}
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
