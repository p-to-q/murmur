import { describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

import casesJson from "../../../tests/music-quality-golden/cases.json";
import { analyzePcm16Wav, type MusicQualityGateResult } from "./music-output-quality";

interface GoldenCase {
  id: string;
  sampleRate: number;
  channels: number;
  expectedDuration: number;
  segments: Array<{ kind: "sine" | "silence"; seconds: number; amplitudePcm?: number }>;
  mutation?: "riff_size" | "riff_size_oversized" | "byte_rate" | "trailing_bytes";
  expectedFailures: string[];
}

const cases = casesJson as GoldenCase[];
const metricNames: Record<string, string> = {
  duration_seconds: "durationSeconds",
  sample_rate: "sampleRate",
  frame_count: "frameCount",
  clipping_ratio: "clippingRatio",
  active_ratio: "activeRatio",
  dc_offset: "dcOffset",
  rms_dbfs: "rmsDbfs",
  peak_dbfs: "peakDbfs",
  crest_factor_db: "crestFactorDb",
  quiet_window_ratio: "quietWindowRatio",
  longest_quiet_run_seconds: "longestQuietRunSeconds",
  interior_dropout_count: "interiorDropoutCount",
  longest_interior_dropout_seconds: "longestInteriorDropoutSeconds",
};

describe("music quality Gate cross-language contract", () => {
  it("returns the same decisions and metrics for shared PCM fixtures", () => {
    const fixtures = cases.map((fixture) => ({ fixture, bytes: buildWav(fixture) }));
    const webResults = fixtures.map(({ fixture, bytes }) =>
      analyzePcm16Wav(bytes, fixture.expectedDuration),
    );
    const workerResults = runPythonGate(fixtures.map(({ fixture, bytes }) => ({
      expectedDuration: fixture.expectedDuration,
      audioBase64: Buffer.from(bytes).toString("base64"),
    })));

    for (const [index, fixture] of fixtures.entries()) {
      const web = webResults[index];
      const worker = workerResults[index];
      expect(web.failures, `${fixture.fixture.id}: Web golden result`).toEqual(
        fixture.fixture.expectedFailures,
      );
      expect(worker.failures, `${fixture.fixture.id}: Worker golden result`).toEqual(
        fixture.fixture.expectedFailures,
      );
      expect(worker.version, fixture.fixture.id).toBe(web.version);
      expect(worker.passed, fixture.fixture.id).toBe(web.passed);
      expect([...worker.failures].sort(), fixture.fixture.id).toEqual([...web.failures].sort());
      const mappedWorkerMetrics = Object.fromEntries(
        Object.entries(worker.metrics).map(([name, value]) => [metricNames[name] ?? name, value]),
      );
      expect(
        Object.keys(mappedWorkerMetrics).sort(),
        `${fixture.fixture.id}: metric keys`,
      ).toEqual(Object.keys(web.metrics).sort());
      for (const [pythonName, value] of Object.entries(worker.metrics)) {
        const webName = metricNames[pythonName] ?? pythonName;
        const tolerance = Number.isInteger(value) ? 0 : pythonName.includes("dbfs")
          || pythonName.includes("seconds") || pythonName.includes("factor") ? 0.001 : 0.000001;
        expect(Math.abs(web.metrics[webName] - value), `${fixture.fixture.id}:${pythonName}`)
          .toBeLessThanOrEqual(tolerance);
      }
    }
  });
});

function buildWav(fixture: GoldenCase): Uint8Array {
  const samples: number[] = [];
  for (const segment of fixture.segments) {
    const frames = Math.round(segment.seconds * fixture.sampleRate);
    for (let frame = 0; frame < frames; frame += 1) {
      const sample = segment.kind === "silence" ? 0 : Math.round(
        Math.sin(2 * Math.PI * 440 * frame / fixture.sampleRate) * (segment.amplitudePcm ?? 0),
      );
      for (let channel = 0; channel < fixture.channels; channel += 1) samples.push(sample);
    }
  }
  const payloadBytes = 44 + samples.length * 2;
  const trailingBytes = fixture.mutation === "trailing_bytes" ? 5 : 0;
  const bytes = new Uint8Array(payloadBytes + trailingBytes);
  const view = new DataView(bytes.buffer);
  for (const [offset, value] of [[0, "RIFF"], [8, "WAVE"], [12, "fmt "], [36, "data"]] as const) {
    for (let index = 0; index < value.length; index += 1) bytes[offset + index] = value.charCodeAt(index);
  }
  const blockAlign = fixture.channels * 2;
  view.setUint32(4, payloadBytes - 8, true);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, fixture.channels, true);
  view.setUint32(24, fixture.sampleRate, true);
  view.setUint32(28, fixture.sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  view.setUint32(40, samples.length * 2, true);
  samples.forEach((sample, index) => view.setInt16(44 + index * 2, sample, true));
  if (trailingBytes > 0) bytes.set([1, 2, 3, 4, 5], payloadBytes);
  if (fixture.mutation === "riff_size") view.setUint32(4, 7, true);
  if (fixture.mutation === "riff_size_oversized") view.setUint32(4, bytes.length, true);
  if (fixture.mutation === "byte_rate") view.setUint32(28, 1, true);
  return bytes;
}

function runPythonGate(input: Array<{ expectedDuration: number; audioBase64: string }>) {
  const root = resolve(import.meta.dir, "../../..");
  const venvPython = resolve(root, "workers/music-engine/.venv/bin/python");
  const result = spawnSync(existsSync(venvPython) ? venvPython : "python3", [
    resolve(root, "workers/music-engine/tests/quality_gate_contract_runner.py"),
  ], {
    cwd: root,
    input: JSON.stringify(input),
    encoding: "utf8",
  });
  if (result.status !== 0) {
    const processError = result.error?.message;
    const details = [processError, result.stderr].filter(Boolean).join("\n");
    throw new Error(details || "Python quality Gate runner failed");
  }
  return JSON.parse(result.stdout) as MusicQualityGateResult[];
}
