"use client";

import { Suspense, useCallback, useMemo, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  Download,
  FileJson,
  Mic,
  Music2,
  Pause,
  Play,
  RefreshCcw,
  Square,
  Upload,
  Wand2,
} from "lucide-react";
import type {
  CleanMelody,
  MelodyNote,
  MelodySelectionKind,
  TranscriptionDiagnostics,
  TranscriptionResult,
} from "@/modules/shared/types";
import { usePreferencesStore } from "@/lib/store/preferences-store";

type PitchProviderId = "auto" | "swiftf0" | "pyin" | "yin" | "parselmouth";
type StageId = "raw" | MelodySelectionKind;
type RenderMode = "piano" | "voice";

type RawStage = {
  notes: MelodyNote[];
  summary: {
    noteCount: number;
    duration: number;
  };
};

type MelodyStage = {
  melody: CleanMelody;
  summary: Record<string, unknown>;
};

type MeloLabResponse = {
  testOnly: true;
  workerUrl: string;
  requestId: string;
  pitchProvider: PitchProviderId;
  requestedProvider: string;
  result: TranscriptionResult;
  stages: {
    raw: RawStage;
    intent: MelodyStage;
    corrected: MelodyStage;
    musical: MelodyStage;
  };
};

type LoadingProviderRun = {
  provider: PitchProviderId;
  status: "loading";
};

type ReadyProviderRun = {
  provider: PitchProviderId;
  status: "ready";
  response: MeloLabResponse;
  elapsedMs: number;
};

type ErrorProviderRun = {
  provider: PitchProviderId;
  status: "error";
  error: string;
  elapsedMs: number;
};

type ProviderRun = LoadingProviderRun | ReadyProviderRun | ErrorProviderRun;

type MusicOutput = {
  url: string;
  provider: PitchProviderId;
  stage: StageId;
  prompt: string;
  styleMix: number;
  model: string | null;
  generationMs: string | null;
  melodyConditioned: string | null;
  cfgNotes: string | null;
};

const PROVIDERS: Array<{
  id: PitchProviderId;
  title: string;
  subtitle: string;
  group: "murmur" | "external";
  kind: "route" | "detector";
}> = [
  {
    id: "auto",
    title: "Auto ensemble",
    subtitle: "Murmur worker selection",
    group: "murmur",
    kind: "route",
  },
  {
    id: "swiftf0",
    title: "SwiftF0",
    subtitle: "Murmur fast local F0",
    group: "murmur",
    kind: "detector",
  },
  {
    id: "pyin",
    title: "pYIN",
    subtitle: "Murmur fallback baseline",
    group: "murmur",
    kind: "detector",
  },
  {
    id: "yin",
    title: "YIN",
    subtitle: "external librosa test",
    group: "external",
    kind: "detector",
  },
  {
    id: "parselmouth",
    title: "Praat",
    subtitle: "external speech-F0 test",
    group: "external",
    kind: "detector",
  },
];

const STAGES: Array<{
  id: StageId;
  title: string;
  intent: string;
}> = [
  {
    id: "raw",
    title: "Raw",
    intent: "audio worker note JSON",
  },
  {
    id: "intent",
    title: "Intent",
    intent: "keeps the hummed contour",
  },
  {
    id: "corrected",
    title: "Corrected",
    intent: "pitch and timing repair",
  },
  {
    id: "musical",
    title: "Musical",
    intent: "song-like phrase repair",
  },
];

const DEFAULT_PROMPT = "simple warm piano and soft pads, clear lead melody, no vocals";
const MAX_RECORDING_MS = 12_000;

export default function MeloLabPage() {
  return (
    <Suspense fallback={<MeloLabFallback />}>
      <MeloLabContent />
    </Suspense>
  );
}

