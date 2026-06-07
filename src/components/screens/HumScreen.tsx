"use client";
import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence, useMotionValue, useSpring, useTransform, useMotionTemplate } from "framer-motion";
import { useMurmurStore } from "@/lib/store/murmur-store";
import { usePreferencesStore } from "@/lib/store/preferences-store";
import { generateVibeVersions } from "@/modules/strummer/generate-versions";
import { startAudioContext } from "@/lib/music/tone-player";
import { transcribeWithStainer } from "@/modules/stainer/transcribe";
import { selectGenerationMelody } from "@/modules/music/humming-engine";
import { useTranslator } from "@/lib/i18n";
import { memory } from "@/lib/platform/memory";
import { log } from "@/lib/observability/log";
import { trimRecordingForUpload } from "@/lib/audio/recording-trim";
import { inputLevelLabelKey, nextInputLevelDecision } from "@/lib/audio/input-level";
import {
  INITIAL_FIXTURE_RESCUE_STATE,
  type FixtureRescueState,
  noteFixtureRescueUsed,
  noteLiveFailure,
  noteLiveSuccess,
  parseFixtureRescueState,
  serializeFixtureRescueState,
  shouldAutoRescueWithFixture,
} from "@/lib/audio/fixture-rescue-policy";
import { humErrorLogLevel } from "@/lib/audio/hum-error-log-level";
import { shouldShowHumSupportCode } from "@/lib/audio/hum-support-visibility";
import {
  TranscribeRequestError,
  type TranscribeRequestErrorCode,
} from "@/lib/api/transcribe";
import { useUserBalance } from "@/lib/hooks/use-user-balance";
import { MurmurMark } from "@/components/murmur/murmur-mark";
import { formatHumSupportCode } from "@/lib/observability/support-code";

const MAX_DURATION = 15;
// Idle headline rotation interval (ms)
const IDLE_ROTATE_INTERVAL = 9000;
const FIXTURE_RESCUE_STORAGE_KEY = "murmur-fixture-rescue";
const ENABLE_HUM_ENTRANCE_MOTION = true;

// TODO: 以后改回访问次数限制（前5次）
// 原来的逻辑：
// const DEMO_VISIT_KEY = "murmur:hum-visits";
// const DEMO_VISIT_LIMIT = 5;
// 在 useEffect 中检查 localStorage.getItem(DEMO_VISIT_KEY) < DEMO_VISIT_LIMIT

/**
 * Surface variants the Hum screen knows how to render. The router below
 * maps every `TranscribeRequestErrorCode` to exactly one variant — keep
 * the relationship in sync with `docs/page-contracts.md` §1.
 */
type HumErrorVariant =
  | "mic"
  | "inaudible"
  | "too_short"
  | "insufficient"
  | "rate_limited"
  | "unavailable";

interface HumErrorState {
  variant: HumErrorVariant;
  code: TranscribeRequestErrorCode | "mic_unavailable";
  requestId: string | null;
  currentBalance: number | null;
  showSupportCode: boolean;
}

function variantForCode(code: TranscribeRequestErrorCode): HumErrorVariant {
  switch (code) {
    case "no_voiced_frames":
      return "inaudible";
    case "audio_required":
    case "audio_too_large":
    case "validation_error":
      return "too_short";
    case "insufficient_notes":
      return "insufficient";
    case "rate_limited":
      return "rate_limited";
    case "worker_unavailable":
    case "worker_unconfigured":
    case "billing_unavailable":
    case "server_error":
    case "network_error":
      return "unavailable";
  }
}

