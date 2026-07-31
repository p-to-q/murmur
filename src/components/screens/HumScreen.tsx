"use client";
import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { COST } from "@murmur/core";
import {
  hasLocalNotes,
  spendLocalNotes,
} from "@/lib/balance/balance-manager";
import { Spinner } from "@/components/ui/spinner";
import { AuthButtons } from "@/components/auth/auth-buttons";
import { EmailLoginForm } from "@/components/auth/email-login-form";
import { ensureLocalCreatorSession } from "@/lib/auth/local-creator-client";
import { motion, AnimatePresence, useMotionValue, useSpring, useTransform, useMotionTemplate } from "framer-motion";
import {
  HUM_ONBOARDING_REVEAL_DURATION_MS,
  HumOnboardingOverlay,
} from "@/components/screens/hum-onboarding";
import { useMurmurStore } from "@/lib/store/murmur-store";
import { resetStageTracking, trackStageEntered } from "@/lib/observability/stage-tracking";
import { usePreferencesStore } from "@/lib/store/preferences-store";
import {
  createMagentaVersions,
  getCachedMusicEngineStatus,
  prefetchMusicEngineStatus,
  shouldUseMagentaEngine,
} from "@/modules/magenta/generate-magenta-versions";
import { startAudioContext } from "@/lib/music/tone-player";
import { transcribeWithStainer } from "@/modules/stainer/transcribe";
import { selectGenerationMelody } from "@/modules/music/humming-engine";
import { useI18nStore, useTranslator } from "@/lib/i18n";
import { memory } from "@/lib/platform/memory";
import { log } from "@/lib/observability/log";
import {
  HUM_RECORDING_LIMIT_MS,
  HUM_RECORDING_LIMIT_SECONDS,
  clampRecordingElapsedMs,
  formatRecordingElapsedSeconds,
  recordingProgressFromElapsed,
} from "@/lib/audio/recording-progress";
import {
  shouldShowRecordingChrome,
  visibleRecordingProgress,
} from "@/lib/audio/recording-chrome";
import { trimRecordingForUpload } from "@/lib/audio/recording-trim";
import {
  clearRecordingBlob,
  loadRecordingBlob,
  saveRecordingBlob,
} from "@/lib/audio/recording-cache";
import { createRecordingOperationId } from "@/lib/audio/recording-operation";
import {
  isTranscriptionResumeRequested,
  TRANSCRIPTION_RESUME_PARAM,
  withTranscriptionResume,
} from "@/lib/audio/transcription-recovery";
import {
  nextInputLevelDecision,
  randomQuietInputLevelLabelKey,
  type InputLevelLabelKey,
} from "@/lib/audio/input-level";
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
import { shouldShowClientFallbackIndicator } from "@/lib/audio/client-fallback-indicator";
import { showInfoNotification } from "@/lib/platform/app-notifications";
import { shouldShowHumSupportCode } from "@/lib/audio/hum-support-visibility";
import {
  TranscribeRequestError,
  type TranscribeRequestErrorCode,
} from "@/lib/api/transcribe";
import { useUserBalance } from "@/lib/hooks/use-user-balance";
import { useCurrentAccount } from "@/lib/hooks/use-current-account";
import { formatHumSupportCode } from "@/lib/observability/support-code";
import {
  hasSeenHumOnboarding,
  writeHumOnboardingSeen,
} from "@/lib/onboarding";

const IDLE_ROTATE_INTERVAL = 9000;
const FIXTURE_RESCUE_STORAGE_KEY = "murmur-fixture-rescue";
const ENABLE_HUM_ENTRANCE_MOTION = true;
const MIC_PERMISSION_TIMEOUT_MS = 10_000;
const HUM_PROCESSING_TIMEOUT_MS = 75_000;

// Guest quota stays local and action-time gated. Signed-in users are
// server-authoritative and skip the local counter.

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

type LocalHumRecoveryCode = "transcription_resume";

type CapturePhase = "idle" | "starting";
type Translator = ReturnType<typeof useTranslator>;

type HumErrorCopy = {
  title: string;
  detail: string;
  retry: string;
  demo: string;
};

type HumRecoveryAction =
  | { kind: "demo"; label: string }
  | { kind: "record"; label: string; requiresGuestGate: boolean }
  | { kind: "retry_cached"; label: string }
  | { kind: "topup"; label: string }
  | { kind: "dismiss"; label: string };

// Transient service failures where resubmitting the *same* recording is worth
// offering — the take itself is fine, only the round-trip failed (issue #234).
// Deliberately excludes billing/auth/insufficient/inaudible codes, where a
// re-submit of the same audio would not help.
const CACHED_RETRY_CODES = new Set<HumErrorState["code"]>([
  "network_error",
  "server_error",
  "worker_unavailable",
  "rate_limited",
  "billing_unavailable",
]);

const CACHE_PRESERVING_CODES = new Set<HumErrorState["code"]>([
  ...CACHED_RETRY_CODES,
  "insufficient_notes",
]);

interface HumRecoveryPlan {
  primary: HumRecoveryAction;
  secondary: HumRecoveryAction | null;
}

interface HumErrorState {
  variant: HumErrorVariant;
  code:
    | TranscribeRequestErrorCode
    | "mic_unavailable"
    | "music_engine_unavailable"
    | LocalHumRecoveryCode;
  requestId: string | null;
  currentBalance: number | null;
  showSupportCode: boolean;
}

/**
 * The Magenta worker is the ONLY music engine — when its health probe fails
 * we stop the flow with an honest error instead of silently downgrading to
 * the legacy structured synth. Thrown by transcribeAndGenerate, mapped to the
 * "unavailable" card below.
 */
class MusicEngineUnavailableError extends Error {
  constructor() {
    super("music engine unavailable");
    this.name = "MusicEngineUnavailableError";
  }
}

class HumProcessingTimeoutError extends Error {
  constructor() {
    super("hum processing timed out");
    this.name = "HumProcessingTimeoutError";
  }
}

async function getUserMediaWithTimeout(
  constraints: MediaStreamConstraints,
  timeoutMs = MIC_PERMISSION_TIMEOUT_MS,
): Promise<MediaStream> {
  return await new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new DOMException("Microphone permission timed out", "TimeoutError"));
    }, timeoutMs);

    navigator.mediaDevices.getUserMedia(constraints).then(
      (stream) => {
        if (settled) {
          stopMediaStream(stream);
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolve(stream);
      },
      (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function withHumProcessingTimeout<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new HumProcessingTimeoutError());
    }, HUM_PROCESSING_TIMEOUT_MS);
  });

  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function clearIntervalRef(
  ref: { current: ReturnType<typeof setInterval> | null },
) {
  if (ref.current) {
    clearInterval(ref.current);
    ref.current = null;
  }
}

