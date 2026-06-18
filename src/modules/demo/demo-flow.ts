import { selectGenerationMelody } from "@/modules/music/humming-engine";
import { generateVibeVersions } from "@/modules/strummer/generate-versions";
import { buildFixtureTranscriptionResult } from "@/modules/stainer/providers/fixture";
import type { VibeVersion } from "@/modules/shared/types";
import type { VibeId } from "@/presets/vibes";

export type DemoMelodyId = "moonstairs" | "sunhop" | "rainwindow";

export type DemoMelodyPreset = {
  id: DemoMelodyId;
  fixtureIndex: number;
  preferredVibeId: VibeId;
  title: { zh: string; en: string };
  detail: { zh: string; en: string };
};

export const DEMO_MELODY_PRESETS: DemoMelodyPreset[] = [
  {
    id: "moonstairs",
    fixtureIndex: 0,
    preferredVibeId: "cinematic",
    title: { zh: "月台阶", en: "Moonstairs" },
    detail: { zh: "小调上行，适合电影感", en: "Minor lift, cinematic" },
  },
  {
    id: "sunhop",
    fixtureIndex: 1,
    preferredVibeId: "party",
    title: { zh: "晴天跳步", en: "Sunhop" },
    detail: { zh: "明亮跳跃，适合律动", en: "Bright steps, rhythmic" },
  },
  {
    id: "rainwindow",
    fixtureIndex: 3,
    preferredVibeId: "rain",
    title: { zh: "雨窗", en: "Rainwindow" },
    detail: { zh: "慢速抒情，适合雨声", en: "Slow line, rainy" },
  },
];

export type DemoFlowState = {
  draftId: string;
  flowId: string;
  versions: VibeVersion[];
  currentVersion: VibeVersion;
  preset: DemoMelodyPreset;
};

type DemoFlowOptions = {
  demoId?: DemoMelodyId;
  random?: boolean;
};

function pickDemoPreset(options: DemoFlowOptions = {}): DemoMelodyPreset {
  if (options.random) {
    const index = Math.floor(Math.random() * DEMO_MELODY_PRESETS.length);
    return DEMO_MELODY_PRESETS[index] ?? DEMO_MELODY_PRESETS[0]!;
  }

  return (
    DEMO_MELODY_PRESETS.find((preset) => preset.id === options.demoId) ??
    DEMO_MELODY_PRESETS[0]!
  );
}

function buildDemoMelodyContext(options: DemoFlowOptions = {}) {
  const preset = pickDemoPreset(options);
  const result = buildFixtureTranscriptionResult(preset.fixtureIndex);
  const selectedMelody = selectGenerationMelody(result, { repairBias: 0 });
  const instanceId = crypto.randomUUID();
  const draftId = `demo-${preset.id}-${instanceId}`;
  const flowId = `demo-flow-${preset.id}-${instanceId}`;
  return { preset, selectedMelody, draftId, flowId };
}

/** Backend-free demo scaffold: fixture melody plus local arrangement result. */
export function buildDemoFlowState(
  options: DemoFlowOptions = {},
): DemoFlowState {
  const { preset, selectedMelody, draftId, flowId } =
    buildDemoMelodyContext(options);
  const versions = generateVibeVersions(selectedMelody.melody, {
    draftId,
    originFlowId: flowId,
    sourceType: "demo",
    sourceMelodyKind: selectedMelody.kind,
    preferredVibeId: preset.preferredVibeId,
    preferredVibeMode: "anchor",
  });
  const taggedVersions = versions.map((version) => ({
    ...version,
    tags: ["demo", preset.id, ...version.tags],
  }));

  return {
    draftId,
    flowId,
    versions: taggedVersions,
    currentVersion: taggedVersions[0]!,
    preset,
  };
}

/** Runtime compatibility wrapper for route-level demo hydration. */
export async function buildDemoFlowStateAsync(
  options: DemoFlowOptions = {},
): Promise<DemoFlowState> {
  return buildDemoFlowState(options);
}