function MeloLabContent() {
  const searchParams = useSearchParams();
  const developerMode = usePreferencesStore((state) => state.developerMode);
  const debugEnabled = developerMode || searchParams.get("debug") === "1";
  const [recording, setRecording] = useState(false);
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState<string | null>(null);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [providerRuns, setProviderRuns] = useState<ProviderRun[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<PitchProviderId>("auto");
  const [selectedStage, setSelectedStage] = useState<StageId>("corrected");
  const [renderMode, setRenderMode] = useState<RenderMode>("piano");
  const [playingKey, setPlayingKey] = useState<string | null>(null);
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [styleMix, setStyleMix] = useState(0);
  const [musicOutputs, setMusicOutputs] = useState<Record<string, MusicOutput | null>>({});

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const stopTimerRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const activeNodesRef = useRef<Array<AudioNode | AudioScheduledSourceNode>>([]);

  const selectedRun = useMemo(
    () =>
      providerRuns.find(
        (run): run is ReadyProviderRun =>
          run.provider === selectedProvider && run.status === "ready",
      ) ?? null,
    [providerRuns, selectedProvider],
  );

  const selectedNotes = useMemo(
    () => (selectedRun ? notesForStage(selectedRun.response, selectedStage) : []),
    [selectedRun, selectedStage],
  );

  const selectedMelody = useMemo(
    () => (selectedRun ? melodyForStage(selectedRun.response, selectedStage) : null),
    [selectedRun, selectedStage],
  );

  const selectedOutputKey = candidateKey(selectedProvider, selectedStage);
  const selectedOutput = musicOutputs[selectedOutputKey] ?? null;
  const readyRuns = providerRuns.filter(isReadyRun);
  const selectedProviderRun = providerRuns.find((run) => run.provider === selectedProvider) ?? null;

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const stopRecording = useCallback(() => {
    if (stopTimerRef.current !== null) {
      window.clearTimeout(stopTimerRef.current);
      stopTimerRef.current = null;
    }
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    } else {
      stopStream();
    }
    recorderRef.current = null;
    setRecording(false);
  }, [stopStream]);

  const transcribeBlob = useCallback(async (blob: Blob) => {
    setStatus("transcribing");
    setError(null);
    setProviderRuns(PROVIDERS.map((provider) => ({ provider: provider.id, status: "loading" })));
    setMusicOutputs((previous) => {
      revokeMusicOutputs(previous);
      return {};
    });

    const outcomes = await Promise.all(
      PROVIDERS.map((provider) => transcribeProvider(blob, provider.id)),
    );
    setProviderRuns(outcomes);

    const firstReady = outcomes.find(isReadyRun);
    if (!firstReady) {
      setError("No provider returned a usable melody.");
      setStatus("error");
      return;
    }

    setSelectedProvider(firstReady.provider);
    setSelectedStage(firstReady.response.result.selectedMelodyKind);
    setStatus("ready");
    const failed = outcomes.filter((run) => run.status === "error");
    setError(
      failed.length > 0
        ? `${failed.length} provider${failed.length === 1 ? "" : "s"} failed; usable candidates are still shown.`
        : null,
    );
  }, []);

  const startRecording = useCallback(async () => {
    if (recording) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("This browser cannot record audio.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      const options = mediaRecorderOptions();
      const recorder = new MediaRecorder(stream, options);
      recorderRef.current = recorder;
      const mimeType = recorder.mimeType || options.mimeType || "audio/webm";
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        stopStream();
        const blob = new Blob(chunksRef.current, { type: mimeType });
        setAudioBlob(blob);
        setAudioUrl((previous) => replaceObjectUrl(previous, blob));
        void transcribeBlob(blob);
      };
      recorder.start(100);
      setRecording(true);
      setStatus("recording");
      stopTimerRef.current = window.setTimeout(() => {
        stopRecording();
      }, MAX_RECORDING_MS);
    } catch (err) {
      stopStream();
      setError(err instanceof Error ? err.message : String(err));
      setStatus("error");
    }
  }, [recording, stopRecording, stopStream, transcribeBlob]);

  const handleUpload = useCallback(
    (file: File | null) => {
      if (!file) return;
      setAudioBlob(file);
      setAudioUrl((previous) => replaceObjectUrl(previous, file));
      void transcribeBlob(file);
    },
    [transcribeBlob],
  );

  const playStage = useCallback(
    async (provider: PitchProviderId, stage: StageId, mode: RenderMode) => {
      const run = providerRuns.find(
        (candidate): candidate is ReadyProviderRun =>
          candidate.provider === provider && candidate.status === "ready",
      );
      if (!run) return;

      stopSynth(activeNodesRef.current);
      activeNodesRef.current = [];
      const key = candidateKey(provider, stage);
      setPlayingKey(key);
      try {
        const ctx = await getAudioContext(audioContextRef);
        const notes = notesForStage(run.response, stage);
        const duration = renderNotes(ctx, notes, mode, activeNodesRef.current);
        window.setTimeout(() => setPlayingKey(null), Math.max(400, duration * 1000 + 120));
      } catch (err) {
        setPlayingKey(null);
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [providerRuns],
  );

  const stopPlayback = useCallback(() => {
    stopSynth(activeNodesRef.current);
    activeNodesRef.current = [];
    setPlayingKey(null);
  }, []);

  const generateMusic = useCallback(async () => {
    if (!selectedMelody) return;
    setStatus("generating_music");
    setError(null);
    try {
      const form = new FormData();
      form.append("prompt", prompt);
      form.append(
        "duration",
        String(Math.min(20, Math.max(2, Math.ceil(selectedMelody.duration || 10)))),
      );
      form.append("styleMix", String(styleMix));
      form.append("melody", JSON.stringify(selectedMelody));
      if (audioBlob && styleMix > 0) {
        form.append("hum", audioBlob, filenameForBlob(audioBlob));
      }

      const response = await fetch("/api/test/melo-lab/music", {
        method: "POST",
        body: form,
        cache: "no-store",
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as {
          message?: string;
          error?: string;
        };
        throw new Error(payload.message || payload.error || `HTTP ${response.status}`);
      }
      const blob = await response.blob();
      setMusicOutputs((previous) => {
        const old = previous[selectedOutputKey];
        if (old) URL.revokeObjectURL(old.url);
        return {
          ...previous,
          [selectedOutputKey]: {
            url: URL.createObjectURL(blob),
            provider: selectedProvider,
            stage: selectedStage,
            prompt,
            styleMix,
            model: response.headers.get("x-model"),
            generationMs: response.headers.get("x-generation-ms"),
            melodyConditioned: response.headers.get("x-melody-conditioned"),
            cfgNotes: response.headers.get("x-cfg-notes"),
          },
        };
      });
      setStatus("ready");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus("error");
    }
  }, [
    audioBlob,
    prompt,
    selectedMelody,
    selectedOutputKey,
    selectedProvider,
    selectedStage,
    styleMix,
  ]);

  const downloadStageJson = useCallback((response: MeloLabResponse, stage: StageId) => {
    downloadText(
      stageFilename(response, stage, "json"),
      JSON.stringify(stagePayload(response, stage), null, 2),
      "application/json",
    );
  }, []);

  const downloadStageCsv = useCallback((response: MeloLabResponse, stage: StageId) => {
    downloadText(stageFilename(response, stage, "csv"), notesAsCsv(notesForStage(response, stage)), "text/csv");
  }, []);

  if (!debugEnabled) {
    return (
      <div className="min-h-svh bg-[#F5F1EB] px-6 py-12 text-[#1A1A1A]">
        <div className="mx-auto max-w-2xl border border-[#1A1A1A]/10 bg-white px-6 py-8">
          <p className="text-[10px] uppercase tracking-[0.24em] text-[#8C8780]">
            TEST ONLY / melo-lab
          </p>
          <h1 className="mt-3 hero-serif text-[32px] leading-tight">
            Hidden local diagnostics
          </h1>
          <p className="mt-3 text-[14px] leading-[1.65] text-[#6F6A63]">
            Add <span className="font-mono text-[#1A1A1A]">?debug=1</span> or enable
            Developer mode in Settings.
          </p>
          <Link
            href="/me/debug?debug=1"
            className="mt-5 inline-flex items-center gap-2 border border-[#1A1A1A]/15 bg-white px-4 py-2 text-[12px]"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to debug
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-svh bg-[#F5F1EB] text-[#1A1A1A]">
      <header className="border-b border-[#1A1A1A]/10 px-5 py-5 md:px-8">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <Link
              href="/me/debug?debug=1"
              className="inline-flex items-center gap-2 text-[12px] text-[#6F6A63] hover:text-[#1A1A1A]"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Debug
            </Link>
            <p className="mt-5 text-[10px] uppercase tracking-[0.24em] text-[#FF5924]">
              TEST ONLY / local melo-lab
            </p>
            <h1 className="mt-2 hero-serif text-[42px] leading-none md:text-[64px]">
              Melo Lab
            </h1>
            <p className="mt-3 max-w-3xl text-[14px] leading-[1.65] text-[#6F6A63]">
              Local pitch-provider bench for the Murmur worker path plus small
              external reference packages. Heavy neural baselines stay out of this
              light lab profile.
            </p>
          </div>
          <StatusPill status={status} />
        </div>
      </header>

      <main className="mx-auto grid max-w-7xl gap-6 px-5 py-6 lg:grid-cols-[330px_1fr] md:px-8">
        <aside className="space-y-4">
          <section className="border border-[#1A1A1A]/10 bg-white p-4">
            <h2 className="text-[13px] font-semibold uppercase tracking-[0.16em]">
              Input
            </h2>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={recording ? stopRecording : startRecording}
                className="inline-flex items-center gap-2 border border-[#1A1A1A]/15 bg-[#1A1A1A] px-3 py-2 text-[12px] text-white disabled:opacity-50"
                disabled={status === "transcribing" || status === "generating_music"}
              >
                {recording ? <Square className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
                {recording ? "Stop" : "Record"}
              </button>
              <label className="inline-flex cursor-pointer items-center gap-2 border border-[#1A1A1A]/15 bg-white px-3 py-2 text-[12px]">
                <Upload className="h-3.5 w-3.5" />
                Upload
                <input
                  type="file"
                  accept="audio/*"
                  className="hidden"
                  onChange={(event) => handleUpload(event.target.files?.[0] ?? null)}
                />
              </label>
            </div>
            {audioUrl && (
              <audio
                className="mt-4 w-full"
                src={audioUrl}
                controls
                preload="metadata"
              />
            )}
            {error && (
              <p className="mt-4 border border-[#FF5924]/20 bg-[#FFF1EA] px-3 py-2 text-[12px] leading-[1.55] text-[#A83B16]">
                {error}
              </p>
            )}
          </section>

          <section className="border border-[#1A1A1A]/10 bg-white p-4">
            <h2 className="text-[13px] font-semibold uppercase tracking-[0.16em]">
              Render
            </h2>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setRenderMode("piano")}
                className={toggleClass(renderMode === "piano")}
              >
                Piano
              </button>
              <button
                type="button"
                onClick={() => setRenderMode("voice")}
                className={toggleClass(renderMode === "voice")}
              >
                Voice
              </button>
            </div>
            <button
              type="button"
              onClick={stopPlayback}
              className="mt-3 inline-flex w-full items-center justify-center gap-2 border border-[#1A1A1A]/15 bg-white px-3 py-2 text-[12px]"
            >
              <Square className="h-3.5 w-3.5" />
              Stop synth
            </button>
          </section>

          <section className="border border-[#1A1A1A]/10 bg-white p-4">
            <h2 className="text-[13px] font-semibold uppercase tracking-[0.16em]">
              Providers
            </h2>
            <ProviderStatusGroup
              title="Murmur engine"
              providers={PROVIDERS.filter((provider) => provider.group === "murmur")}
              providerRuns={providerRuns}
              selectedProvider={selectedProvider}
              onSelect={(provider) => setSelectedProvider(provider)}
            />
            <ProviderStatusGroup
              title="External test packages"
              providers={PROVIDERS.filter((provider) => provider.group === "external")}
              providerRuns={providerRuns}
              selectedProvider={selectedProvider}
              onSelect={(provider) => setSelectedProvider(provider)}
            />
          </section>

          <section className="border border-[#1A1A1A]/10 bg-white p-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-[13px] font-semibold uppercase tracking-[0.16em]">
                Music worker
              </h2>
              <button
                type="button"
                onClick={() => void generateMusic()}
                disabled={!selectedMelody || status === "generating_music"}
                className="inline-flex items-center gap-2 border border-[#1A1A1A]/15 bg-[#1A1A1A] px-3 py-2 text-[12px] text-white disabled:opacity-40"
              >
                {status === "generating_music" ? (
                  <RefreshCcw className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Wand2 className="h-3.5 w-3.5" />
                )}
                Generate
              </button>
            </div>
            <p className="mt-3 text-[12px] leading-[1.55] text-[#6F6A63]">
              Selected: {selectedProvider} / {stageTitle(selectedStage)}
            </p>
            <label className="mt-4 block text-[12px] text-[#6F6A63]">
              Prompt
              <input
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                className="mt-1 w-full border border-[#1A1A1A]/15 bg-white px-3 py-2 text-[12px] outline-none"
              />
            </label>
            <label className="mt-3 block text-[12px] text-[#6F6A63]">
              Hum style mix: {styleMix.toFixed(2)}
              <input
                type="range"
                min={0}
                max={0.8}
                step={0.05}
                value={styleMix}
                onChange={(event) => setStyleMix(Number(event.target.value))}
                className="mt-2 block w-full"
              />
            </label>
            {selectedOutput && (
              <div className="mt-4 border border-[#1A1A1A]/10 bg-[#FAF7F0] p-3">
                <div className="mb-2 flex items-center gap-2 text-[12px] font-medium">
                  <Music2 className="h-3.5 w-3.5" />
                  {selectedOutput.provider} / {stageTitle(selectedOutput.stage)}
                </div>
                <audio src={selectedOutput.url} controls className="w-full" />
                <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-[#6F6A63]">
                  {metadataEntries(selectedOutput).map(([key, value]) => (
                    <span key={key} className="border border-[#1A1A1A]/10 bg-white px-2 py-1">
                      {key}: {value || "n/a"}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </section>
        </aside>

        <div className="space-y-5">
          <section className="border border-[#1A1A1A]/10 bg-white">
            <div className="border-b border-[#1A1A1A]/10 px-4 py-3">
              <h2 className="text-[13px] font-semibold uppercase tracking-[0.16em]">
                Candidate matrix
              </h2>
            </div>
            {providerRuns.length === 0 ? (
              <EmptyMatrix />
            ) : selectedProviderRun ? (
              <ProviderPanel
                run={selectedProviderRun}
                selectedProvider={selectedProvider}
                selectedStage={selectedStage}
                renderMode={renderMode}
                playingKey={playingKey}
                onSelect={(provider, stage) => {
                  setSelectedProvider(provider);
                  setSelectedStage(stage);
                }}
                onPlay={(provider, stage) => void playStage(provider, stage, renderMode)}
                onDownloadJson={downloadStageJson}
                onDownloadCsv={downloadStageCsv}
              />
            ) : (
              <ProviderMissing provider={selectedProvider} />
            )}
          </section>

          <section className="border border-[#1A1A1A]/10 bg-white p-4">
            <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
              <div>
                <h2 className="text-[13px] font-semibold uppercase tracking-[0.16em]">
                  Pitch path
                </h2>
                <p className="mt-1 text-[12px] text-[#6F6A63]">
                  Selected: {selectedProvider} / {stageTitle(selectedStage)}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {selectedRun && (
                  <>
                    <button
                      type="button"
                      onClick={() => downloadStageJson(selectedRun.response, selectedStage)}
                      className="inline-flex items-center gap-2 border border-[#1A1A1A]/15 bg-white px-3 py-2 text-[12px]"
                    >
                      <FileJson className="h-3.5 w-3.5" />
                      JSON
                    </button>
                    <button
                      type="button"
                      onClick={() => downloadStageCsv(selectedRun.response, selectedStage)}
                      className="inline-flex items-center gap-2 border border-[#1A1A1A]/15 bg-white px-3 py-2 text-[12px]"
                    >
                      <Download className="h-3.5 w-3.5" />
                      CSV
                    </button>
                  </>
                )}
              </div>
            </div>
            <PitchPath notes={selectedNotes} />
          </section>

          <section className="grid gap-5 xl:grid-cols-[1fr_380px]">
            <div className="border border-[#1A1A1A]/10 bg-white p-4">
              <h2 className="text-[13px] font-semibold uppercase tracking-[0.16em]">
                Notes
              </h2>
              <NotesTable notes={selectedNotes} />
            </div>
            <div className="border border-[#1A1A1A]/10 bg-white p-4">
              <h2 className="text-[13px] font-semibold uppercase tracking-[0.16em]">
                Diagnostics
              </h2>
              {selectedRun ? (
                <pre className="mt-3 max-h-80 overflow-auto bg-[#1A1A1A] p-3 text-[11px] leading-[1.45] text-[#F5F1EB]">
                  {JSON.stringify(
                    {
                      requestedProvider: selectedRun.response.requestedProvider,
                      actualProvider: selectedRun.response.result.provider,
                      selectedBySystem: selectedRun.response.result.selectedMelodyKind,
                      ...compactDiagnostics(selectedRun.response.result.diagnostics),
                    },
                    null,
                    2,
                  )}
                </pre>
              ) : (
                <div className="mt-3 flex h-44 items-center justify-center border border-[#1A1A1A]/10 bg-[#FAF7F0] text-[12px] text-[#8C8780]">
                  No diagnostics yet
                </div>
              )}
            </div>
          </section>

          {readyRuns.length > 0 && (
            <section className="border border-[#1A1A1A]/10 bg-white p-4">
              <h2 className="text-[13px] font-semibold uppercase tracking-[0.16em]">
                Export all
              </h2>
              <div className="mt-4 flex flex-wrap gap-2">
                {readyRuns.map((run) => (
                  <button
                    key={run.provider}
                    type="button"
                    onClick={() => downloadProviderBundle(run.response)}
                    className="inline-flex items-center gap-2 border border-[#1A1A1A]/15 bg-white px-3 py-2 text-[12px]"
                  >
                    <FileJson className="h-3.5 w-3.5" />
                    {run.provider} bundle
                  </button>
                ))}
              </div>
            </section>
          )}
        </div>
      </main>
    </div>
  );
}

function MeloLabFallback() {
  return (
    <div className="min-h-svh bg-[#F5F1EB] px-6 py-12 text-[13px] text-[#6F6A63]">
      Loading melo-lab...
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  return (
    <div className="border border-[#1A1A1A]/10 bg-white px-3 py-2 text-[12px] text-[#6F6A63]">
      status: <span className="font-mono text-[#1A1A1A]">{status}</span>
    </div>
  );
}

function ProviderStatusGroup({
  title,
  providers,
  providerRuns,
  selectedProvider,
  onSelect,
}: {
  title: string;
  providers: Array<(typeof PROVIDERS)[number]>;
  providerRuns: ProviderRun[];
  selectedProvider: PitchProviderId;
  onSelect: (provider: PitchProviderId) => void;
}) {
  return (
    <div className="mt-4">
      <p className="text-[10px] uppercase tracking-[0.18em] text-[#8C8780]">{title}</p>
      <div className="mt-2 space-y-2">
        {providers.map((provider) => {
          const run = providerRuns.find((item) => item.provider === provider.id);
          return (
            <ProviderStatus
              key={provider.id}
              provider={provider}
              run={run}
              selected={selectedProvider === provider.id}
              onSelect={() => onSelect(provider.id)}
            />
          );
        })}
      </div>
    </div>
  );
}

function ProviderStatus({
  provider,
  run,
  selected,
  onSelect,
}: {
  provider: (typeof PROVIDERS)[number];
  run: ProviderRun | undefined;
  selected: boolean;
  onSelect: () => void;
}) {
  const statusText =
    run?.status === "ready"
      ? `${run.response.result.provider} · ${run.elapsedMs}ms`
      : run?.status === "error"
        ? "failed"
        : run?.status === "loading"
          ? "running"
          : "load audio";

  return (
    <button
      type="button"
      onClick={onSelect}
      className={
        selected
          ? "w-full border border-[#1A1A1A] bg-[#FFF9F2] px-3 py-2 text-left"
          : "w-full border border-[#1A1A1A]/10 bg-white px-3 py-2 text-left hover:bg-[#FAF7F0]"
      }
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[12px] font-medium">{provider.title}</p>
          <p className="mt-0.5 text-[11px] text-[#8C8780]">{provider.subtitle}</p>
        </div>
        <span className="font-mono text-[11px] text-[#6F6A63]">{statusText}</span>
      </div>
    </button>
  );
}

function EmptyMatrix() {
  return (
    <div className="flex min-h-[360px] items-center justify-center px-6 py-10 text-center">
      <div>
        <p className="text-[13px] font-medium">No hum loaded</p>
        <p className="mt-2 max-w-md text-[12px] leading-[1.6] text-[#6F6A63]">
          Record or upload audio to produce local provider candidates.
        </p>
      </div>
    </div>
  );
}

function ProviderMissing({ provider }: { provider: PitchProviderId }) {
  return (
    <div className="flex min-h-48 items-center justify-center px-6 py-10 text-center">
      <div>
        <p className="text-[13px] font-medium">{providerInfo(provider).title}</p>
        <p className="mt-2 max-w-md text-[12px] leading-[1.6] text-[#6F6A63]">
          This provider has not returned a candidate for the current hum.
        </p>
      </div>
    </div>
  );
}

function ProviderPanel({
  run,
  selectedProvider,
  selectedStage,
  renderMode,
  playingKey,
  onSelect,
  onPlay,
  onDownloadJson,
  onDownloadCsv,
}: {
  run: ProviderRun;
  selectedProvider: PitchProviderId;
  selectedStage: StageId;
  renderMode: RenderMode;
  playingKey: string | null;
  onSelect: (provider: PitchProviderId, stage: StageId) => void;
  onPlay: (provider: PitchProviderId, stage: StageId) => void;
  onDownloadJson: (response: MeloLabResponse, stage: StageId) => void;
  onDownloadCsv: (response: MeloLabResponse, stage: StageId) => void;
}) {
  const providerMeta = providerInfo(run.provider);
  const requestLabel = providerMeta.kind === "route" ? "route" : "detector";
  const originLabel = providerMeta.group === "murmur" ? "Murmur" : "external";
  return (
    <div className="px-4 py-4">
      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-[16px] font-semibold">{providerMeta.title}</p>
          <p className="mt-1 text-[12px] leading-[1.5] text-[#6F6A63]">
            {originLabel} ·{" "}
            {requestLabel}: <span className="font-mono">{run.provider}</span>
            {run.status === "ready" && (
              <>
                {" "}
                · detector used: <span className="font-mono">{run.response.result.provider}</span>
                {" "}
                · selected: <span className="font-mono">{run.response.result.selectedMelodyKind}</span>
              </>
            )}
          </p>
        </div>
        {run.status === "ready" && (
          <div className="flex flex-wrap gap-2 text-[11px] text-[#6F6A63]">
            {providerFacts(run.response, run.elapsedMs).map(([key, value]) => (
              <span key={key} className="border border-[#1A1A1A]/10 bg-[#FAF7F0] px-2 py-1">
                {key}: {value}
              </span>
            ))}
          </div>
        )}
      </div>

      {run.status === "loading" && (
        <div className="mt-4 border border-[#1A1A1A]/10 bg-[#FAF7F0] px-4 py-8 text-[12px] text-[#6F6A63]">
          Running local transcription...
        </div>
      )}

      {run.status === "error" && (
        <div className="mt-4 border border-[#FF5924]/20 bg-[#FFF1EA] px-3 py-2 text-[12px] leading-[1.55] text-[#A83B16]">
          {run.error}
        </div>
      )}

      {run.status === "ready" && (
        <div className="mt-4 grid gap-3 xl:grid-cols-4 md:grid-cols-2">
          {STAGES.map((stage) => (
            <StageCard
              key={`${run.provider}-${stage.id}`}
              response={run.response}
              stage={stage}
              selected={selectedProvider === run.provider && selectedStage === stage.id}
              playing={playingKey === candidateKey(run.provider, stage.id)}
              renderMode={renderMode}
              onSelect={() => onSelect(run.provider, stage.id)}
              onPlay={() => onPlay(run.provider, stage.id)}
              onDownloadJson={() => onDownloadJson(run.response, stage.id)}
              onDownloadCsv={() => onDownloadCsv(run.response, stage.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function StageCard({
  response,
  stage,
  selected,
  playing,
  renderMode,
  onSelect,
  onPlay,
  onDownloadJson,
  onDownloadCsv,
}: {
  response: MeloLabResponse;
  stage: (typeof STAGES)[number];
  selected: boolean;
  playing: boolean;
  renderMode: RenderMode;
  onSelect: () => void;
  onPlay: () => void;
  onDownloadJson: () => void;
  onDownloadCsv: () => void;
}) {
  const notes = notesForStage(response, stage.id);
  const summary = summaryForStage(response, stage.id);
  const facts = stageFacts(notes, summary);

  return (
    <div
      className={
        selected
          ? "border border-[#1A1A1A] bg-[#FFF9F2] p-3"
          : "border border-[#1A1A1A]/10 bg-white p-3"
      }
    >
      <button type="button" onClick={onSelect} className="block w-full text-left">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[14px] font-semibold">{stage.title}</p>
            <p className="mt-1 text-[11px] leading-[1.45] text-[#6F6A63]">{stage.intent}</p>
          </div>
          {selected && (
            <span className="border border-[#1A1A1A]/10 bg-white px-2 py-1 text-[10px] uppercase tracking-[0.16em] text-[#1A1A1A]">
              selected
            </span>
          )}
        </div>
      </button>

      <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-[#6F6A63]">
        {facts.map(([key, value]) => (
          <span key={key} className="border border-[#1A1A1A]/10 bg-[#FAF7F0] px-2 py-1">
            {key}: {value}
          </span>
        ))}
      </div>

      <MiniNotes notes={notes} />

      <div className="mt-3 grid grid-cols-3 gap-2">
        <button
          type="button"
          onClick={onPlay}
          disabled={notes.length === 0}
          className="inline-flex items-center justify-center gap-1.5 border border-[#1A1A1A]/15 bg-white px-2 py-2 text-[11px] disabled:opacity-40"
        >
          {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          {renderMode}
        </button>
        <button
          type="button"
          onClick={onDownloadJson}
          disabled={notes.length === 0}
          className="inline-flex items-center justify-center gap-1.5 border border-[#1A1A1A]/15 bg-white px-2 py-2 text-[11px] disabled:opacity-40"
        >
          <FileJson className="h-3.5 w-3.5" />
          JSON
        </button>
        <button
          type="button"
          onClick={onDownloadCsv}
          disabled={notes.length === 0}
          className="inline-flex items-center justify-center gap-1.5 border border-[#1A1A1A]/15 bg-white px-2 py-2 text-[11px] disabled:opacity-40"
        >
          <Download className="h-3.5 w-3.5" />
          CSV
        </button>
      </div>
    </div>
  );
}

function MiniNotes({ notes }: { notes: MelodyNote[] }) {
  const preview = notes.slice(0, 6);
  if (preview.length === 0) {
    return (
      <div className="mt-3 flex h-20 items-center justify-center border border-[#1A1A1A]/10 bg-[#FAF7F0] text-[11px] text-[#8C8780]">
        No notes
      </div>
    );
  }
  return (
    <div className="mt-3 overflow-hidden border border-[#1A1A1A]/10 bg-[#FAF7F0]">
      <table className="w-full text-left text-[10px] text-[#6F6A63]">
        <thead className="border-b border-[#1A1A1A]/10 text-[#8C8780]">
          <tr>
            <th className="px-2 py-1 font-medium">note</th>
            <th className="px-2 py-1 font-medium">start</th>
            <th className="px-2 py-1 font-medium">dur</th>
          </tr>
        </thead>
        <tbody>
          {preview.map((note, index) => (
            <tr key={`${note.pitch}-${note.start}-${index}`}>
              <td className="px-2 py-1 font-mono text-[#1A1A1A]">{noteName(note.pitch)}</td>
              <td className="px-2 py-1 font-mono">{round(note.start)}</td>
              <td className="px-2 py-1 font-mono">{round(note.duration)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PitchPath({ notes }: { notes: MelodyNote[] }) {
  if (notes.length === 0) {
    return (
      <div className="mt-4 flex h-72 items-center justify-center border border-[#1A1A1A]/10 bg-[#FAF7F0] text-[12px] text-[#8C8780]">
        No notes yet
      </div>
    );
  }

  const minPitch = Math.min(...notes.map((note) => note.pitch)) - 2;
  const maxPitch = Math.max(...notes.map((note) => note.pitch)) + 2;
  const duration = Math.max(...notes.map((note) => note.start + note.duration), 1);
  const width = 980;
  const height = 300;
  const leftPad = 54;
  const rightPad = 18;
  const topPad = 20;
  const bottomPad = 30;
  const plotWidth = width - leftPad - rightPad;
  const plotHeight = height - topPad - bottomPad;
  const pitchSpan = Math.max(1, maxPitch - minPitch);
  const lanes = buildPitchLanes(minPitch, maxPitch);
  const points = notes
    .map((note) => {
      const x = leftPad + ((note.start + note.duration / 2) / duration) * plotWidth;
      const y = topPad + (1 - (note.pitch - minPitch) / pitchSpan) * plotHeight;
      return `${round(x)},${round(y)}`;
    })
    .join(" ");

  return (
    <div className="mt-4 overflow-x-auto border border-[#1A1A1A]/10 bg-[#FAF7F0]">
      <svg viewBox={`0 0 ${width} ${height}`} className="min-w-[820px]">
        <rect x={0} y={0} width={width} height={height} fill="#FAF7F0" />
        {lanes.map((pitch) => {
          const y = topPad + (1 - (pitch - minPitch) / pitchSpan) * plotHeight;
          return (
            <g key={pitch}>
              <line
                x1={leftPad}
                x2={width - rightPad}
                y1={y}
                y2={y}
                stroke="rgba(26,26,26,0.08)"
              />
              <text
                x={12}
                y={y + 4}
                fill="#6F6A63"
                fontSize={10}
                fontFamily="monospace"
              >
                {noteName(pitch)}
              </text>
            </g>
          );
        })}
        <polyline
          points={points}
          fill="none"
          stroke="#1A1A1A"
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
          opacity={0.5}
        />
        {notes.map((note, index) => {
          const x = leftPad + (note.start / duration) * plotWidth;
          const w = Math.max(8, (note.duration / duration) * plotWidth);
          const y = topPad + (1 - (note.pitch - minPitch) / pitchSpan) * plotHeight;
          const opacity = Math.max(0.28, Math.min(1, note.confidence || 0.8));
          return (
            <g key={`${note.start}-${note.pitch}-${index}`}>
              <rect
                x={x}
                y={y - 7}
                width={w}
                height={14}
                rx={2}
                fill="#FF5924"
                opacity={opacity}
              />
              {w > 34 && (
                <text
                  x={x + 5}
                  y={y + 4}
                  fill="#FFFFFF"
                  fontSize={10}
                  fontFamily="monospace"
                >
                  {noteName(note.pitch)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function NotesTable({ notes }: { notes: MelodyNote[] }) {
  if (notes.length === 0) {
    return (
      <div className="mt-3 flex h-64 items-center justify-center border border-[#1A1A1A]/10 bg-[#FAF7F0] text-[12px] text-[#8C8780]">
        No notes yet
      </div>
    );
  }
  return (
    <div className="mt-3 max-h-80 overflow-auto border border-[#1A1A1A]/10">
      <table className="w-full min-w-[620px] text-left text-[11px]">
        <thead className="sticky top-0 border-b border-[#1A1A1A]/10 bg-white text-[#8C8780]">
          <tr>
            <th className="px-3 py-2 font-medium">#</th>
            <th className="px-3 py-2 font-medium">pitch</th>
            <th className="px-3 py-2 font-medium">note</th>
            <th className="px-3 py-2 font-medium">start</th>
            <th className="px-3 py-2 font-medium">duration</th>
            <th className="px-3 py-2 font-medium">velocity</th>
            <th className="px-3 py-2 font-medium">confidence</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#1A1A1A]/10">
          {notes.map((note, index) => (
            <tr key={`${note.pitch}-${note.start}-${index}`}>
              <td className="px-3 py-2 font-mono text-[#8C8780]">{index + 1}</td>
              <td className="px-3 py-2 font-mono">{note.pitch}</td>
              <td className="px-3 py-2 font-mono text-[#1A1A1A]">{noteName(note.pitch)}</td>
              <td className="px-3 py-2 font-mono">{round(note.start)}</td>
              <td className="px-3 py-2 font-mono">{round(note.duration)}</td>
              <td className="px-3 py-2 font-mono">{round(note.velocity)}</td>
              <td className="px-3 py-2 font-mono">{round(note.confidence)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

async function transcribeProvider(
  blob: Blob,
  provider: PitchProviderId,
): Promise<ProviderRun> {
  const startedAt = performance.now();
  const form = new FormData();
  form.append("audio", blob, filenameForBlob(blob));
  form.append("targetInstrument", "piano");
  form.append("pitchProvider", provider);

  try {
    const response = await fetch("/api/test/melo-lab/transcribe", {
      method: "POST",
      body: form,
      cache: "no-store",
    });
    const payload = (await response.json()) as unknown;
    if (!response.ok) {
      throw new Error(errorMessageFromPayload(payload, response.status));
    }
    return {
      provider,
      status: "ready",
      response: payload as MeloLabResponse,
      elapsedMs: Math.round(performance.now() - startedAt),
    };
  } catch (err) {
    return {
      provider,
      status: "error",
      error: err instanceof Error ? err.message : String(err),
      elapsedMs: Math.round(performance.now() - startedAt),
    };
  }
}

function isReadyRun(run: ProviderRun): run is ReadyProviderRun {
  return run.status === "ready";
}

function providerInfo(provider: PitchProviderId): (typeof PROVIDERS)[number] {
  return PROVIDERS.find((item) => item.id === provider) ?? PROVIDERS[0];
}

function candidateKey(provider: PitchProviderId, stage: StageId): string {
  return `${provider}:${stage}`;
}

function notesForStage(response: MeloLabResponse, stage: StageId): MelodyNote[] {
  if (stage === "raw") return response.stages.raw.notes;
  return response.stages[stage].melody.notes;
}

function melodyForStage(response: MeloLabResponse, stage: StageId): CleanMelody {
  if (stage !== "raw") return response.stages[stage].melody;
  const corrected = response.stages.corrected.melody;
  const rawNotes = response.stages.raw.notes;
  return {
    ...corrected,
    notes: rawNotes,
    duration:
      rawNotes.length > 0
        ? Math.max(...rawNotes.map((note) => note.start + note.duration))
        : 0,
  };
}

function summaryForStage(response: MeloLabResponse, stage: StageId): Record<string, unknown> {
  if (stage === "raw") return response.stages.raw.summary;
  return response.stages[stage].summary;
}

function stageFacts(
  notes: MelodyNote[],
  summary: Record<string, unknown>,
): Array<[string, string]> {
  const duration =
    notes.length > 0 ? Math.max(...notes.map((note) => note.start + note.duration)) : 0;
  return [
    ["notes", String(notes.length)],
    ["dur", `${round(duration)}s`],
    ["range", pitchRange(notes)],
    ["avg conf", averageConfidence(notes)],
    ["bpm", String(summary.bpm ?? "n/a")],
    ["contour", String(summary.contour ?? "n/a")],
  ];
}

function providerFacts(response: MeloLabResponse, elapsedMs: number): Array<[string, string]> {
  const diagnostics = response.result.diagnostics;
  return [
    ["elapsed", `${elapsedMs}ms`],
    ["worker", `${diagnostics?.workerMs ?? "n/a"}ms`],
    ["pitch", `${diagnostics?.pitchMs ?? "n/a"}ms`],
    ["voiced", diagnostics?.voicedRatio == null ? "n/a" : String(diagnostics.voicedRatio)],
    ["snr", diagnostics?.snr == null ? "n/a" : String(diagnostics.snr)],
  ];
}

function stagePayload(response: MeloLabResponse, stage: StageId) {
  return {
    tool: "melo-lab",
    testOnly: true,
    requestId: response.requestId,
    requestedProvider: response.requestedProvider,
    actualProvider: response.result.provider,
    selectedBySystem: response.result.selectedMelodyKind,
    stage,
    summary: summaryForStage(response, stage),
    melody: stage === "raw" ? null : response.stages[stage].melody,
    notes: notesForStage(response, stage),
    contour: response.result.contour ?? null,
    diagnostics: compactDiagnostics(response.result.diagnostics),
    warnings: response.result.warnings,
  };
}

function downloadProviderBundle(response: MeloLabResponse) {
  const payload = {
    tool: "melo-lab",
    testOnly: true,
    requestId: response.requestId,
    requestedProvider: response.requestedProvider,
    actualProvider: response.result.provider,
    selectedBySystem: response.result.selectedMelodyKind,
    stages: Object.fromEntries(
      STAGES.map((stage) => [
        stage.id,
        {
          summary: summaryForStage(response, stage.id),
          notes: notesForStage(response, stage.id),
          melody: stage.id === "raw" ? null : response.stages[stage.id].melody,
        },
      ]),
    ),
    contour: response.result.contour ?? null,
    diagnostics: compactDiagnostics(response.result.diagnostics),
    warnings: response.result.warnings,
  };
  downloadText(
    `melo-lab-${response.pitchProvider}-${response.requestId.slice(0, 8)}-bundle.json`,
    JSON.stringify(payload, null, 2),
    "application/json",
  );
}

function compactDiagnostics(diagnostics?: TranscriptionDiagnostics) {
  if (!diagnostics) return null;
  return {
    selectedMelodyKind: diagnostics.selectedMelodyKind,
    duration: diagnostics.duration,
    snr: diagnostics.snr,
    voicedRatio: diagnostics.voicedRatio,
    acceptanceScore: diagnostics.acceptanceScore,
    musicFeelScore: diagnostics.musicFeelScore,
    onsetFragmentation: diagnostics.onsetFragmentation,
    firstOnsetLag: diagnostics.firstOnsetLag,
    excessiveHoldRatio: diagnostics.excessiveHoldRatio,
    interiorHoldRatio: diagnostics.interiorHoldRatio,
    noteHypothesis: diagnostics.noteHypothesis,
    noteProposalProfile: diagnostics.noteProposalProfile,
    ensembleCandidates: diagnostics.ensembleCandidates,
    ensembleDecision: diagnostics.ensembleDecision,
    ensembleSelected: diagnostics.ensembleSelected,
    repairTriggered: diagnostics.repairTriggered,
    repairTriggerReason: diagnostics.repairTriggerReason,
    workerMs: diagnostics.workerMs,
    pitchMs: diagnostics.pitchMs,
    polishMs: diagnostics.polishMs,
  };
}

function errorMessageFromPayload(payload: unknown, status: number): string {
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    if (typeof record.message === "string") return record.message;
    if (typeof record.error === "string") return record.error;
    if (record.detail && typeof record.detail === "object") {
      const detail = record.detail as Record<string, unknown>;
      if (typeof detail.message === "string") return detail.message;
      if (typeof detail.error === "string") return detail.error;
    }
  }
  return `HTTP ${status}`;
}

function renderNotes(
  ctx: AudioContext,
  notes: MelodyNote[],
  mode: RenderMode,
  nodes: Array<AudioNode | AudioScheduledSourceNode>,
): number {
  const startAt = ctx.currentTime + 0.05;
  const master = ctx.createGain();
  master.gain.value = mode === "piano" ? 0.42 : 0.34;
  master.connect(ctx.destination);
  nodes.push(master);

  const end = notes.reduce((max, note) => Math.max(max, note.start + note.duration), 0);
  for (const note of notes) {
    if (mode === "piano") {
      schedulePianoNote(ctx, master, startAt, note, nodes);
    } else {
      scheduleVoiceNote(ctx, master, startAt, note, nodes);
    }
  }
  return end;
}

function schedulePianoNote(
  ctx: AudioContext,
  output: AudioNode,
  startAt: number,
  note: MelodyNote,
  nodes: Array<AudioNode | AudioScheduledSourceNode>,
) {
  const t0 = startAt + note.start;
  const t1 = t0 + Math.max(0.06, note.duration);
  const gain = ctx.createGain();
  const osc = ctx.createOscillator();
  osc.type = "triangle";
  osc.frequency.value = midiToHz(note.pitch);
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(0.18 * Math.max(0.2, note.velocity), t0 + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.035, Math.min(t1, t0 + 0.22));
  gain.gain.exponentialRampToValueAtTime(0.0001, t1 + 0.06);
  osc.connect(gain);
  gain.connect(output);
  osc.start(t0);
  osc.stop(t1 + 0.08);
  nodes.push(osc, gain);
}

function scheduleVoiceNote(
  ctx: AudioContext,
  output: AudioNode,
  startAt: number,
  note: MelodyNote,
  nodes: Array<AudioNode | AudioScheduledSourceNode>,
) {
  const t0 = startAt + note.start;
  const t1 = t0 + Math.max(0.08, note.duration);
  const gain = ctx.createGain();
  const filter = ctx.createBiquadFilter();
  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.value = midiToHz(note.pitch);
  filter.type = "bandpass";
  filter.frequency.value = 950;
  filter.Q.value = 0.8;
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.linearRampToValueAtTime(0.2 * Math.max(0.25, note.velocity), t0 + 0.045);
  gain.gain.setValueAtTime(0.18 * Math.max(0.25, note.velocity), Math.max(t0 + 0.05, t1 - 0.08));
  gain.gain.linearRampToValueAtTime(0.0001, t1 + 0.05);
  osc.connect(filter);
  filter.connect(gain);
  gain.connect(output);
  osc.start(t0);
  osc.stop(t1 + 0.08);
  nodes.push(osc, filter, gain);
}

async function getAudioContext(ref: MutableRefObject<AudioContext | null>) {
  ref.current ??= new AudioContext();
  if (ref.current.state === "suspended") {
    await ref.current.resume();
  }
  return ref.current;
}

function stopSynth(nodes: Array<AudioNode | AudioScheduledSourceNode>) {
  for (const node of nodes) {
    if ("stop" in node) {
      try {
        node.stop();
      } catch {
        // Already stopped.
      }
    }
    try {
      node.disconnect();
    } catch {
      // Some AudioScheduledSourceNodes are already disconnected.
    }
  }
}

function midiToHz(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

function noteName(midi: number): string {
  const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const pitch = Math.round(midi);
  return `${names[((pitch % 12) + 12) % 12]}${Math.floor(pitch / 12) - 1}`;
}

function buildPitchLanes(minPitch: number, maxPitch: number): number[] {
  const lanes: number[] = [];
  for (let pitch = Math.ceil(minPitch); pitch <= Math.floor(maxPitch); pitch += 1) {
    if (pitch % 2 === 0 || pitch === minPitch || pitch === maxPitch) {
      lanes.push(pitch);
    }
  }
  return lanes;
}

function pitchRange(notes: MelodyNote[]): string {
  if (notes.length === 0) return "none";
  const min = Math.min(...notes.map((note) => note.pitch));
  const max = Math.max(...notes.map((note) => note.pitch));
  return `${noteName(min)}-${noteName(max)}`;
}

function averageConfidence(notes: MelodyNote[]): string {
  if (notes.length === 0) return "n/a";
  return String(
    round(notes.reduce((sum, note) => sum + note.confidence, 0) / notes.length),
  );
}

function stageTitle(stage: StageId): string {
  return STAGES.find((item) => item.id === stage)?.title ?? stage;
}

function filenameForBlob(blob: Blob): string {
  if (blob.type.includes("webm")) return "hum.webm";
  if (blob.type.includes("mp4") || blob.type.includes("m4a")) return "hum.m4a";
  if (blob.type.includes("wav")) return "hum.wav";
  return "hum.audio";
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
  return {};
}

function replaceObjectUrl(previous: string | null, blob: Blob): string {
  if (previous) URL.revokeObjectURL(previous);
  return URL.createObjectURL(blob);
}

function revokeMusicOutputs(outputs: Record<string, MusicOutput | null>) {
  Object.values(outputs).forEach((output) => {
    if (output) URL.revokeObjectURL(output.url);
  });
}

function metadataEntries(output: MusicOutput): Array<[string, string | null]> {
  return [
    ["model", output.model],
    ["generationMs", output.generationMs],
    ["melodyConditioned", output.melodyConditioned],
    ["cfgNotes", output.cfgNotes],
    ["styleMix", output.styleMix.toFixed(2)],
  ];
}

function toggleClass(active: boolean): string {
  return active
    ? "border border-[#1A1A1A] bg-[#1A1A1A] px-3 py-2 text-[12px] text-white"
    : "border border-[#1A1A1A]/15 bg-white px-3 py-2 text-[12px] text-[#6F6A63] hover:bg-[#F7F3EA]";
}

function notesAsCsv(notes: MelodyNote[]): string {
  const rows = ["index,pitch,note,start,duration,velocity,confidence"];
  notes.forEach((note, index) => {
    rows.push(
      [
        index,
        note.pitch,
        noteName(note.pitch),
        round(note.start),
        round(note.duration),
        round(note.velocity),
        round(note.confidence),
      ].join(","),
    );
  });
  return rows.join("\n");
}

function stageFilename(response: MeloLabResponse, stage: StageId, ext: "json" | "csv"): string {
  return `melo-lab-${response.pitchProvider}-${stage}-${response.requestId.slice(0, 8)}.${ext}`;
}

function downloadText(filename: string, text: string, type: string) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 500);
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
