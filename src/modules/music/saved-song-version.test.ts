import { describe, expect, it } from "bun:test";

import {
  buildSavedSongEditDraft,
  hydrateSavedSongToVersion,
} from "./saved-song-version";

describe("hydrateSavedSongToVersion", () => {
  it("preserves saved melody origin and prefers typed pitch sequence", () => {
    const version = hydrateSavedSongToVersion({
      id: "song_saved",
      title: "Soft Return",
      vibe: "雨天",
      duration: 18,
      createdAt: "2026-06-05T12:00:00.000Z",
      parentSongId: "song_parent",
      rootSongId: "song_root",
      lineageDepth: 1,
      sourceMelodyKind: "musical",
      visualConfig: {
        preset: "warm_particles",
        gradient: "linear-gradient(135deg, #FF8A5C, #FF5924)",
        particleDensity: 0.72,
        pulseSource: "melody",
      },
      arrangementState: {
        melody: {
          enabled: true,
          intensity: 0.8,
          originalPattern: "60 61 62",
          currentPattern: "60 61 62",
          instrument: "piano",
          versionHistory: [],
          melodyPitchSequence: [64, 67, 69],
        },
        chords: {
          enabled: true,
          intensity: 0.6,
          originalPattern: "gen:rain",
          currentPattern: "gen:rain",
          instrument: "felt_piano",
          versionHistory: [],
        },
        strings: {
          enabled: false,
          intensity: 0.2,
          originalPattern: "pad",
          currentPattern: "pad",
          instrument: "string_ensemble",
          versionHistory: [],
        },
        drums: {
          enabled: false,
          intensity: 0.1,
          originalPattern: "brush",
          currentPattern: "brush",
          instrument: "brush_kit",
          versionHistory: [],
        },
        bass: {
          enabled: true,
          intensity: 0.4,
          originalPattern: "root",
          currentPattern: "root",
          instrument: "upright_bass",
          versionHistory: [],
        },
        texture: {
          enabled: true,
          intensity: 0.25,
          originalPattern: "air",
          currentPattern: "air",
          instrument: "vinyl_noise",
          versionHistory: [],
        },
      },
      bpm: 96,
      keySignature: "G",
    });

    expect(version.sourceType).toBe("library");
    expect(version.parentSongId).toBe("song_parent");
    expect(version.rootSongId).toBe("song_root");
    expect(version.lineageDepth).toBe(1);
    expect(version.sourceMelodyKind).toBe("musical");
    expect(version.melody.notes.map((note) => note.pitch)).toEqual([64, 67, 69]);
    expect(version.melody.bpm).toBe(96);
    expect(version.melody.key).toBe("G");
    expect(version.melody.contour).toBe("rising");
  });

  it("falls back to the legacy melody pattern and corrected mode", () => {
    const version = hydrateSavedSongToVersion({
      id: "song_legacy",
      title: "Day Sketch",
      vibe: "sunset",
      duration: 12,
      createdAt: "2026-06-05T12:00:00.000Z",
      visualConfig: {
        preset: "soft_gradient",
        gradient: "linear-gradient(135deg, #f6d365, #fda085)",
        particleDensity: 0.5,
        pulseSource: "energy",
      },
      arrangementState: {
        melody: {
          enabled: true,
          intensity: 0.8,
          originalPattern: "60 64 62",
          currentPattern: "60 64 62",
          instrument: "piano",
          versionHistory: [],
        },
        chords: {
          enabled: true,
          intensity: 0.5,
          originalPattern: "gen:sunset",
          currentPattern: "gen:sunset",
          instrument: "felt_piano",
          versionHistory: [],
        },
        strings: {
          enabled: false,
          intensity: 0.2,
          originalPattern: "pad",
          currentPattern: "pad",
          instrument: "string_ensemble",
          versionHistory: [],
        },
        drums: {
          enabled: false,
          intensity: 0.2,
          originalPattern: "none",
          currentPattern: "none",
          instrument: "brush_kit",
          versionHistory: [],
        },
        bass: {
          enabled: true,
          intensity: 0.3,
          originalPattern: "root",
          currentPattern: "root",
          instrument: "upright_bass",
          versionHistory: [],
        },
        texture: {
          enabled: true,
          intensity: 0.3,
          originalPattern: "dust",
          currentPattern: "dust",
          instrument: "vinyl_noise",
          versionHistory: [],
        },
      },
    });

    expect(version.sourceMelodyKind).toBe("corrected");
    expect(version.melody.notes.map((note) => note.pitch)).toEqual([60, 64, 62]);
    expect(version.melody.contour).toBe("wave");
    expect(version.melody.scale).toBe("major");
  });

  it("creates a fresh editable draft when reopening a saved song", () => {
    const version = buildSavedSongEditDraft({
      id: "song_seed",
      title: "Afterglow",
      vibe: "sunset",
      duration: 15,
      createdAt: "2026-06-05T12:00:00.000Z",
      rootSongId: "song_root",
      lineageDepth: 2,
      sourceMelodyKind: "intent",
      visualConfig: {
        preset: "soft_gradient",
        gradient: "linear-gradient(135deg, #f6d365, #fda085)",
        particleDensity: 0.5,
        pulseSource: "energy",
      },
      arrangementState: {
        melody: {
          enabled: true,
          intensity: 0.8,
          originalPattern: "60 64 67",
          currentPattern: "60 64 67",
          instrument: "piano",
          versionHistory: [],
          melodyPitchSequence: [60, 64, 67],
        },
        chords: {
          enabled: true,
          intensity: 0.5,
          originalPattern: "gen:sunset",
          currentPattern: "gen:sunset",
          instrument: "felt_piano",
          versionHistory: [],
        },
        strings: {
          enabled: false,
          intensity: 0.2,
          originalPattern: "pad",
          currentPattern: "pad",
          instrument: "string_ensemble",
          versionHistory: [],
        },
        drums: {
          enabled: false,
          intensity: 0.2,
          originalPattern: "none",
          currentPattern: "none",
          instrument: "brush_kit",
          versionHistory: [],
        },
        bass: {
          enabled: true,
          intensity: 0.3,
          originalPattern: "root",
          currentPattern: "root",
          instrument: "upright_bass",
          versionHistory: [],
        },
        texture: {
          enabled: true,
          intensity: 0.3,
          originalPattern: "dust",
          currentPattern: "dust",
          instrument: "vinyl_noise",
          versionHistory: [],
        },
      },
      bpm: 88,
      keySignature: "C",
    });

    expect(version.id).not.toBe("saved-song_seed");
    expect(version.draftId).not.toBe("song_seed");
    expect(version.originFlowId).not.toBe(`saved-song_seed`);
    expect(version.originFlowId).not.toBe(version.draftId);
    expect(version.parentSongId).toBe("song_seed");
    expect(version.rootSongId).toBe("song_root");
    expect(version.lineageDepth).toBe(3);
    expect(version.sourceType).toBe("library");
    expect(version.sourceMelodyKind).toBe("intent");
    expect(version.melody.notes.map((note) => note.pitch)).toEqual([60, 64, 67]);
  });

});
