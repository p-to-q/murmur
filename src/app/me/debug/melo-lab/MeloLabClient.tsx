"use client";

import { Suspense, useCallback, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type {
  CleanMelody,
  MelodyNote,
  MelodySelectionKind,
  TranscriptionDiagnostics,
  TranscriptionResult,
} from "@/modules/shared/types";
import { usePreferencesStore } from "@/lib/store/preferences-store";

type ProviderId = "auto" | "swiftf0" | "pyin" | "yin" | "parselmouth";
type StageId = "raw" | MelodySelectionKind;
type Run =
  | { provider: ProviderId; status: "loading" }
  | { provider: ProviderId; status: "error"; error: string; ms: number }
  | { provider: ProviderId; status: "ready"; response: LabResponse; ms: number };

type LabResponse = {
  testOnly: true;
  requestId: string;
  pitchProvider: ProviderId;
  requestedProvider: string;
  result: TranscriptionResult;
  stages: {
    raw: { notes: MelodyNote[]; summary: { noteCount: number; duration: number } };
    intent: { melody: CleanMelody; summary: Record<string, unknown> };
    corrected: { melody: CleanMelody; summary: Record<string, unknown> };
    musical: { melody: CleanMelody; summary: Record<string, unknown> };
  };
};

type MusicOutput = {
  url: string;
  provider: ProviderId;
  stage: StageId;
  model: string | null;
  generationMs: string | null;
};

const PROVIDERS: Array<{
  id: ProviderId;
  title: string;
  subtitle: string;
  group: "Murmur engine" | "External test packages";
}> = [
  { id: "auto", title: "Auto ensemble", subtitle: "worker selection", group: "Murmur engine" },
  { id: "swiftf0", title: "SwiftF0", subtitle: "fast local F0", group: "Murmur engine" },
  { id: "pyin", title: "pYIN", subtitle: "librosa baseline", group: "Murmur engine" },
  { id: "yin", title: "YIN", subtitle: "small DSP baseline", group: "External test packages" },
  { id: "parselmouth", title: "Praat", subtitle: "speech-like F0", group: "External test packages" },
];

const STAGES: Array<{ id: StageId; title: string; note: string }> = [
  { id: "raw", title: "Raw", note: "audio worker note JSON" },
  { id: "intent", title: "Intent", note: "hummed contour" },
  { id: "corrected", title: "Corrected", note: "pitch/time repair" },
  { id: "musical", title: "Musical", note: "song-like repair" },
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

function MeloLabFallback() {
  return (
    <div className="min-h-svh bg-[#F5F1EB] p-8 text-[#1A1A1A]">
      <p className="text-[10px] uppercase tracking-[0.24em] text-[#FF5924]">
        TEST ONLY / local melo-lab
      </p>
      <h1 className="mt-2 hero-serif text-[42px]">Melo Lab</h1>
      <p className="mt-2 text-[13px] text-[#6F6A63]">Loading melo-lab...</p>
    </div>
  );
}

function MeloLabContent() {
  const searchParams = useSearchParams();
  const developerMode = usePreferencesStore((state) => state.developerMode);
  const debugEnabled = developerMode || searchParams.get("debug") === "1";
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [provider, setProvider] = useState<ProviderId>("auto");
  const [stage, setStage] = useState<StageId>("corrected");
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [styleMix, setStyleMix] = useState(0);
  const [music, setMusic] = useState<Record<string, MusicOutput | null>>({});
  const [playing, setPlaying] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const nodesRef = useRef<Array<AudioNode | AudioScheduledSourceNode>>([]);

  const selectedRun = runs.find((run) => run.provider === provider) ?? null;
  const readyRun = selectedRun?.status === "ready" ? selectedRun : null;
  const notes = readyRun ? notesForStage(readyRun.response, stage) : [];
  const melody = readyRun ? melodyForStage(readyRun.response, stage) : null;
  const musicKey = `${provider}:${stage}`;
  const selectedMusic = music[musicKey] ?? null;

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const stopRecording = useCallback(() => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    if (recorderRef.current && recorderRef.current.state !== "inactive") recorderRef.current.stop();
    else stopStream();
    recorderRef.current = null;
    setRecording(false);
  }, [stopStream]);

  const transcribe = useCallback(async (blob: Blob) => {
    setStatus("transcribing");
    setError(null);
    setRuns(PROVIDERS.map((item) => ({ provider: item.id, status: "loading" })));
    setMusic((old) => {
      Object.values(old).forEach((item) => item && URL.revokeObjectURL(item.url));
      return {};
    });
    const outcomes = await Promise.all(PROVIDERS.map((item) => transcribeProvider(blob, item.id)));
    setRuns(outcomes);
    const first = outcomes.find((run): run is Extract<Run, { status: "ready" }> => run.status === "ready");
    if (!first) {
      setStatus("error");
      setError("No provider returned a usable melody.");
      return;
    }
    setProvider(first.provider);
    setStage(first.response.result.selectedMelodyKind);
    setStatus("ready");
    const failed = outcomes.filter((run) => run.status === "error").length;
    setError(failed > 0 ? `${failed} provider${failed === 1 ? "" : "s"} failed; usable candidates are shown.` : null);
  }, []);

  const startRecording = useCallback(async () => {
    if (recording) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("This browser cannot record audio.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, mediaRecorderOptions());
      streamRef.current = stream;
      recorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        stopStream();
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        setAudioBlob(blob);
        setAudioUrl((old) => replaceObjectUrl(old, blob));
        void transcribe(blob);
      };
      recorder.start(100);
      setRecording(true);
      setStatus("recording");
      timerRef.current = window.setTimeout(stopRecording, MAX_RECORDING_MS);
    } catch (err) {
      stopStream();
      setStatus("error");
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [recording, stopRecording, stopStream, transcribe]);

  async function playSelected() {
    if (!notes.length) return;
    stopSynth(nodesRef.current);
    nodesRef.current = [];
    setPlaying(musicKey);
    const ctx = await getAudioContext(audioCtxRef);
    const duration = renderNotes(ctx, notes, nodesRef.current);
    window.setTimeout(() => setPlaying(null), duration * 1000 + 180);
  }

  async function generateMusic() {
    if (!melody) return;
    setStatus("generating_music");
    setError(null);
    try {
      const form = new FormData();
      form.append("prompt", prompt);
      form.append("duration", String(Math.min(20, Math.max(2, Math.ceil(melody.duration || 10)))));
      form.append("styleMix", String(styleMix));
      form.append("melody", JSON.stringify(melody));
      if (audioBlob && styleMix > 0) form.append("hum", audioBlob, filenameForBlob(audioBlob));
      const response = await fetch("/api/test/melo-lab/music", { method: "POST", body: form, cache: "no-store" });
      if (!response.ok) throw new Error(await responseMessage(response));
      const blob = await response.blob();
      setMusic((old) => {
        if (old[musicKey]) URL.revokeObjectURL(old[musicKey]?.url ?? "");
        return {
          ...old,
          [musicKey]: {
            url: URL.createObjectURL(blob),
            provider,
            stage,
            model: response.headers.get("x-model"),
            generationMs: response.headers.get("x-generation-ms"),
          },
        };
      });
      setStatus("ready");
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  if (!debugEnabled) {
    return (
      <div className="min-h-svh bg-[#F5F1EB] p-8 text-[#1A1A1A]">
        <p className="text-[10px] uppercase tracking-[0.24em] text-[#8C8780]">TEST ONLY / melo-lab</p>
        <h1 className="mt-3 hero-serif text-[32px]">Hidden local diagnostics</h1>
        <p className="mt-2 text-[14px] text-[#6F6A63]">Add ?debug=1 or enable Developer mode.</p>
      </div>
    );
  }

  return (
    <div className="min-h-svh bg-[#F5F1EB] text-[#1A1A1A]">
      <header className="border-b border-[#1A1A1A]/10 px-5 py-5 md:px-8">
        <Link href="/me/debug?debug=1" className="text-[12px] text-[#6F6A63]">Debug</Link>
        <p className="mt-4 text-[10px] uppercase tracking-[0.24em] text-[#FF5924]">TEST ONLY / local melo-lab</p>
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="hero-serif text-[48px] leading-none md:text-[64px]">Melo Lab</h1>
            <p className="mt-3 max-w-3xl text-[14px] leading-[1.6] text-[#6F6A63]">
              Local pitch-provider bench for Murmur worker JSON, repair layers, and final music-worker drift.
            </p>
          </div>
          <p className="border border-[#1A1A1A]/10 bg-white px-3 py-2 text-[12px]">status: {status}</p>
        </div>
      </header>

      <main className="mx-auto grid max-w-7xl gap-5 px-5 py-6 lg:grid-cols-[300px_1fr] md:px-8">
        <aside className="space-y-4">
          <Panel title="Input">
            <div className="flex flex-wrap gap-2">
              <button className={darkButton} onClick={recording ? stopRecording : startRecording} disabled={status === "transcribing"}>
                {recording ? "Stop" : "Record"}
              </button>
              <label className={lightButton}>
                Upload
                <input
                  type="file"
                  accept="audio/*"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (!file) return;
                    setAudioBlob(file);
                    setAudioUrl((old) => replaceObjectUrl(old, file));
                    void transcribe(file);
                  }}
                />
              </label>
            </div>
            {audioUrl && <audio className="mt-3 w-full" controls src={audioUrl} preload="metadata" />}
            {error && <p className="mt-3 border border-[#FF5924]/20 bg-[#FFF1EA] p-2 text-[12px] text-[#A83B16]">{error}</p>}
          </Panel>

          <Panel title="Providers">
            {["Murmur engine", "External test packages"].map((group) => (
              <div key={group} className="mt-3">
                <p className="text-[10px] uppercase tracking-[0.18em] text-[#8C8780]">{group}</p>
                <div className="mt-2 space-y-2">
                  {PROVIDERS.filter((item) => item.group === group).map((item) => {
                    const run = runs.find((candidate) => candidate.provider === item.id);
                    return (
                      <button
                        key={item.id}
                        className={`w-full border px-3 py-2 text-left ${provider === item.id ? "border-[#1A1A1A] bg-[#FFF9F2]" : "border-[#1A1A1A]/10 bg-white"}`}
                        onClick={() => setProvider(item.id)}
                      >
                        <span className="block text-[12px] font-medium">{item.title}</span>
                        <span className="block text-[11px] text-[#8C8780]">
                          {item.subtitle} · {runLabel(run)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </Panel>

          <Panel title="Music worker">
            <p className="text-[12px] text-[#6F6A63]">Selected: {provider} / {stageTitle(stage)}</p>
            <input value={prompt} onChange={(event) => setPrompt(event.target.value)} className="mt-3 w-full border border-[#1A1A1A]/15 px-3 py-2 text-[12px]" />
            <label className="mt-3 block text-[12px] text-[#6F6A63]">
              Hum style mix: {styleMix.toFixed(2)}
              <input className="mt-2 w-full" type="range" min={0} max={0.8} step={0.05} value={styleMix} onChange={(event) => setStyleMix(Number(event.target.value))} />
            </label>
            <button className={`${darkButton} mt-3 w-full`} disabled={!melody || status === "generating_music"} onClick={() => void generateMusic()}>
              Generate
            </button>
            {selectedMusic && (
              <div className="mt-3 border border-[#1A1A1A]/10 bg-[#FAF7F0] p-2">
                <p className="mb-2 text-[12px]">{selectedMusic.provider} / {stageTitle(selectedMusic.stage)}</p>
                <audio className="w-full" src={selectedMusic.url} controls />
                <p className="mt-2 text-[11px] text-[#6F6A63]">model: {selectedMusic.model || "n/a"} · ms: {selectedMusic.generationMs || "n/a"}</p>
              </div>
            )}
          </Panel>
        </aside>

        <div className="space-y-5">
          <Panel title="Candidate matrix">
            {!selectedRun ? (
              <Empty text="Record or upload audio to produce local provider candidates." />
            ) : selectedRun.status === "loading" ? (
              <Empty text={`Running ${provider}...`} />
            ) : selectedRun.status === "error" ? (
              <Empty text={`${provider}: ${selectedRun.error}`} />
            ) : (
              <div>
                <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                  <div>
                    <p className="text-[16px] font-semibold">{providerInfo(provider).title}</p>
                    <p className="mt-1 text-[12px] text-[#6F6A63]">
                      requested: {selectedRun.response.requestedProvider} · actual: {selectedRun.response.result.provider} · {selectedRun.ms}ms
                    </p>
                  </div>
                  <button className={lightButton} onClick={() => downloadBundle(selectedRun.response)}>Bundle JSON</button>
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  {STAGES.map((item) => {
                    const stageNotes = notesForStage(selectedRun.response, item.id);
                    return (
                      <button
                        key={item.id}
                        className={`border p-3 text-left ${stage === item.id ? "border-[#1A1A1A] bg-[#FFF9F2]" : "border-[#1A1A1A]/10 bg-white"}`}
                        onClick={() => setStage(item.id)}
                      >
                        <span className="block text-[14px] font-semibold">{item.title}</span>
                        <span className="mt-1 block text-[11px] text-[#6F6A63]">{item.note}</span>
                        <span className="mt-3 block text-[11px] text-[#6F6A63]">
                          notes: {stageNotes.length} · range: {pitchRange(stageNotes)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </Panel>

          <Panel title="Pitch path">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <p className="text-[12px] text-[#6F6A63]">Selected: {provider} / {stageTitle(stage)}</p>
              <div className="flex flex-wrap gap-2">
                <button className={lightButton} disabled={!notes.length} onClick={() => void playSelected()}>{playing === musicKey ? "Playing" : "Play synth"}</button>
                <button className={lightButton} disabled={!readyRun} onClick={() => readyRun && downloadStage(readyRun.response, stage, "json")}>JSON</button>
                <button className={lightButton} disabled={!readyRun} onClick={() => readyRun && downloadStage(readyRun.response, stage, "csv")}>CSV</button>
              </div>
            </div>
            <PitchPath notes={notes} />
          </Panel>

          <section className="grid gap-5 xl:grid-cols-[1fr_380px]">
            <Panel title="Notes"><NotesTable notes={notes} /></Panel>
            <Panel title="Diagnostics">
              {readyRun ? (
                <pre className="mt-3 max-h-80 overflow-auto bg-[#1A1A1A] p-3 text-[11px] leading-[1.45] text-[#F5F1EB]">
                  {JSON.stringify(compactDiagnostics(readyRun.response.result.diagnostics), null, 2)}
                </pre>
              ) : (
                <Empty text="No diagnostics yet" />
              )}
            </Panel>
          </section>
        </div>
      </main>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border border-[#1A1A1A]/10 bg-white p-4">
      <h2 className="text-[13px] font-semibold uppercase tracking-[0.16em]">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="flex min-h-44 items-center justify-center bg-[#FAF7F0] p-6 text-center text-[12px] text-[#8C8780]">{text}</div>;
}

function PitchPath({ notes }: { notes: MelodyNote[] }) {
  if (!notes.length) return <Empty text="No notes yet" />;
  const minPitch = Math.min(...notes.map((note) => note.pitch)) - 2;
  const maxPitch = Math.max(...notes.map((note) => note.pitch)) + 2;
  const duration = Math.max(...notes.map((note) => note.start + note.duration), 1);
  const pitchSpan = Math.max(1, maxPitch - minPitch);
  return (
    <div className="overflow-x-auto border border-[#1A1A1A]/10 bg-[#FAF7F0]">
      <svg viewBox="0 0 900 250" className="min-w-[760px]">
        {Array.from({ length: maxPitch - minPitch + 1 }, (_, index) => minPitch + index)
          .filter((pitch) => pitch % 2 === 0)
          .map((pitch) => {
            const y = 20 + (1 - (pitch - minPitch) / pitchSpan) * 200;
            return (
              <g key={pitch}>
                <line x1={48} x2={880} y1={y} y2={y} stroke="rgba(26,26,26,.08)" />
                <text x={10} y={y + 4} fontSize={10} fill="#6F6A63">{noteName(pitch)}</text>
              </g>
            );
          })}
        {notes.map((note, index) => {
          const x = 48 + (note.start / duration) * 832;
          const w = Math.max(8, (note.duration / duration) * 832);
          const y = 20 + (1 - (note.pitch - minPitch) / pitchSpan) * 200;
          return <rect key={`${note.start}-${note.pitch}-${index}`} x={x} y={y - 7} width={w} height={14} rx={2} fill="#FF5924" opacity={Math.max(0.25, note.confidence || 0.8)} />;
        })}
      </svg>
    </div>
  );
}

function NotesTable({ notes }: { notes: MelodyNote[] }) {
  if (!notes.length) return <Empty text="No notes yet" />;
  return (
    <div className="max-h-80 overflow-auto border border-[#1A1A1A]/10">
      <table className="w-full min-w-[560px] text-left text-[11px]">
        <thead className="sticky top-0 bg-white text-[#8C8780]">
          <tr>{["#", "pitch", "note", "start", "duration", "confidence"].map((head) => <th key={head} className="px-3 py-2 font-medium">{head}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-[#1A1A1A]/10">
          {notes.map((note, index) => (
            <tr key={`${note.pitch}-${note.start}-${index}`}>
              <td className="px-3 py-2 font-mono">{index + 1}</td>
              <td className="px-3 py-2 font-mono">{note.pitch}</td>
              <td className="px-3 py-2 font-mono">{noteName(note.pitch)}</td>
              <td className="px-3 py-2 font-mono">{round(note.start)}</td>
              <td className="px-3 py-2 font-mono">{round(note.duration)}</td>
              <td className="px-3 py-2 font-mono">{round(note.confidence)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

async function transcribeProvider(blob: Blob, provider: ProviderId): Promise<Run> {
  const started = performance.now();
  const form = new FormData();
  form.append("audio", blob, filenameForBlob(blob));
  form.append("targetInstrument", "piano");
  form.append("pitchProvider", provider);
  try {
    const response = await fetch("/api/test/melo-lab/transcribe", { method: "POST", body: form, cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(errorMessage(payload, response.status));
    return { provider, status: "ready", response: payload as LabResponse, ms: Math.round(performance.now() - started) };
  } catch (err) {
    return { provider, status: "error", error: err instanceof Error ? err.message : String(err), ms: Math.round(performance.now() - started) };
  }
}

function notesForStage(response: LabResponse, stage: StageId): MelodyNote[] {
  return stage === "raw" ? response.stages.raw.notes : response.stages[stage].melody.notes;
}

function melodyForStage(response: LabResponse, stage: StageId): CleanMelody {
  if (stage !== "raw") return response.stages[stage].melody;
  const rawNotes = response.stages.raw.notes;
  return { ...response.stages.corrected.melody, notes: rawNotes, duration: rawNotes.reduce((max, note) => Math.max(max, note.start + note.duration), 0) };
}

function providerInfo(provider: ProviderId) {
  return PROVIDERS.find((item) => item.id === provider) ?? PROVIDERS[0];
}

function runLabel(run: Run | undefined) {
  if (!run) return "waiting";
  if (run.status === "loading") return "running";
  if (run.status === "error") return "failed";
  return `${run.response.result.provider} · ${run.ms}ms`;
}

function stageTitle(stage: StageId) {
  return STAGES.find((item) => item.id === stage)?.title ?? stage;
}

function downloadStage(response: LabResponse, stage: StageId, ext: "json" | "csv") {
  const notes = notesForStage(response, stage);
  const text = ext === "json" ? JSON.stringify(stagePayload(response, stage), null, 2) : notesAsCsv(notes);
  downloadText(`melo-lab-${response.pitchProvider}-${stage}-${response.requestId.slice(0, 8)}.${ext}`, text, ext === "json" ? "application/json" : "text/csv");
}

function downloadBundle(response: LabResponse) {
  downloadText(`melo-lab-${response.pitchProvider}-${response.requestId.slice(0, 8)}-bundle.json`, JSON.stringify({
    tool: "melo-lab",
    testOnly: true,
    requestId: response.requestId,
    requestedProvider: response.requestedProvider,
    actualProvider: response.result.provider,
    selectedBySystem: response.result.selectedMelodyKind,
    stages: Object.fromEntries(STAGES.map((item) => [item.id, { notes: notesForStage(response, item.id), melody: item.id === "raw" ? null : response.stages[item.id].melody }])),
    diagnostics: compactDiagnostics(response.result.diagnostics),
  }, null, 2), "application/json");
}

function stagePayload(response: LabResponse, stage: StageId) {
  return {
    tool: "melo-lab",
    testOnly: true,
    requestId: response.requestId,
    requestedProvider: response.requestedProvider,
    actualProvider: response.result.provider,
    stage,
    melody: stage === "raw" ? null : response.stages[stage].melody,
    notes: notesForStage(response, stage),
    diagnostics: compactDiagnostics(response.result.diagnostics),
  };
}

function compactDiagnostics(diagnostics?: TranscriptionDiagnostics) {
  if (!diagnostics) return null;
  return {
    duration: diagnostics.duration,
    snr: diagnostics.snr,
    voicedRatio: diagnostics.voicedRatio,
    selectedMelodyKind: diagnostics.selectedMelodyKind,
    acceptanceScore: diagnostics.acceptanceScore,
    musicFeelScore: diagnostics.musicFeelScore,
    ensembleDecision: diagnostics.ensembleDecision,
    ensembleSelected: diagnostics.ensembleSelected,
    noteHypothesis: diagnostics.noteHypothesis,
    workerMs: diagnostics.workerMs,
    pitchMs: diagnostics.pitchMs,
    polishMs: diagnostics.polishMs,
  };
}

function renderNotes(ctx: AudioContext, notes: MelodyNote[], nodes: Array<AudioNode | AudioScheduledSourceNode>) {
  const startAt = ctx.currentTime + 0.05;
  const master = ctx.createGain();
  master.gain.value = 0.35;
  master.connect(ctx.destination);
  nodes.push(master);
  for (const note of notes) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const t0 = startAt + note.start;
    const t1 = t0 + Math.max(0.06, note.duration);
    osc.type = "triangle";
    osc.frequency.value = midiToHz(note.pitch);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(0.16 * Math.max(0.2, note.velocity), t0 + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t1 + 0.05);
    osc.connect(gain);
    gain.connect(master);
    osc.start(t0);
    osc.stop(t1 + 0.08);
    nodes.push(osc, gain);
  }
  return notes.reduce((max, note) => Math.max(max, note.start + note.duration), 0);
}

async function getAudioContext(ref: MutableRefObject<AudioContext | null>) {
  ref.current ??= new AudioContext();
  if (ref.current.state === "suspended") await ref.current.resume();
  return ref.current;
}

function stopSynth(nodes: Array<AudioNode | AudioScheduledSourceNode>) {
  for (const node of nodes) {
    if ("stop" in node) {
      try { node.stop(); } catch {}
    }
    try { node.disconnect(); } catch {}
  }
}

function notesAsCsv(notes: MelodyNote[]) {
  return ["index,pitch,start,duration,velocity,confidence", ...notes.map((note, index) => [index, note.pitch, round(note.start), round(note.duration), round(note.velocity), round(note.confidence)].join(","))].join("\n");
}

function downloadText(filename: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 250);
}

function mediaRecorderOptions(): MediaRecorderOptions {
  if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) return { mimeType: "audio/webm;codecs=opus" };
  return {};
}

function filenameForBlob(blob: Blob) {
  return blob.type.includes("wav") ? "hum.wav" : "hum.webm";
}

function replaceObjectUrl(previous: string | null, blob: Blob) {
  if (previous) URL.revokeObjectURL(previous);
  return URL.createObjectURL(blob);
}

function errorMessage(payload: unknown, status: number) {
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

async function responseMessage(response: Response) {
  return errorMessage(await response.json().catch(() => ({})), response.status);
}

function pitchRange(notes: MelodyNote[]) {
  if (!notes.length) return "none";
  return `${Math.min(...notes.map((note) => note.pitch))}-${Math.max(...notes.map((note) => note.pitch))}`;
}

function noteName(pitch: number) {
  const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  return `${names[((pitch % 12) + 12) % 12]}${Math.floor(pitch / 12) - 1}`;
}

function midiToHz(pitch: number) {
  return 440 * 2 ** ((pitch - 69) / 12);
}

function round(value: number) {
  return Math.round(value * 1000) / 1000;
}

const darkButton = "border border-[#1A1A1A]/15 bg-[#1A1A1A] px-3 py-2 text-[12px] text-white disabled:opacity-40";
const lightButton = "inline-flex cursor-pointer items-center justify-center border border-[#1A1A1A]/15 bg-white px-3 py-2 text-[12px] disabled:opacity-40";
