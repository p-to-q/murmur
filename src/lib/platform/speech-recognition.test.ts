import { describe, expect, it } from "bun:test";
import {
  classifySpeechTranscription,
  getSpeechRecognitionProvider,
  normalizeLyrics,
  type SpeechTranscription,
} from "./speech-recognition";

function transcribe(overrides: Partial<SpeechTranscription>): SpeechTranscription {
  return {
    text: "",
    language: "unknown",
    confidence: 0.8,
    provider: "local:sensevoice:SenseVoiceSmall-GGUF",
    ...overrides,
  };
}

describe("classifySpeechTranscription", () => {
  it("keeps pure hum on the hum path", () => {
    const result = classifySpeechTranscription(
      transcribe({ text: "la la la la", confidence: 0.72 }),
    );
    expect(result.kind).toBe("hum");
  });

  it("routes Chinese lyrics to voice", () => {
    const result = classifySpeechTranscription(
      transcribe({ text: "我想和你唱到天亮", language: "zh", confidence: 0.9 }),
    );
    expect(result.kind).toBe("voice");
    if (result.kind === "voice") {
      expect(result.lyrics).toContain("天亮");
      expect(result.language).toBe("zh");
    }
  });

  it("routes English lyrics to voice", () => {
    const result = classifySpeechTranscription(
      transcribe({ text: "I want to sing until sunrise", language: "en", confidence: 0.88 }),
    );
    expect(result.kind).toBe("voice");
    if (result.kind === "voice") {
      expect(result.lyrics).toContain("sunrise");
      expect(result.language).toBe("en");
    }
  });

  it("treats nonsense syllables as hum", () => {
    const result = classifySpeechTranscription(
      transcribe({ text: "na na na la la", confidence: 0.91 }),
    );
    expect(result.kind).toBe("hum");
  });

  it("rejects low VAD activity before trusting lyrical text", () => {
    const result = classifySpeechTranscription(
      transcribe({
        text: "I want to sing until sunrise",
        confidence: 0.92,
        vad: {
          provider: "fsmn-vad",
          speechDurationMs: 320,
          speechRatio: 0.08,
        },
      }),
    );
    expect(result.kind).toBe("hum");
    expect(result.diagnostics.reason).toBe("insufficient_vocal_activity");
  });

  it("rejects low-SNR audio even when ASR returns lyrics", () => {
    const result = classifySpeechTranscription(
      transcribe({
        text: "我想和你唱到天亮",
        language: "zh",
        confidence: 0.92,
        audio: {
          durationMs: 3500,
          snr: 2,
        },
      }),
    );
    expect(result.kind).toBe("hum");
    expect(result.diagnostics.reason).toBe("audio_quality_rejected");
  });
});

describe("normalizeLyrics", () => {
  it("collapses whitespace without changing line breaks", () => {
    expect(normalizeLyrics("  hi   there\n\n\nfriend  ")).toBe("hi there\n\nfriend");
  });
});

describe("getSpeechRecognitionProvider", () => {
  it("returns null when voice input is disabled", () => {
    const previousFlag = process.env.MURMUR_VOICE_INPUT_ENABLED;
    const previousUrl = process.env.SPEECH_WORKER_URL;
    process.env.MURMUR_VOICE_INPUT_ENABLED = "0";
    process.env.SPEECH_WORKER_URL = "http://127.0.0.1:8003";
    expect(getSpeechRecognitionProvider()).toBeNull();
    process.env.MURMUR_VOICE_INPUT_ENABLED = previousFlag;
    process.env.SPEECH_WORKER_URL = previousUrl;
  });

  it("uses the local speech worker when configured", async () => {
    const previousFlag = process.env.MURMUR_VOICE_INPUT_ENABLED;
    const previousUrl = process.env.SPEECH_WORKER_URL;
    const previousTimeout = process.env.SPEECH_WORKER_TIMEOUT_MS;
    const previousFetch = globalThis.fetch;
    let observedUrl = "";
    let observedRequestId = "";

    process.env.MURMUR_VOICE_INPUT_ENABLED = "1";
    process.env.SPEECH_WORKER_URL = "http://speech.local";
    process.env.SPEECH_WORKER_TIMEOUT_MS = "1000";
    globalThis.fetch = (async (input, init) => {
      observedUrl = String(input);
      observedRequestId = new Headers(init?.headers).get("x-request-id") ?? "";
      return Response.json({
        provider: "local:sensevoice:SenseVoiceSmall-GGUF",
        text: "I can sing this line",
        language: "en",
        confidence: 0.91,
        vad: { provider: "fsmn-vad", speechDurationMs: 2100, speechRatio: 0.7 },
        audio: { durationMs: 3000, snr: 18 },
        asrDiagnostics: {
          runtime: "funasr-gguf",
          model: "SenseVoiceSmall-GGUF",
          artifactSha: "sha",
          license: "apache-2.0",
        },
      });
    }) as typeof fetch;

    try {
      const provider = getSpeechRecognitionProvider();
      expect(provider).not.toBeNull();
      const result = await provider!.transcribeSpeech(
        new File([new Uint8Array([1])], "voice.webm", { type: "audio/webm" }),
        { requestId: "req_speech" },
      );
      expect(observedUrl).toBe("http://speech.local/analyze-speech");
      expect(observedRequestId).toBe("req_speech");
      expect(result.provider).toBe("local:sensevoice:SenseVoiceSmall-GGUF");
      expect(result.vad?.provider).toBe("fsmn-vad");
      expect(result.asrDiagnostics?.license).toBe("apache-2.0");
    } finally {
      globalThis.fetch = previousFetch;
      process.env.MURMUR_VOICE_INPUT_ENABLED = previousFlag;
      process.env.SPEECH_WORKER_URL = previousUrl;
      process.env.SPEECH_WORKER_TIMEOUT_MS = previousTimeout;
    }
  });
});
