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
import { motion, AnimatePresence, useMotionValue, useSpring, useTransform, useMotionTemplate, animate as fmAnimate } from "framer-motion";
import { HumOnboardingOverlay } from "@/components/screens/hum-onboarding";
import { useMurmurStore } from "@/lib/store/murmur-store";
import { usePreferencesStore } from "@/lib/store/preferences-store";
import {
  createMagentaVersions,
  prefetchMusicEngineStatus,
  shouldUseMagentaEngine,
} from "@/modules/magenta/generate-magenta-versions";
import { startAudioContext } from "@/lib/music/tone-player";
import { transcribeWithStainer } from "@/modules/stainer/transcribe";
import { selectGenerationMelody } from "@/modules/music/humming-engine";
import { useI18nStore, useTranslator } from "@/lib/i18n";
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
import { useCurrentAccount } from "@/lib/hooks/use-current-account";
import { formatHumSupportCode } from "@/lib/observability/support-code";

const MAX_DURATION = 15;
const IDLE_ROTATE_INTERVAL = 9000;
const FIXTURE_RESCUE_STORAGE_KEY = "murmur-fixture-rescue";
const ONBOARDING_SEEN_STORAGE_KEY = "murmur:onboarding-seen";
const ENABLE_HUM_ENTRANCE_MOTION = true;

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
  | { kind: "topup"; label: string }
  | { kind: "dismiss"; label: string };

interface HumRecoveryPlan {
  primary: HumRecoveryAction;
  secondary: HumRecoveryAction | null;
}

interface HumErrorState {
  variant: HumErrorVariant;
  code: TranscribeRequestErrorCode | "mic_unavailable" | "music_engine_unavailable";
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

function stopMediaStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop());
}

function hasSeenOnboarding() {
  if (typeof window === "undefined") return false;
  try {
    return !!window.localStorage.getItem(ONBOARDING_SEEN_STORAGE_KEY);
  } catch {
    return false;
  }
}