export function HumScreen() {
  // This screen is deliberately doing two jobs at once:
  // 1) technically capture audio robustly enough for transcription
  // 2) emotionally lower the activation barrier so a user feels safe
  //    starting with an imperfect hum rather than a "performance"
  const {
    recordingState,
    setRecordingState,
    setVibeVersions,
    setCurrentDraftId,
    setCurrentFlowId,
    setProcessingMessage,
    processingMessage,
    resetFlow,
  } = useMurmurStore();
  const repairBias = usePreferencesStore((state) => state.repairBias);
  const t = useTranslator();
  const router = useRouter();

  const [recordingTime, setRecordingTime] = useState(0);
  const [humError, setHumError] = useState<HumErrorState | null>(null);
  const [levelState, setLevelState] = useState<"idle" | "quiet" | "heard">("idle");
  const [showHeardMessage, setShowHeardMessage] = useState(false);
  const { refresh: refreshBalance } = useUserBalance();
  const [idleIndex, setIdleIndex] = useState(0);
  const [showDemo, setShowDemo] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const msgTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const idleTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const msgIdxRef = useRef(0);
  const heardTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Audio-reactive aurora — AnalyserNode drives amplitude (0-1)
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number>(0);
  const quietSinceRef = useRef<number | null>(null);
  const heardSignalRef = useRef(false);
  const recordingStartedAtRef = useRef<number | null>(null);
  const levelStateRef = useRef<"idle" | "quiet" | "heard">("idle");
  // Adaptive gain — tracks user's voice range and normalizes to 0-1
  const maxRmsRef = useRef(0.08); // start with a low baseline
  // Raw amplitude motion value → spring-smoothed for silky blob animation
  const amplitudeMv = useMotionValue(0);
  const amplitudeSpring = useSpring(amplitudeMv, { stiffness: 40, damping: 10 });
  // Derived: scale and opacity intensifiers for the three blobs
  const blob1Scale = useTransform(amplitudeSpring, [0, 1], [1, 1.35]);
  const blob2Scale = useTransform(amplitudeSpring, [0, 1], [1, 1.28]);
  const blob3Scale = useTransform(amplitudeSpring, [0, 1], [1, 1.22]);
  const blobOpacity = useTransform(amplitudeSpring, [0, 1], [1, 2.2]);
  // Orb conic glow — bigger range, brighter response
  const glowScale = useTransform(amplitudeSpring, [0, 0.3, 1], [1, 1.15, 1.7]);
  const glowOpacity = useTransform(amplitudeSpring, [0, 0.2, 1], [0.35, 0.55, 1.0]);
  const glowBlur = useTransform(amplitudeSpring, [0, 1], [44, 28]);
  const glowFilter = useMotionTemplate`blur(${glowBlur}px)`;

  const setInputLevelState = useCallback((next: "idle" | "quiet" | "heard") => {
    if (levelStateRef.current === next) return;
    levelStateRef.current = next;
    setLevelState(next);

    // When state becomes "heard", show message for 1 second then hide
    if (next === "heard") {
      setShowHeardMessage(true);
      if (heardTimeoutRef.current) {
        clearTimeout(heardTimeoutRef.current);
      }
      heardTimeoutRef.current = setTimeout(() => {
        setShowHeardMessage(false);
      }, 1000);
    }
  }, []);

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

    // TODO: 临时改成永远显示，以后改回前5次访问限制
    // 原来的逻辑在上面常量定义处有注释
    const timer = setTimeout(() => setShowDemo(true), 0);

    return () => {
      clearTimeout(timer);
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
    if (recordingState !== "idle" || humError) {
      if (idleTimerRef.current) clearInterval(idleTimerRef.current);
      return;
    }
    idleTimerRef.current = setInterval(() => {
      setIdleIndex((i) => (i + 1) % IDLE_HEADLINES.length);
    }, IDLE_ROTATE_INTERVAL);
    return () => {
      if (idleTimerRef.current) clearInterval(idleTimerRef.current);
    };
  }, [recordingState, humError, IDLE_HEADLINES.length]);

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
      const preparedBlob = blob ? await prepareAudioBlob(blob) : undefined;
      const result = await transcribeWithStainer({ audioBlob: preparedBlob });
      const draftId = crypto.randomUUID();
      const flowId = crypto.randomUUID();
      const selectedMelody = selectGenerationMelody(result, { repairBias });
      const versions = generateVibeVersions(selectedMelody.melody, {
        draftId,
        originFlowId: flowId,
        sourceType: blob ? "hum" : "demo",
        sourceMelodyKind: selectedMelody.kind,
      });
      setVibeVersions(versions);
      setCurrentDraftId(draftId);
      setCurrentFlowId(flowId);
      memory
        .reportAction({
          content: `Stainer ${result.provider} → ${selectedMelody.kind} ${selectedMelody.melody.notes.length} notes → ${versions.length} versions`,
          event_type: "create",
          page: "hum",
          metadata: {
            type: "hum_transcribe",
            provider: result.provider,
            selected_melody_kind: selectedMelody.kind,
            bpm: selectedMelody.melody.bpm,
            key: selectedMelody.melody.key,
            notes: selectedMelody.melody.notes.length,
          },
        })
        .catch(() => {});
      if (blob) {
        writeFixtureRescueState(noteLiveSuccess(readFixtureRescueState()));
      }
      // A live take debits the balance server-side; pull the fresh number
      // so the next idle render reflects reality. Demo runs (blob === undefined)
      // never touch the ledger, so we skip the refresh round-trip there.
      if (blob) void refreshBalance();
      setRecordingState("done");
      // Vibe is its own route in v2; hand the journey off so the iris-close
      // transition mounts on /vibe instead of bouncing through an overlay.
      router.push("/vibe");
    } catch (e) {
      const fixtureStateBefore = readFixtureRescueState();
      const rescueEligible =
        blob &&
        e instanceof TranscribeRequestError &&
        shouldAutoRescueWithFixture({
          state: fixtureStateBefore,
          code: e.code,
        });
      let fixtureStateAfterFailure = fixtureStateBefore;
      if (blob && e instanceof TranscribeRequestError) {
        fixtureStateAfterFailure = noteLiveFailure(
          fixtureStateBefore,
          e.code,
        );
        writeFixtureRescueState(fixtureStateAfterFailure);
      }
      const errorState = mapErrorToHumState(e, fixtureStateAfterFailure);
      const errorLogLevel =
        e instanceof TranscribeRequestError
          ? humErrorLogLevel(e.code)
          : "error";
      log("transcribe.failed", {
        error_code: errorState.code,
        variant: errorState.variant,
        request_id: errorState.requestId,
        current_balance: errorState.currentBalance,
        rescue_eligible: !!rescueEligible,
        message: e instanceof Error ? e.message : String(e),
      }, {
        level: errorLogLevel,
      });
      memory
        .reportAction({
          content: `Hum failed: ${errorState.code}`,
          event_type: "error",
          page: "hum",
          metadata: {
            type: "hum_error",
            code: errorState.code,
            variant: errorState.variant,
            request_id: errorState.requestId,
          },
        })
        .catch(() => {});
      // The server already committed (or refunded) before throwing; a fresh
      // balance keeps the idle pill from telling the user a lie.
      if (blob) void refreshBalance();
      if (rescueEligible) {
        writeFixtureRescueState(
          noteFixtureRescueUsed(readFixtureRescueState()),
        );
        memory
          .reportAction({
            content: `Hum rescued with fixture after transient ${errorState.code}`,
            event_type: "update",
            page: "hum",
            metadata: {
              type: "hum_fixture_rescue",
              code: errorState.code,
              request_id: errorState.requestId,
            },
          })
          .catch(() => {});
        await transcribeAndGenerate(undefined);
        return;
      }
      setRecordingState("idle");
      setCurrentDraftId(null);
      setCurrentFlowId(null);
      setHumError(errorState);
    } finally {
      stopMessages();
    }
  };

  const mapErrorToHumState = (
    error: unknown,
    fixtureState: FixtureRescueState,
  ): HumErrorState => {
    if (error instanceof TranscribeRequestError) {
      return {
        variant: variantForCode(error.code),
        code: error.code,
        requestId: error.requestId,
        currentBalance: error.currentBalance,
        showSupportCode: shouldShowHumSupportCode({
          code: error.code,
          state: fixtureState,
        }),
      };
    }
    return {
      variant: "inaudible",
      code: "server_error",
      requestId: null,
      currentBalance: null,
      showSupportCode: true,
    };
  };

  const prepareAudioBlob = async (blob: Blob): Promise<Blob> => {
    try {
      const result = await trimRecordingForUpload(blob);
      log("capture.prepared", {
        originalBytes: blob.size,
        uploadBytes: result.blob.size,
        originalDurationMs: result.originalDurationMs,
        trimmedDurationMs: result.trimmedDurationMs,
        trimmed: result.trimmed,
        uploadType: result.blob.type || "unknown",
      });
      return result.blob;
    } catch (error) {
      log("capture.failed", {
        error_code: "trim_failed",
        message: error instanceof Error ? error.message : String(error),
      }, {
        level: "warn",
      });
      return blob;
    }
  };

  const stopAudioAnalyser = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    analyserRef.current = null;
    quietSinceRef.current = null;
    heardSignalRef.current = false;
    recordingStartedAtRef.current = null;
    maxRmsRef.current = 0.08;
    setInputLevelState("idle");
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    amplitudeMv.set(0);
  }, [amplitudeMv, setInputLevelState]);

  const startRecording = async () => {
    startAudioContext();
    setHumError(null);
    setInputLevelState("idle");
    setRecordingTime(0);
    chunksRef.current = [];
    quietSinceRef.current = null;
    heardSignalRef.current = false;
    recordingStartedAtRef.current = null;

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

      const tick = (now: number) => {
        if (!analyserRef.current) return;
        recordingStartedAtRef.current ??= now;
        analyserRef.current.getByteTimeDomainData(dataArray);
        // RMS amplitude, scaled up so speaking/humming reaches ~0.8-1.0
        let sum = 0;
        for (const v of dataArray) sum += ((v - 128) / 128) ** 2;
        const rms = Math.sqrt(sum / dataArray.length);
        // Adaptive gain: track user's peak and normalize so even quiet
        // voices use the full 0→1 range of the glow animation
        if (rms > maxRmsRef.current) maxRmsRef.current = rms;
        // Slowly decay the peak so it adapts if the user gets quieter
        maxRmsRef.current *= 0.9995;
        maxRmsRef.current = Math.max(maxRmsRef.current, 0.04);
        const normalized = Math.min(rms / maxRmsRef.current, 1);
        amplitudeMv.set(normalized);
        updateInputLevel(rms);
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
      log("capture.failed", {
        error_code: "mic_unavailable",
        message: err instanceof Error ? err.message : String(err),
      }, {
        level: "warn",
      });
      setHumError({
        variant: "mic",
        code: "mic_unavailable",
        requestId: null,
        currentBalance: null,
        showSupportCode: false,
      });
    }
  };

  const updateInputLevel = useCallback((rms: number) => {
    const startedAt = recordingStartedAtRef.current;
    const elapsedMs = startedAt === null ? 0 : performance.now() - startedAt;
    const decision = nextInputLevelDecision({
      rms,
      elapsedMs,
      quietSinceMs: quietSinceRef.current,
      hasHeardSignal: heardSignalRef.current,
    });
    quietSinceRef.current = decision.quietSinceMs;
    heardSignalRef.current = decision.hasHeardSignal;
    setInputLevelState(decision.state);
  }, [setInputLevelState]);

  const isIdle = recordingState === "idle";
  const isRecording = recordingState === "recording";
  const isProcessing = recordingState === "processing";

  const errorCopy = humError ? copyForState(humError, t) : null;

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
        <div className="flex-1 flex flex-col md:flex-row items-center justify-center px-6 md:px-16 lg:px-24 gap-8 md:gap-12">
          {/* ── Left column: headline text ────────────────────── */}
          <div className="min-w-0 w-full md:w-[520px] md:flex-shrink-0 text-center md:text-left pt-[calc(env(safe-area-inset-top,0px)+60px)] md:pt-0">
            <AnimatePresence mode="wait">
              {isIdle && !humError && (
                <motion.h1
                  key={`idle-${idleIndex}`}
                  initial={ENABLE_HUM_ENTRANCE_MOTION ? { opacity: 0, y: 16 } : false}
                  animate={{ opacity: 1, y: 0 }}
                  exit={ENABLE_HUM_ENTRANCE_MOTION ? { opacity: 0, y: -12 } : undefined}
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
                  initial={ENABLE_HUM_ENTRANCE_MOTION ? { opacity: 0, y: 16 } : false}
                  animate={{ opacity: 1, y: 0 }}
                  exit={ENABLE_HUM_ENTRANCE_MOTION ? { opacity: 0, y: -12 } : undefined}
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
                  <AnimatePresence mode="wait">
                    {(levelState !== "idle" && levelState !== "heard") && (
                      <motion.p
                        key={levelState}
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.3 }}
                        className="mt-4 text-[11px] tracking-[0.14em] uppercase text-[#B6B0A4]"
                      >
                        {t(inputLevelLabelKey(levelState))}
                      </motion.p>
                    )}
                    {showHeardMessage && (
                      <motion.p
                        key="heard-message"
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.3 }}
                        className="mt-4 text-[11px] tracking-[0.14em] uppercase text-[#8C8780]"
                      >
                        {t("hum.level.heard")}
                      </motion.p>
                    )}
                  </AnimatePresence>
                </motion.div>
              )}

              {isProcessing && (
                <motion.div
                  key="processing-text"
                  initial={ENABLE_HUM_ENTRANCE_MOTION ? { opacity: 0, y: 16 } : false}
                  animate={{ opacity: 1, y: 0 }}
                  exit={ENABLE_HUM_ENTRANCE_MOTION ? { opacity: 0, y: -12 } : undefined}
                  transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                >
                  <AnimatePresence mode="wait">
                    <motion.h1
                      key={processingMessage}
                      initial={ENABLE_HUM_ENTRANCE_MOTION ? { opacity: 0, y: 8 } : false}
                      animate={{ opacity: 1, y: 0 }}
                      exit={ENABLE_HUM_ENTRANCE_MOTION ? { opacity: 0, y: -8 } : undefined}
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
          <div className="relative flex flex-col items-center justify-center flex-shrink-0">
            {/* Orb container — responsive sizing */}
            <div
              className="relative"
              style={{
                width: "min(60vw, 320px)",
                height: "min(60vw, 320px)",
              }}
            >
              {/* Rotating conic glow behind the orb */}
              <motion.div
                className="glow-spin absolute rounded-full"
                style={{
                  inset: "-18%",
                  background: isRecording
                    ? "conic-gradient(from 0deg, #FF8A5C, #FF5924, #FF69D2, #FFE040, #FF8A5C)"
                    : "conic-gradient(from 0deg, #FF8A5C88, #FF69D266, #A7B8C844, #FFE04066, #C9B6E444, #FF8A5C88)",
                  filter: glowFilter,
                  scale: glowScale,
                  opacity: glowOpacity,
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
                  if (isIdle && !humError) {
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
                  {isIdle && !humError && (
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

            {/* "Try demo" whisper below the orb — first 5 visits only */}
            <AnimatePresence>
              {isIdle && !humError && showDemo && (
                <motion.button
                  key="demo-whisper"
                  initial={ENABLE_HUM_ENTRANCE_MOTION ? { opacity: 0 } : false}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ delay: 0.6, duration: 0.5 }}
                  onClick={() => {
                    startAudioContext();
                    transcribeAndGenerate(undefined);
                  }}
                  className="mt-6 font-serif-italic text-[12px] text-[#B6B0A4] hover:text-[#8C8780] transition-colors"
                >
                  {t("hum.demo.cta")}
                </motion.button>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* ── Bottom bar: brand (mobile) + recording hint ────────── */}
        <div className="relative z-10 flex items-end justify-between px-6 md:px-16 lg:px-24 pb-6 md:pb-10"
          style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 24px)" }}
        >
          {/* Brand mark — mobile only */}
          <span className="inline-flex h-[48px] items-end pl-0.5 select-none md:hidden">
            <MurmurMark
              size={48}
              yOffset={2}
              className="h-[48px] items-end"
              imageClassName="drop-shadow-[0_10px_20px_rgba(26,26,26,0.07)]"
            />
          </span>

          {/* CTA area — bottom right */}
          <AnimatePresence mode="wait">
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

        {/* ── Capture / transcription fallback ────────────────── */}
        <AnimatePresence>
          {isIdle && humError && errorCopy && (
            <motion.div
              key={`${humError.variant}-${humError.code}`}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-20 flex items-center justify-center px-6"
            >
              <div className="mm-card px-6 py-8 max-w-sm w-full text-center">
                <p className="text-[#1A1A1A] text-[15px] font-medium mb-2">
                  {errorCopy.title}
                </p>
                <p className="text-[#8C8780] text-[13px] leading-relaxed mb-6">
                  {errorCopy.detail}
                </p>
                <button
                  onClick={() => {
                    startAudioContext();
                    setHumError(null);
                    transcribeAndGenerate(undefined);
                  }}
                  className="mm-btn-primary w-full justify-center mb-3"
                >
                  {t("hum.mic.cta_example")}
                </button>

                {/* 如果是 billing_unavailable，显示两个按钮 */}
                {humError.code === "billing_unavailable" ? (
                  <div className="flex items-center gap-4">
                    <button
                      onClick={() => {
                        startAudioContext();
                        setHumError(null);
                      }}
                      className="flex-1 text-[#8C8780] text-[13px] underline-mm"
                    >
                      {errorCopy.retry}
                    </button>
                    <button
                      onClick={() => {
                        startAudioContext();
                        setHumError(null);
                        // 使用示例旋律继续流程（跳过计费）
                        transcribeAndGenerate(undefined);
                      }}
                      className="flex-1 mm-btn-secondary justify-center text-[13px] py-2"
                    >
                      {errorCopy.demo || "测试使用"}
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => {
                      startAudioContext();
                      setHumError(null);
                      startRecording();
                    }}
                    className="text-[#8C8780] text-[13px] underline-mm"
                  >
                    {errorCopy.retry}
                  </button>
                )}
                {humError.requestId && humError.showSupportCode && (
                  <p className="mt-4 text-[10px] tracking-[0.18em] uppercase text-[#B6B0A4]">
                    code · {formatHumSupportCode({
                      code: humError.code,
                      requestId: humError.requestId,
                    })}
                  </p>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function readFixtureRescueState() {
  if (typeof window === "undefined") return INITIAL_FIXTURE_RESCUE_STATE;
  return parseFixtureRescueState(
    window.localStorage.getItem(FIXTURE_RESCUE_STORAGE_KEY),
  );
}

function writeFixtureRescueState(
  state: ReturnType<typeof readFixtureRescueState>,
) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    FIXTURE_RESCUE_STORAGE_KEY,
    serializeFixtureRescueState(state),
  );
}

function copyForState(
  error: HumErrorState,
  t: (key: Parameters<ReturnType<typeof useTranslator>>[0]) => string,
): { title: string; detail: string; retry: string; demo?: string } {
  if (error.code === "worker_unconfigured") {
    return {
      title: t("hum.err.worker_unconfigured.title"),
      detail: t("hum.err.worker_unconfigured.detail"),
      retry: t("hum.err.unavailable.cta_retry"),
    };
  }
  if (error.code === "billing_unavailable") {
    return {
      title: t("hum.err.billing_unavailable.title"),
      detail: t("hum.err.billing_unavailable.detail"),
      retry: t("hum.err.unavailable.cta_retry"),
      demo: t("hum.cta_demo") || "测试使用", // 添加测试使用按钮
    };
  }

  switch (error.variant) {
    case "mic":
      return {
        title: t("hum.mic.title"),
        detail: t("hum.mic.detail"),
        retry: t("hum.mic.cta_retry"),
      };
    case "inaudible":
      return {
        title: t("hum.hear.title"),
        detail: t("hum.hear.detail"),
        retry: t("hum.hear.cta_retry"),
      };
    case "too_short":
      return {
        title: t("hum.err.too_short.title"),
        detail: t("hum.err.too_short.detail"),
        retry: t("hum.err.too_short.cta_retry"),
      };
    case "insufficient":
      return {
        title: t("hum.err.insufficient.title"),
        detail: t("hum.err.insufficient.detail"),
        retry: t("hum.err.insufficient.cta_retry"),
      };
    case "rate_limited":
      return {
        title: t("hum.err.rate_limited.title"),
        detail: t("hum.err.rate_limited.detail"),
        retry: t("hum.err.rate_limited.cta_retry"),
      };
    case "unavailable":
      return {
        title: t("hum.err.unavailable.title"),
        detail: t("hum.err.unavailable.detail"),
        retry: t("hum.err.unavailable.cta_retry"),
      };
  }
}