function clearTimeoutRef(
  ref: { current: ReturnType<typeof setTimeout> | null },
) {
  if (ref.current) {
    clearTimeout(ref.current);
    ref.current = null;
  }
}

function clearAnimationFrameRef(ref: { current: number | null }) {
  if (ref.current !== null) {
    cancelAnimationFrame(ref.current);
    ref.current = null;
  }
}

function stopMediaStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop());
}

function mediaRecorderOptions(): MediaRecorderOptions {
  if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) {
    return { mimeType: "audio/webm;codecs=opus" };
  }
  if (MediaRecorder.isTypeSupported("audio/webm")) {
    return { mimeType: "audio/webm" };
  }
  if (MediaRecorder.isTypeSupported("audio/mp4")) {
    return { mimeType: "audio/mp4" };
  }
  // Some browsers support MediaRecorder but return false for every explicit
  // type. Let the browser choose its native container instead of rejecting
  // an otherwise usable microphone path.
  return {};
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
    case "unauthorized":
    case "worker_unavailable":
    case "worker_unconfigured":
    case "billing_unavailable":
    case "server_error":
    case "network_error":
    // In-request refund failed, but a durable refund:pending marker was written
    // (#232) so reconcile restores the note — surface a retryable error card.
    case "refund_pending":
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
    setHumStyleBlob,
    setCurrentDraftId,
    setCurrentFlowId,
    currentFlowId,
    setProcessingMessage,
    processingMessage,
    resetFlow,
  } = useMurmurStore();
  const repairBias = usePreferencesStore((state) => state.repairBias);
  const t = useTranslator();
  const i18nHydrated = useI18nStore((state) => state.hydrated);
  const router = useRouter();
  const freshFlowIdRef = useRef<string | null>(null);
  const stageTrackedRef = useRef(false);

  const [recordingElapsedMs, setRecordingElapsedMs] = useState(0);
  const [humError, setHumError] = useState<HumErrorState | null>(null);
  // True when the last take is recoverable from IndexedDB after a transient
  // upload failure — gates the "retry last recording" affordance (issue #234).
  const [cachedRecordingAvailable, setCachedRecordingAvailable] = useState(false);
  const [levelState, setLevelState] = useState<"idle" | "quiet" | "heard">("idle");
  const [quietLevelLabelKey, setQuietLevelLabelKey] =
    useState<InputLevelLabelKey>("hum.level.quiet.1");
  const [showHeardMessage, setShowHeardMessage] = useState(false);
  const { refresh: refreshBalance } = useUserBalance();
  const { account, isLoading: accountLoading } = useCurrentAccount();
  const [showEmailForm, setShowEmailForm] = useState(false);
  const hasServerAccount =
    Boolean(account?.user?.id) &&
    account?.user?.id !== "guest" &&
    account?.source !== "guest";
  // During "loading" we do NOT gate, so a returning signed-in user is never
  // briefly walled by a stale guest counter on their device.
  const isGuest =
    !accountLoading &&
    !hasServerAccount;
  const [showLoginWall, setShowLoginWall] = useState(false);
  const [orbHovered, setOrbHovered] = useState(false);
  const [idleIndex, setIdleIndex] = useState(0);
  const [capturePhase, setCapturePhase] = useState<CapturePhase>("idle");
  // Onboarding: first visit gently focuses the already-visible stage.
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [onboardingRippling, setOnboardingRippling] = useState(false);
  const [onboardingStep, setOnboardingStep] = useState(0);
  const orbButtonRef = useRef<HTMLButtonElement>(null);
  const [orbCenter, setOrbCenter] = useState<{ x: number; y: number; size: number }>({
    x: 0,
    y: 0,
    size: 0,
  });
  const revealRadius = useMotionValue(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const unmountingRef = useRef(false);
  const activeStreamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const progressRafRef = useRef<number | null>(null);
  const recordingDeadlineRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const msgTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const idleTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const msgIdxRef = useRef(0);
  const heardTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startPhaseRef = useRef<CapturePhase>("idle");
  const cancelPendingStartRef = useRef(false);
  const clientFallbackIndicatorShownRef = useRef(false);

  // Audio-reactive aurora. The analyser drives amplitude only while capture
  // is active; the refs below are reset together by stopAudioAnalyser.
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number>(0);
  const quietSinceRef = useRef<number | null>(null);
  const heardSignalRef = useRef(false);
  const recordingStartedAtRef = useRef<number | null>(null);
  const inputLevelStartedAtRef = useRef<number | null>(null);
  const recordingElapsedMsRef = useRef(0);
  const stopReasonRef = useRef<"manual" | "limit" | null>(null);
  const levelStateRef = useRef<"idle" | "quiet" | "heard">("idle");
  // Adaptive gain — tracks user's voice range and normalizes to 0-1
  const maxRmsRef = useRef(0.08); // start with a low baseline
  // Raw amplitude motion value → spring-smoothed for silky blob animation
  const amplitudeMv = useMotionValue(0);
  const amplitudeSpring = useSpring(amplitudeMv, { stiffness: 40, damping: 10 });
  // Derived: scale and opacity intensifiers for the three blobs
  const blob1Scale = useTransform(amplitudeSpring, [0, 1], [1, 1.2]);
  const blob2Scale = useTransform(amplitudeSpring, [0, 1], [1, 1.16]);
  const blob3Scale = useTransform(amplitudeSpring, [0, 1], [1, 1.12]);
  const blobOpacity = useTransform(amplitudeSpring, [0, 1], [0.82, 1]);
  // Keep the voice response tactile without letting the glow outrun the orb.
  const glowScale = useTransform(amplitudeSpring, [0, 0.3, 1], [1, 1.08, 1.35]);
  const glowOpacity = useTransform(amplitudeSpring, [0, 0.2, 1], [0.35, 0.5, 0.82]);
  const glowBlur = useTransform(amplitudeSpring, [0, 1], [44, 34]);
  const glowFilter = useMotionTemplate`blur(${glowBlur}px)`;

  const setInputLevelState = useCallback((next: "idle" | "quiet" | "heard") => {
    if (levelStateRef.current === next) return;
    if (next === "quiet") {
      setQuietLevelLabelKey(randomQuietInputLevelLabelKey());
    }
    levelStateRef.current = next;
    setLevelState(next);

    if (next === "heard") {
      clearTimeoutRef(heardTimeoutRef);
      setShowHeardMessage(true);
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
    // A direct visit to `/` is an explicit request for a fresh Create surface.
    // Draft recovery still lives in the nav controls, where the user is asking
    // to resume the creation journey rather than load the public home route.
    if (stageTrackedRef.current) return;
    stageTrackedRef.current = true;
    const flowId = freshFlowIdRef.current ?? crypto.randomUUID();
    freshFlowIdRef.current = flowId;
    resetFlow();
    setCurrentFlowId(flowId);
    resetStageTracking(flowId);
    trackStageEntered(flowId, "hum");
  }, [resetFlow, setCurrentFlowId]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!isTranscriptionResumeRequested(params.get(TRANSCRIPTION_RESUME_PARAM))) {
      return;
    }
    let cancelled = false;
    void (async () => {
      const cached = await loadRecordingBlob();
      if (cancelled) return;
      if (!cached?.operationId) {
        removeTranscriptionResumeMarker();
        return;
      }
      setCachedRecordingAvailable(true);
      setHumError({
        variant: "unavailable",
        code: "transcription_resume",
        requestId: null,
        currentBalance: null,
        showSupportCode: false,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    unmountingRef.current = false;
    return () => {
      unmountingRef.current = true;
      if (mediaRecorderRef.current) {
        mediaRecorderRef.current.ondataavailable = null;
        mediaRecorderRef.current.onstop = null;
        if (mediaRecorderRef.current.state !== "inactive") {
          mediaRecorderRef.current.stop();
        }
        mediaRecorderRef.current = null;
      }
      cancelAnimationFrame(rafRef.current);
      clearAnimationFrameRef(progressRafRef);
      clearTimeoutRef(recordingDeadlineRef);
      clearIntervalRef(msgTimerRef);
      clearIntervalRef(idleTimerRef);
      clearTimeoutRef(heardTimeoutRef);
      stopMediaStream(activeStreamRef.current);
      activeStreamRef.current = null;
      if (audioCtxRef.current) {
        audioCtxRef.current.close().catch(() => {});
      }
    };
  }, []);

  useEffect(() => {
    prefetchMusicEngineStatus();
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      if (!hasSeenHumOnboarding()) {
        setShowOnboarding(true);
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  // Measure orb center for the reveal mask
  useEffect(() => {
    if (!showOnboarding) return;
    const measure = () => {
      const el = orbButtonRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      setOrbCenter({
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
        size: rect.width,
      });
      if (revealRadius.get() === 0) {
        revealRadius.set(rect.width / 2 + 16);
      }
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [showOnboarding, revealRadius]);

  const markOnboardingSeen = useCallback(() => {
    writeHumOnboardingSeen();
  }, []);

  const triggerOnboardingReveal = useCallback(() => {
    setOnboardingRippling(true);
    const el = orbButtonRef.current;
    if (el) {
      const rect = el.getBoundingClientRect();
      setOrbCenter({
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
        size: rect.width,
      });
    }
    setTimeout(() => {
      setShowOnboarding(false);
      setOnboardingRippling(false);
      markOnboardingSeen();
    }, HUM_ONBOARDING_REVEAL_DURATION_MS);
  }, [markOnboardingSeen]);

  // Rotate idle headlines only while the landing state is truly quiet.
  useEffect(() => {
    if (recordingState !== "idle" || humError) {
      clearIntervalRef(idleTimerRef);
      return;
    }
    idleTimerRef.current = setInterval(() => {
      setIdleIndex((i) => (i + 1) % IDLE_HEADLINES.length);
    }, IDLE_ROTATE_INTERVAL);
    return () => {
      clearIntervalRef(idleTimerRef);
    };
  }, [recordingState, humError, IDLE_HEADLINES.length]);

  const updateRecordingElapsed = useCallback((elapsedMs: number) => {
    const clamped = clampRecordingElapsedMs(elapsedMs);
    recordingElapsedMsRef.current = clamped;
    setRecordingElapsedMs(clamped);
    return clamped;
  }, []);

  const refreshRecordingElapsed = useCallback((now: number) => {
    const startedAt = recordingStartedAtRef.current;
    if (startedAt === null) return recordingElapsedMsRef.current;
    return updateRecordingElapsed(now - startedAt);
  }, [updateRecordingElapsed]);

  const stopRecording = useCallback((reason: "manual" | "limit" = "manual") => {
    stopReasonRef.current = reason;
    if (reason === "limit") {
      updateRecordingElapsed(HUM_RECORDING_LIMIT_MS);
    } else {
      refreshRecordingElapsed(performance.now());
    }
    clearAnimationFrameRef(progressRafRef);
    clearTimeoutRef(recordingDeadlineRef);
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
    }
  }, [refreshRecordingElapsed, updateRecordingElapsed]);

  const startRecordingProgress = useCallback(() => {
    stopReasonRef.current = null;

    const start = (startedAt: number) => {
      recordingStartedAtRef.current = startedAt;
      updateRecordingElapsed(0);

      clearTimeoutRef(recordingDeadlineRef);
      recordingDeadlineRef.current = setTimeout(
        () => stopRecording("limit"),
        HUM_RECORDING_LIMIT_MS,
      );

      const tick = (now: number) => {
        if (mediaRecorderRef.current?.state !== "recording") return;
        const elapsedMs = refreshRecordingElapsed(now);
        if (elapsedMs >= HUM_RECORDING_LIMIT_MS) {
          stopRecording("limit");
          return;
        }
        progressRafRef.current = requestAnimationFrame(tick);
      };

      progressRafRef.current = requestAnimationFrame(tick);
    };

    clearAnimationFrameRef(progressRafRef);
    clearTimeoutRef(recordingDeadlineRef);
    progressRafRef.current = requestAnimationFrame(start);
  }, [refreshRecordingElapsed, stopRecording, updateRecordingElapsed]);

  const tickMessages = () => {
    clearIntervalRef(msgTimerRef);
    msgIdxRef.current = 0;
    setProcessingMessage(PROCESSING_MSGS[0] ?? "");
    msgTimerRef.current = setInterval(() => {
      msgIdxRef.current = (msgIdxRef.current + 1) % PROCESSING_MSGS.length;
      setProcessingMessage(PROCESSING_MSGS[msgIdxRef.current] ?? "");
    }, 2500);
  };
  const stopMessages = () => {
    clearIntervalRef(msgTimerRef);
  };

  // Action-time guest gate. Returns false (and raises the login wall) once a
  // guest has used up their free creations on this device; authed users and
  // guests under the limit pass through untouched.
  const passGuestGate = async (): Promise<boolean> => {
    if (hasServerAccount) return true;
    const hasCreatorSession = await ensureLocalCreatorSession();
    if (hasCreatorSession) return true;
    if (!hasLocalNotes(COST.hum)) {
      setShowLoginWall(true);
      return false;
    }
    return true;
  };

  const transcribeAndGenerate = async (
    blob: Blob | undefined,
    restored?: { operationId: string; uploadReady: boolean },
  ) => {
    setRecordingState("processing");
    tickMessages();
    // Tracks whether *this* run left a recoverable copy in IndexedDB, so the
    // catch block only offers "retry last recording" when there is one.
    let persistedRecording = Boolean(blob && restored);
    let activeOperationId = restored?.operationId ?? null;
    try {
      // Fail fast while the engine is known-down (fresh negative health
      // verdict, ≤10s old): transcription spends a note server-side, and a
      // hum that can never become a song must not be charged for. The user
      // sees the same unavailable card they would get after the round-trip.
      const cachedEngineStatus = getCachedMusicEngineStatus();
      if (cachedEngineStatus && !cachedEngineStatus.available) {
        throw new MusicEngineUnavailableError();
      }
      // Overlap Magenta routing with transcription. When the deployment is
      // configured for a worker we never silently downgrade to Tone.js.
      const magentaPathPromise = shouldUseMagentaEngine();
      const preparedBlob = blob
        ? restored?.uploadReady
          ? blob
          : await withHumProcessingTimeout(prepareAudioBlob(blob))
        : undefined;
      // Persist the exact upload bytes right before they leave the device.
      // A retry can then reuse the operation id without changing its request
      // hash. Storage failures degrade to today's no-cache behavior.
      const operationId = blob
        ? activeOperationId ?? createRecordingOperationId()
        : undefined;
      activeOperationId = operationId ?? null;
      if (blob) {
        const saved = await saveRecordingBlob(preparedBlob!, operationId, {
          uploadReady: true,
        });
        persistedRecording = persistedRecording || saved;
      }
      const result = await withHumProcessingTimeout(
        transcribeWithStainer({
          audioBlob: preparedBlob,
          operationId,
          onProgress: (phase) => {
            if (phase === "billing_ok") {
              setProcessingMessage(t("hum.proc.billing_ok"));
            } else if (phase === "worker_started") {
              setProcessingMessage(t("hum.proc.analyzing"));
            } else if (phase === "interim_melody") {
              // The preview is progress-only. Generation waits for the final
              // humming-engine selection so billing and attribution stay aligned.
              setProcessingMessage(t("hum.proc.analyzing"));
            }
          },
        }),
      );
      const draftId = crypto.randomUUID();
      const flowId = currentFlowId ?? crypto.randomUUID();
      const selectedMelody = selectGenerationMelody(result, { repairBias });
      // Magenta is the only music engine. If the worker is unreachable after
      // all health-probe retries we stop with an honest error card — never
      // a silent downgrade to the legacy structured synth.
      const useMagenta = await withHumProcessingTimeout(magentaPathPromise);
      if (!useMagenta) {
        throw new MusicEngineUnavailableError();
      }
      setHumStyleBlob(preparedBlob ?? null);
      const versions = createMagentaVersions(selectedMelody.melody, {
        draftId,
        originFlowId: flowId,
        sourceType: blob ? "hum" : "demo",
        sourceMelodyKind: selectedMelody.kind,
        batchIndex: 0,
        humBlob: preparedBlob ?? null,
        // Client-side pitch fallback (worker unreachable) yields lower-fidelity
        // notes; tag the versions so VibeScreen can show a reduced-detail hint
        // (issue #211). Normal server transcription leaves this undefined.
        captureQuality: result.provider === "client_pyin" ? "reduced" : undefined,
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
        if (isGuest) spendLocalNotes(COST.hum);
      }
      // A live take debits guest quota locally; signed-in users spend server-side notes.
      if (blob) void refreshBalance();
      // Upload + generation committed — the local recovery copy is no longer
      // needed. Clearing is best-effort; a stale blob is harmless.
      if (blob) {
        void clearRecordingBlob();
        setCachedRecordingAvailable(false);
      }
      if (
        shouldShowClientFallbackIndicator({
          provider: result.provider,
          alreadyShown: clientFallbackIndicatorShownRef.current,
        })
      ) {
        clientFallbackIndicatorShownRef.current = true;
        showInfoNotification(t("hum.client_fallback.toast"));
        log("transcribe.client_fallback_shown", {
          provider: result.provider,
          indicator: "toast",
        }, {
          route: "/",
        });
      }
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
          : e instanceof MusicEngineUnavailableError
            ? "warn"
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
      // Offer to resubmit the same take only when it is actually recoverable
      // and the failure is the transient kind a re-submit can clear.
      setCachedRecordingAvailable(
        persistedRecording &&
          activeOperationId !== null &&
          CACHE_PRESERVING_CODES.has(errorState.code),
      );
    } finally {
      stopMessages();
    }
  };

  const mapErrorToHumState = (
    error: unknown,
    fixtureState: FixtureRescueState,
  ): HumErrorState => {
    if (error instanceof MusicEngineUnavailableError) {
      // Magenta is the only engine — a down worker is a service outage,
      // not a problem with the user's take.
      return {
        variant: "unavailable",
        code: "music_engine_unavailable",
        requestId: null,
        currentBalance: null,
        showSupportCode: false,
      };
    }
    if (error instanceof HumProcessingTimeoutError) {
      return {
        variant: "unavailable",
        code: "worker_unavailable",
        requestId: null,
        currentBalance: null,
        showSupportCode: false,
      };
    }
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
    inputLevelStartedAtRef.current = null;
    clearTimeoutRef(heardTimeoutRef);
    setShowHeardMessage(false);
    maxRmsRef.current = 0.08;
    setInputLevelState("idle");
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    amplitudeMv.set(0);
  }, [amplitudeMv, setInputLevelState]);

  const startRecording = async () => {
    if (startPhaseRef.current !== "idle" || recordingState !== "idle") {
      return;
    }
    startPhaseRef.current = "starting";
    setCapturePhase("starting");
    cancelPendingStartRef.current = false;
    startAudioContext();
    setHumError(null);
    setCachedRecordingAvailable(false);
    setInputLevelState("idle");
    updateRecordingElapsed(0);
    chunksRef.current = [];
    quietSinceRef.current = null;
    heardSignalRef.current = false;
    recordingStartedAtRef.current = null;
    inputLevelStartedAtRef.current = null;

    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
        throw new Error("Browser recording APIs are unavailable");
      }
      setRecordingState("processing");
      setProcessingMessage(t("hum.proc.mic"));
      const stream = await getUserMediaWithTimeout({ audio: true });
      activeStreamRef.current = stream;
      const recorderOptions = mediaRecorderOptions();

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
        inputLevelStartedAtRef.current ??= now;
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

      const recorder = new MediaRecorder(stream, recorderOptions);
      const recordingType =
        recorder.mimeType || recorderOptions.mimeType || "application/octet-stream";
      mediaRecorderRef.current = recorder;
      if (cancelPendingStartRef.current) {
        stopMediaStream(stream);
        activeStreamRef.current = null;
        mediaRecorderRef.current = null;
        stopAudioAnalyser();
        return;
      }
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        if (unmountingRef.current) {
          chunksRef.current = [];
          return;
        }
        clearAnimationFrameRef(progressRafRef);
        clearTimeoutRef(recordingDeadlineRef);
        stopMediaStream(activeStreamRef.current);
        activeStreamRef.current = null;
        stopAudioAnalyser();
        mediaRecorderRef.current = null;
        const blob = new Blob(chunksRef.current, { type: recordingType });
        log("capture.stopped", {
          durationMs: Math.round(recordingElapsedMsRef.current),
          stopReason: stopReasonRef.current ?? "unknown",
          chunks: chunksRef.current.length,
          bytes: blob.size,
          type: recordingType,
        });
        await transcribeAndGenerate(blob);
      };
      recorder.start(100);
      startRecordingProgress();
      setRecordingState("recording");
    } catch (err) {
      clearAnimationFrameRef(progressRafRef);
      clearTimeoutRef(recordingDeadlineRef);
      stopMediaStream(activeStreamRef.current);
      activeStreamRef.current = null;
      mediaRecorderRef.current = null;
      stopAudioAnalyser();
      log("capture.failed", {
        error_code: "mic_unavailable",
        message: err instanceof Error ? err.message : String(err),
      }, {
        level: "warn",
      });
      setRecordingState("idle");
      setHumError({
        variant: "mic",
        code: "mic_unavailable",
        requestId: null,
        currentBalance: null,
        showSupportCode: false,
      });
    } finally {
      startPhaseRef.current = "idle";
      setCapturePhase("idle");
    }
  };

  const updateInputLevel = useCallback((rms: number) => {
    const startedAt = inputLevelStartedAtRef.current;
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
  const isStartingCapture = capturePhase === "starting";
  const showRecordingChrome = shouldShowRecordingChrome({
    isRecording,
    isStartingCapture,
  });
  const onboardingLine = t(`hum.onboarding.line${onboardingStep + 1}`);
  const onboardingA11yLine = onboardingLine.replace(/\s+/g, " ");
  const orbAriaLabel =
    showOnboarding && !onboardingRippling
      ? onboardingStep < 2
        ? `${t("hum.onboarding.next")}: ${onboardingA11yLine}`
        : `${t("hum.start")}: ${onboardingA11yLine}`
      : isIdle
        ? t("hum.start")
        : t("hum.stop");

  const errorCopy = humError ? copyForState(humError, t) : null;
  const canRetryCachedRecording =
    cachedRecordingAvailable &&
    humError !== null &&
    (CACHED_RETRY_CODES.has(humError.code) ||
      humError.code === "transcription_resume");
  const recoveryPlan =
    humError && errorCopy
      ? recoveryForState(humError, errorCopy, isGuest, canRetryCachedRecording, t)
      : null;

  const beginIdleCapture = () => {
    if (
      isIdle &&
      !humError &&
      capturePhase === "idle" &&
      startPhaseRef.current === "idle"
    ) {
      cancelPendingStartRef.current = false;
      setCapturePhase("starting");
      updateRecordingElapsed(0);
      void (async () => {
        if (!(await passGuestGate())) {
          setCapturePhase("idle");
          return;
        }
        await startRecording();
      })();
    }
  };

  const handleOnboardingPress = () => {
    if (onboardingStep < 2) {
      setOnboardingStep((step) => step + 1);
      return;
    }
    triggerOnboardingReveal();
  };

  // Re-read the last take from IndexedDB and resubmit it — no re-hum needed.
  // If the cache is somehow empty (evicted, cleared), fall back to a fresh
  // recording gated on the guest quota, matching the plain retry path.
  const retryLastRecording = async () => {
    const cached = await loadRecordingBlob();
    if (!cached?.operationId) {
      setCachedRecordingAvailable(false);
      removeTranscriptionResumeMarker();
      startAudioContext();
      setHumError(null);
      if (!(await passGuestGate())) return;
      await startRecording();
      return;
    }
    startAudioContext();
    setHumError(null);
    setCachedRecordingAvailable(false);
    await transcribeAndGenerate(cached.blob, {
      operationId: cached.operationId,
      uploadReady: cached.uploadReady,
    });
  };

  const handleRecoveryAction = (action: HumRecoveryAction) => {
    switch (action.kind) {
      case "topup":
        router.push(
          cachedRecordingAvailable
            ? withTranscriptionResume("/topup")
            : "/topup",
        );
        return;
      case "retry_cached":
        void retryLastRecording();
        return;
      case "demo":
        startAudioContext();
        setHumError(null);
        void transcribeAndGenerate(undefined);
        return;
      case "record":
        startAudioContext();
        setHumError(null);
        void (async () => {
          if (action.requiresGuestGate && !(await passGuestGate())) return;
          await startRecording();
        })();
        return;
      case "dismiss":
        setHumError(null);
        return;
    }
  };

  // Ring progress SVG values
  const ringStrokeWidth = 3.5;
  const ringRadius = 140;
  const ringCircumference = 2 * Math.PI * ringRadius;
  const recordingProgress = recordingProgressFromElapsed(recordingElapsedMs);
  const recordingElapsedLabel = formatRecordingElapsedSeconds(recordingElapsedMs);
  // Keep a bright start cap visible while the microphone is opening and at
  // elapsed zero. The real 15-second clock still begins with MediaRecorder.
  const ringProgress = visibleRecordingProgress(recordingProgress, showRecordingChrome);
  const ringOffset =
    ringCircumference - ringProgress * ringCircumference;

  return (
    <div data-testid="hum-screen" className="relative overflow-hidden bg-[#F5F1EB]" style={{ minHeight: 'var(--content-h)' }}>
      {/* ─── Aurora background blobs — audio-reactive ───────────── */}
      {/* scale and opacity are driven by amplitudeSpring (0→1 RMS).
          CSS drift animations still run; framer-motion adds a reactivity
          layer on top via the `style` prop — seamless composition. */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
        {/* Pink/magenta blob — left side */}
        <motion.div
          className="aurora-blob-1 absolute rounded-full"
          style={{
            width: "min(65vw, 600px)",
            height: "min(55vw, 500px)",
            left: "max(24px, 5%)",
            bottom: "10%",
            background:
              "radial-gradient(ellipse at center, rgba(255,105,210,0.38) 0%, rgba(255,80,180,0.12) 50%, transparent 75%)",
            filter: "blur(60px)",
            scale: blob1Scale,
            opacity: blobOpacity,
          }}
        />
        {/* Soft peach blob — right side (whisper of warmth, never a yellow cast) */}
        <motion.div
          className="aurora-blob-2 absolute rounded-full"
          style={{
            width: "min(52vw, 480px)",
            height: "min(48vw, 440px)",
            right: "-8%",
            top: "10%",
            background:
              "radial-gradient(ellipse at center, rgba(255,196,178,0.16) 0%, rgba(255,178,158,0.05) 50%, transparent 75%)",
            filter: "blur(55px)",
            scale: blob2Scale,
            opacity: blobOpacity,
          }}
        />
        {/* Lavender/blue blob — top center (keeps the top airy and cool) */}
        <motion.div
          className="aurora-blob-3 absolute rounded-full"
          style={{
            width: "min(48vw, 440px)",
            height: "min(42vw, 400px)",
            left: "32%",
            top: "-5%",
            background:
              "radial-gradient(ellipse at center, rgba(178,196,255,0.28) 0%, rgba(200,180,240,0.10) 50%, transparent 75%)",
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
      <div className="relative z-10 flex flex-col" style={{ minHeight: 'var(--content-h)' }}>
        {/* ── Desktop: side-by-side layout / Mobile: stacked ──── */}
        <div className="flex-1 flex items-center justify-center px-6 md:px-12 lg:px-14 xl:px-24">
          <div className="hum-mirror-stage grid w-full max-w-md xl:max-w-none grid-cols-1 items-center justify-items-center gap-8">
            {/* The stage is one macro block, but the text and orb keep separate
                locked boxes. The outer max-width controls composition; the inner
                min-heights protect the orb from headline rotation and async copy. */}
            <div className="hum-mirror-copy min-w-0 w-full text-center pt-[calc(env(safe-area-inset-top,0px)+60px)] md:pt-0">
              <div className="flex flex-col justify-center min-h-[128px] md:min-h-[240px]">
              <AnimatePresence mode="wait">
              {isIdle && !humError && (
                <motion.h1
                  key={`idle-${idleIndex}`}
                  initial={ENABLE_HUM_ENTRANCE_MOTION ? { opacity: 0 } : false}
                  animate={{ opacity: 1 }}
                  exit={ENABLE_HUM_ENTRANCE_MOTION ? { opacity: 0 } : undefined}
                  transition={{
                    duration: 0.5,
                    ease: "easeInOut",
                  }}
                  className={[
                    "hero-serif text-[#1A1A1A] text-[37px] md:text-[49px] lg:text-[57px] xl:text-[56px] whitespace-pre-line leading-[1.1]",
                    idleIndex === 3 || idleIndex === 4 ? "break-keep" : "",
                  ].join(" ")}
                >
                  {IDLE_HEADLINES[idleIndex]}
                </motion.h1>
              )}

              {isRecording && (
                <motion.div
                  key="recording-text"
                  initial={ENABLE_HUM_ENTRANCE_MOTION ? { opacity: 0 } : false}
                  animate={{ opacity: 1 }}
                  exit={ENABLE_HUM_ENTRANCE_MOTION ? { opacity: 0 } : undefined}
                  transition={{ duration: 0.4 }}
                >
                  <h1 className="hero-serif text-[#1A1A1A] text-[37px] md:text-[49px] lg:text-[57px] xl:text-[56px] leading-[1.1]">
                    {t("hum.recording")}
                  </h1>
                  <div className="flex items-center justify-center xl:justify-start gap-2 mt-4">
                    <span className="w-2 h-2 rounded-full bg-[#FF5924] animate-pulse" />
                    <span className="text-[#8C8780] text-[13px] tabular-nums tracking-[0.12em]">
                      {recordingElapsedLabel}s /{" "}
                      {HUM_RECORDING_LIMIT_SECONDS}s
                    </span>
                  </div>
                  <div className="mt-3 min-h-[18px] text-center xl:text-left">
                    <AnimatePresence mode="wait">
                      {showHeardMessage ? (
                        <motion.p
                          key="heard-message"
                          initial={{ opacity: 0, y: 4 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -4 }}
                          transition={{ duration: 0.25 }}
                          className="text-[12px] font-medium leading-[18px] tracking-[0.1em] text-[#8C8780]"
                        >
                          {t("hum.level.heard")}
                        </motion.p>
                      ) : levelState === "quiet" ? (
                        <motion.p
                          key="quiet-message"
                          initial={{ opacity: 0, y: 4 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -4 }}
                          transition={{ duration: 0.25 }}
                          className="text-[12px] font-medium leading-[18px] tracking-[0.1em] text-[#B6B0A4]"
                        >
                          {t(quietLevelLabelKey)}
                        </motion.p>
                      ) : null}
                    </AnimatePresence>
                  </div>
                </motion.div>
              )}

              {isProcessing && (
                <motion.div
                  key="processing-text"
                  initial={ENABLE_HUM_ENTRANCE_MOTION ? { opacity: 0 } : false}
                  animate={{ opacity: 1 }}
                  exit={ENABLE_HUM_ENTRANCE_MOTION ? { opacity: 0 } : undefined}
                  transition={{ duration: 0.4 }}
                >
                  <AnimatePresence mode="wait">
                    <motion.h1
                      key={processingMessage}
                      initial={ENABLE_HUM_ENTRANCE_MOTION ? { opacity: 0 } : false}
                      animate={{ opacity: 1 }}
                      exit={ENABLE_HUM_ENTRANCE_MOTION ? { opacity: 0 } : undefined}
                      transition={{ duration: 0.3 }}
                      className="hero-serif text-[#1A1A1A] text-[30px] md:text-[42px] lg:text-[49px] xl:text-[48px] leading-[1.15]"
                    >
                      {processingMessage}
                    </motion.h1>
                  </AnimatePresence>
                </motion.div>
              )}
              </AnimatePresence>
              </div>
            </div>

            {/* ── Right column: the orb ─────────────────────────── */}
            <div className="hum-orb-column relative flex flex-col items-center justify-center">
            {/* Orb container — responsive sizing */}
            <div
              className="hum-orb-shell relative isolate shrink-0 overflow-visible"
            >
              {/* Rotating conic glow behind the orb */}
              <motion.div
                className="absolute rounded-full"
                style={{
                  inset: "-18%",
                  filter: glowFilter,
                  scale: glowScale,
                  opacity: glowOpacity,
                }}
              >
                <div
                  className="glow-spin h-full w-full rounded-full"
                  style={{
                    background: showRecordingChrome
                      ? "conic-gradient(from 0deg, #FF8A5C, #FF5924, #FF69D2, #FFE040, #FF8A5C)"
                      : "conic-gradient(from 0deg, #FF8A5C88, #FF69D266, #A7B8C844, #FFE04066, #C9B6E444, #FF8A5C88)",
                  }}
                />
              </motion.div>

              {/* Ring progress SVG (recording state) */}
              <AnimatePresence>
                {showRecordingChrome && (
                  <motion.svg
                    data-testid="hum-recording-progress"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.4 }}
                    className="pointer-events-none absolute left-1/2 top-1/2 z-30 h-[107.75%] w-[107.75%] -translate-x-1/2 -translate-y-1/2 overflow-visible"
                    viewBox="0 0 300 300"
                    preserveAspectRatio="xMidYMid meet"
                  >
                    {/* Track */}
                    <circle
                      cx="150"
                      cy="150"
                      r={ringRadius}
                      fill="none"
                      stroke="rgba(255,255,255,0.25)"
                      strokeWidth={ringStrokeWidth}
                    />
                    {/* Progress */}
                    <circle
                      cx="150"
                      cy="150"
                      r={ringRadius}
                      fill="none"
                      stroke="#FF5924"
                      strokeWidth={ringStrokeWidth}
                      strokeLinecap="round"
                      strokeDasharray={ringCircumference}
                      strokeDashoffset={ringOffset}
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
                ref={orbButtonRef}
                onClick={() => {
                  if (showOnboarding && !onboardingRippling) {
                    handleOnboardingPress();
                    return;
                  }
                  if (isRecording) {
                    stopRecording();
                    return;
                  }
                  beginIdleCapture();
                }}
                onKeyDown={(e) => {
                  if (e.repeat) return;
                  if (e.key === " " || e.key === "Enter") {
                    e.preventDefault();
                    if (showOnboarding && !onboardingRippling) {
                      handleOnboardingPress();
                      return;
                    }
                    if (isRecording) {
                      stopRecording();
                      return;
                    }
                    beginIdleCapture();
                  }
                }}
                onMouseEnter={() => setOrbHovered(true)}
                onMouseMove={() => setOrbHovered(true)}
                onMouseLeave={() => setOrbHovered(false)}
                onPointerEnter={() => setOrbHovered(true)}
                onPointerMove={() => setOrbHovered(true)}
                onPointerLeave={() => setOrbHovered(false)}
                onBlur={() => setOrbHovered(false)}
                disabled={isProcessing && !isStartingCapture}
                whileHover={
                  isIdle
                    ? {
                        boxShadow:
                          "0 6px 48px rgba(255,255,255,0.78), 0 0 0 1px rgba(255,255,255,0.92)",
                      }
                    : undefined
                }
                transition={{
                  type: "spring",
                  stiffness: 200,
                  damping: 24,
                }}
                className={[
                  "relative z-10 w-full h-full rounded-full flex items-center justify-center",
                  "bg-white cursor-pointer select-none transition-transform duration-200 ease-out",
                  isIdle ? "hover:scale-[1.03]" : "",
                  isProcessing && !isStartingCapture ? "opacity-80 cursor-wait" : "",
                ].join(" ")}
                style={{
                  boxShadow:
                    "0 4px 40px rgba(255,255,255,0.6), 0 0 0 1px rgba(255,255,255,0.8)",
                  transform: orbHovered && isIdle ? "scale(1.03)" : undefined,
                }}
                aria-label={orbAriaLabel}
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
                  {showRecordingChrome && (
                    <motion.div
                      key="recording-pulse"
                      initial={{ scale: 0.5, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0.5, opacity: 0 }}
                      className="w-5 h-5 rounded-full bg-[#FF5924]"
                    />
                  )}
                  {isProcessing && !isStartingCapture && (
                    <motion.div
                      key="processing-spin"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                    >
                      <Spinner size="lg" variant="muted" />
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.button>

              {/* Particle burst when recording — subtle dots expanding outward */}
              <AnimatePresence>
                {showRecordingChrome &&
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
        </div>


        {/* ── Capture / transcription fallback ────────────────── */}
        <AnimatePresence>
          {isIdle && humError && errorCopy && (
            <motion.div
              data-testid="hum-recovery"
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
                {recoveryPlan && (
                  <RecoveryActions
                    plan={recoveryPlan}
                    onAction={handleRecoveryAction}
                  />
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

        {/* ── Guest login wall — shown once free creations are used up ── */}
        <AnimatePresence>
          {showLoginWall && (
            <motion.div
              key="login-wall"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-30 flex items-center justify-center px-6 bg-[#F5F1EB]/70 backdrop-blur-sm"
            >
              <div className="mm-card px-6 py-8 max-w-sm w-full text-center">
                <p className="text-[#1A1A1A] text-[15px] font-medium mb-2">
                  {t("hum.login_wall.title")}
                </p>
                <p className="text-[#8C8780] text-[13px] leading-relaxed mb-6">
                  {t("hum.login_wall.detail")}
                </p>
                {showEmailForm ? (
                  <EmailLoginForm
                    className="mb-3 text-left"
                    onSuccess={() => {
                      setShowEmailForm(false);
                      setShowLoginWall(false);
                    }}
                  />
                ) : (
                  <AuthButtons
                    callbackUrl="/"
                    onEmailClick={() => setShowEmailForm(true)}
                    className="mb-3"
                  />
                )}
                <button
                  onClick={() => setShowLoginWall(false)}
                  className="text-[#8C8780] text-[13px] underline-mm"
                >
                  {t("hum.login_wall.dismiss")}
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

      </div>

      {/* Rendered outside the z-10 content container so z-[60] can
          cover the bottom nav (z-50) at the layout level. */}
      <HumOnboardingOverlay
        visible={i18nHydrated && showOnboarding}
        orbCenter={orbCenter}
        revealRadius={revealRadius}
        rippling={onboardingRippling}
        line={onboardingLine}
        onAdvance={handleOnboardingPress}
      />
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

function RecoveryActions({
  plan,
  onAction,
}: {
  plan: HumRecoveryPlan;
  onAction: (action: HumRecoveryAction) => void;
}) {
  return (
    <>
      <button
        onClick={() => {
          onAction(plan.primary);
        }}
        className="mm-btn-primary w-full justify-center mb-3"
      >
        {plan.primary.label}
      </button>
      {plan.secondary ? (
        <SecondaryRecoveryAction
          action={plan.secondary}
          onAction={onAction}
        />
      ) : null}
    </>
  );
}

function SecondaryRecoveryAction({
  action,
  onAction,
}: {
  action: HumRecoveryAction;
  onAction: (action: HumRecoveryAction) => void;
}) {
  return (
    <button
      onClick={() => {
        onAction(action);
      }}
      className="text-[#8C8780] text-[13px] underline-mm"
    >
      {action.label}
    </button>
  );
}

function copyForState(
  error: HumErrorState,
  t: Translator,
): HumErrorCopy {
  if (error.code === "transcription_resume") {
    return {
      title: t("hum.resume.title"),
      detail: t("hum.resume.detail"),
      retry: t("hum.resume.cta"),
      demo: t("hum.cta_demo"),
    };
  }
  if (error.code === "music_engine_unavailable") {
    return {
      title: t("hum.err.music_engine.title"),
      detail: t("hum.err.music_engine.detail"),
      retry: t("hum.err.music_engine.cta_retry"),
      demo: t("hum.cta_demo"),
    };
  }
  if (error.code === "worker_unconfigured") {
    return {
      title: t("hum.err.worker_unconfigured.title"),
      detail: t("hum.err.worker_unconfigured.detail"),
      retry: t("hum.err.unavailable.cta_retry"),
      demo: t("hum.cta_demo"),
    };
  }
  if (error.code === "billing_unavailable") {
    return {
      title: t("hum.err.billing_unavailable.title"),
      detail: t("hum.err.billing_unavailable.detail"),
      retry: t("hum.err.unavailable.cta_retry"),
      demo: t("hum.cta_demo"),
    };
  }
  if (error.code === "unauthorized") {
    return {
      title: t("hum.err.auth.title"),
      detail: t("hum.err.auth.detail"),
      retry: t("hum.err.auth.cta_retry"),
      demo: t("hum.cta_demo"),
    };
  }

  switch (error.variant) {
    case "mic":
      return {
        title: t("hum.mic.title"),
        detail: t("hum.mic.detail"),
        retry: t("hum.mic.cta_retry"),
        demo: t("hum.cta_demo"),
      };
    case "inaudible":
      return {
        title: t("hum.hear.title"),
        detail: t("hum.hear.detail"),
        retry: t("hum.hear.cta_retry"),
        demo: t("hum.cta_demo"),
      };
    case "too_short":
      return {
        title: t("hum.err.too_short.title"),
        detail: t("hum.err.too_short.detail"),
        retry: t("hum.err.too_short.cta_retry"),
        demo: t("hum.cta_demo"),
      };
    case "insufficient":
      return {
        title: t("hum.err.insufficient.title"),
        detail: t("hum.err.insufficient.detail"),
        retry: t("hum.err.insufficient.cta_retry"),
        demo: t("hum.cta_demo"),
      };
    case "rate_limited":
      return {
        title: t("hum.err.rate_limited.title"),
        detail: t("hum.err.rate_limited.detail"),
        retry: t("hum.err.rate_limited.cta_retry"),
        demo: t("hum.cta_demo"),
      };
    case "unavailable":
      return {
        title: t("hum.err.unavailable.title"),
        detail: t("hum.err.unavailable.detail"),
        retry: t("hum.err.unavailable.cta_retry"),
        demo: t("hum.cta_demo"),
      };
  }
}

function removeTranscriptionResumeMarker(): void {
  const url = new URL(window.location.href);
  if (!url.searchParams.has(TRANSCRIPTION_RESUME_PARAM)) return;
  url.searchParams.delete(TRANSCRIPTION_RESUME_PARAM);
  window.history.replaceState(
    window.history.state,
    "",
    `${url.pathname}${url.search}${url.hash}`,
  );
}

function recoveryForState(
  error: HumErrorState,
  copy: HumErrorCopy,
  isGuest: boolean,
  canRetryCached: boolean,
  t: Translator,
): HumRecoveryPlan {
  // A recoverable take after a transient upload failure: resubmit the same
  // recording as the primary action so the user never re-hums after a blip.
  // Gated (in the caller) to network/server/worker/rate-limited codes.
  if (canRetryCached) {
    return {
      primary: {
        kind: "retry_cached",
        label:
          error.code === "transcription_resume"
            ? copy.retry
            : t("hum.retry_recording"),
      },
      secondary: {
        kind: "demo",
        label: copy.demo,
      },
    };
  }

  if (error.variant === "insufficient" && !isGuest) {
    return {
      primary: {
        kind: "topup",
        label: t("hum.err.insufficient.cta_topup"),
      },
      secondary: {
        kind: "demo",
        label: copy.demo,
      },
    };
  }

  if (error.code === "billing_unavailable") {
    return {
      primary: {
        kind: "demo",
        label: copy.demo,
      },
      secondary: {
        kind: "dismiss",
        label: copy.retry,
      },
    };
  }

  if (error.code === "unauthorized") {
    return {
      primary: {
        kind: "record",
        label: copy.retry,
        requiresGuestGate: true,
      },
      secondary: {
        kind: "demo",
        label: copy.demo,
      },
    };
  }

  if (error.code === "music_engine_unavailable") {
    return {
      primary: {
        kind: "dismiss",
        label: copy.retry,
      },
      secondary: null,
    };
  }

  return {
    primary: {
      kind: "record",
      label: copy.retry,
      requiresGuestGate: true,
    },
    secondary: {
      kind: "demo",
      label: copy.demo,
    },
  };
}