function writeOnboardingSeen() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(ONBOARDING_SEEN_STORAGE_KEY, "1");
  } catch {}
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
    setHumStyleBlob,
    setCurrentDraftId,
    setCurrentFlowId,
    setProcessingMessage,
    processingMessage,
    resetFlow,
  } = useMurmurStore();
  const repairBias = usePreferencesStore((state) => state.repairBias);
  const t = useTranslator();
  const i18nHydrated = useI18nStore((state) => state.hydrated);
  const router = useRouter();

  const [recordingTime, setRecordingTime] = useState(0);
  const [humError, setHumError] = useState<HumErrorState | null>(null);
  const [levelState, setLevelState] = useState<"idle" | "quiet" | "heard">("idle");
  const [showHeardMessage, setShowHeardMessage] = useState(false);
  const { refresh: refreshBalance } = useUserBalance();
  const { account, isLoading: accountLoading } = useCurrentAccount();
  const [showEmailForm, setShowEmailForm] = useState(false);
  // During "loading" we do NOT gate, so a returning signed-in user is never
  // briefly walled by a stale guest counter on their device.
  const isGuest =
    !accountLoading &&
    (!account?.user?.id || account.user.id === "guest" || account.source === "guest");
  const [showLoginWall, setShowLoginWall] = useState(false);
  const [idleIndex, setIdleIndex] = useState(0);
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
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const msgTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const idleTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const msgIdxRef = useRef(0);
  const heardTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startPhaseRef = useRef<CapturePhase>("idle");
  const cancelPendingStartRef = useRef(false);

  // Audio-reactive aurora. The analyser drives amplitude only while capture
  // is active; the refs below are reset together by stopAudioAnalyser.
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
    unmountingRef.current = false;
    resetFlow();

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
      clearIntervalRef(timerRef);
      clearIntervalRef(msgTimerRef);
      clearIntervalRef(idleTimerRef);
      clearTimeoutRef(heardTimeoutRef);
      stopMediaStream(activeStreamRef.current);
      activeStreamRef.current = null;
      if (audioCtxRef.current) {
        audioCtxRef.current.close().catch(() => {});
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    prefetchMusicEngineStatus();
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      if (!hasSeenOnboarding()) {
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
    writeOnboardingSeen();
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
    const maxDim = Math.max(window.innerWidth, window.innerHeight) * 1.5;
    fmAnimate(revealRadius, maxDim, {
      duration: 1.12,
      ease: [0.22, 1, 0.36, 1],
      delay: 0.08,
    });
    setTimeout(() => {
      setShowOnboarding(false);
      setOnboardingRippling(false);
      markOnboardingSeen();
    }, 1220);
  }, [markOnboardingSeen, revealRadius]);

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

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
    }
    clearIntervalRef(timerRef);
  }, []);

  useEffect(() => {
    if (recordingTime >= MAX_DURATION) stopRecording();
  }, [recordingTime, stopRecording]);

  const tickMessages = () => {
    clearIntervalRef(msgTimerRef);
    msgIdxRef.current = 0;
    setProcessingMessage(PROCESSING_MSGS[0] ?? "");
    msgTimerRef.current = setInterval(() => {
      msgIdxRef.current = (msgIdxRef.current + 1) % PROCESSING_MSGS.length;
      setProcessingMessage(PROCESSING_MSGS[msgIdxRef.current] ?? "");
    }, 900);
  };
  const stopMessages = () => {
    clearIntervalRef(msgTimerRef);
  };

  // Action-time guest gate. Returns false (and raises the login wall) once a
  // guest has used up their free creations on this device; authed users and
  // guests under the limit pass through untouched.
  const passGuestGate = (): boolean => {
    if (!isGuest) return true;
    if (!hasLocalNotes(COST.hum)) {
      setShowLoginWall(true);
      return false;
    }
    return true;
  };

  const transcribeAndGenerate = async (blob: Blob | undefined) => {
    setRecordingState("processing");
    tickMessages();
    try {
      // Overlap Magenta routing with transcription. When the deployment is
      // configured for a worker we never silently downgrade to Tone.js.
      const magentaPathPromise = shouldUseMagentaEngine();
      const preparedBlob = blob ? await prepareAudioBlob(blob) : undefined;
      const result = await transcribeWithStainer({ audioBlob: preparedBlob });
      const draftId = crypto.randomUUID();
      const flowId = crypto.randomUUID();
      const selectedMelody = selectGenerationMelody(result, { repairBias });
      // Magenta is the only music engine. If the worker is unreachable after
      // all health-probe retries we stop with an honest error card — never
      // a silent downgrade to the legacy structured synth.
      const useMagenta = await magentaPathPromise;
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
    cancelPendingStartRef.current = false;
    startAudioContext();
    setHumError(null);
    setInputLevelState("idle");
    setRecordingTime(0);
    chunksRef.current = [];
    quietSinceRef.current = null;
    heardSignalRef.current = false;
    recordingStartedAtRef.current = null;

    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
        throw new Error("Browser recording APIs are unavailable");
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
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
        stopMediaStream(activeStreamRef.current);
        activeStreamRef.current = null;
        stopAudioAnalyser();
        mediaRecorderRef.current = null;
        const blob = new Blob(chunksRef.current, { type: recordingType });
        await transcribeAndGenerate(blob);
      };
      recorder.start(100);
      setRecordingState("recording");
      timerRef.current = setInterval(
        () => setRecordingTime((v) => v + 1),
        1000,
      );
    } catch (err) {
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
      setHumError({
        variant: "mic",
        code: "mic_unavailable",
        requestId: null,
        currentBalance: null,
        showSupportCode: false,
      });
    } finally {
      startPhaseRef.current = "idle";
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
  const recoveryPlan =
    humError && errorCopy ? recoveryForState(humError, errorCopy, isGuest, t) : null;

  const beginIdleCapture = () => {
    if (isIdle && !humError && startPhaseRef.current === "idle") {
      cancelPendingStartRef.current = false;
      if (!passGuestGate()) return;
      void startRecording();
    }
  };

  const handleOnboardingPress = () => {
    if (onboardingStep < 2) {
      setOnboardingStep((step) => step + 1);
      return;
    }
    triggerOnboardingReveal();
    beginIdleCapture();
  };

  const handleRecoveryAction = (action: HumRecoveryAction) => {
    switch (action.kind) {
      case "topup":
        router.push("/topup");
        return;
      case "demo":
        startAudioContext();
        setHumError(null);
        void transcribeAndGenerate(undefined);
        return;
      case "record":
        if (action.requiresGuestGate && !passGuestGate()) return;
        startAudioContext();
        setHumError(null);
        void startRecording();
        return;
      case "dismiss":
        setHumError(null);
        return;
    }
  };

  // Ring progress SVG values
  const ringRadius = 140;
  const ringCircumference = 2 * Math.PI * ringRadius;
  const ringOffset =
    ringCircumference - (recordingTime / MAX_DURATION) * ringCircumference;

  return (
    <div className="relative overflow-hidden bg-[#F5F1EB]" style={{ minHeight: 'var(--content-h)' }}>
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
                    <span className="text-[#8C8780] text-[13px] tabular-nums tracking-[0.12em] font-mono">
                      {String(recordingTime).padStart(2, "0")}s /{" "}
                      {MAX_DURATION}s
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
                          {t(inputLevelLabelKey(levelState))}
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
                    className="pointer-events-none absolute left-1/2 top-1/2 z-20 h-[108%] w-[108%] -translate-x-1/2 -translate-y-1/2 overflow-visible"
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
                disabled={isProcessing}
                // Keep the button, glow, and progress ring on one fixed
                // geometry; interaction feedback lives in light, not size.
                animate={{ scale: 1 }}
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
                  "bg-white cursor-pointer select-none",
                  isProcessing ? "opacity-80 cursor-wait" : "",
                ].join(" ")}
                style={{
                  boxShadow:
                    "0 4px 40px rgba(255,255,255,0.6), 0 0 0 1px rgba(255,255,255,0.8)",
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
                    >
                      <Spinner size="lg" variant="muted" />
                    </motion.div>
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
        step={onboardingStep}
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

function recoveryForState(
  error: HumErrorState,
  copy: HumErrorCopy,
  isGuest: boolean,
  t: Translator,
): HumRecoveryPlan {
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
