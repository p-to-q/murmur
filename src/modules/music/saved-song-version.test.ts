import { describe, expect, it } from "bun:test";

import { buildSavedSongVibeVersions, hydrateSavedSongToVersion } from "./saved-song-version";

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

  it("generates fresh library versions that preserve saved-song melody intent", () => {
    const versions = buildSavedSongVibeVersions({
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

    expect(versions).toHaveLength(3);
    for (const version of versions) {
      expect(version.sourceType).toBe("library");
      expect(version.parentSongId).toBe("song_seed");
      expect(version.rootSongId).toBe("song_root");
      expect(version.lineageDepth).toBe(3);
      expect(version.sourceMelodyKind).toBe("intent");
      expect(version.draftId).not.toBe("song_seed");
      expect(version.originFlowId).toBe("saved-song_seed");
    }
  });

  it("anchors reworked songs to their current vibe when generating fresh versions", () => {
    const versions = buildSavedSongVibeVersions({
      id: "song_reworked",
      title: "Late Glass",
      vibe: "雨天",
      duration: 20,
      createdAt: "2026-06-05T12:00:00.000Z",
      rootSongId: "song_root",
      lineageDepth: 1,
      sourceMelodyKind: "musical",
      editCount: 5,
      editDepth: "reworked",
      visualConfig: {
        preset: "rain_glass",
        gradient: "linear-gradient(135deg, #A7B8C8, #D8DDD8, #FFFDF8)",
        particleDensity: 0.5,
        pulseSource: "energy",
      },
      arrangementState: {
        melody: {
          enabled: true,
          intensity: 0.8,
          originalPattern: "60 62 64",
          currentPattern: "60 62 64",
          instrument: "piano",
          versionHistory: [],
          melodyPitchSequence: [60, 62, 64],
        },
        chords: {
          enabled: true,
          intensity: 0.5,
          originalPattern: "gen:rain",
          currentPattern: "gen:rain",
          instrument: "felt_piano",
          versionHistory: [],
          chordsTag: "rain",
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
          texturePreset: "rain",
        },
      },
      bpm: 72,
      keySignature: "A",
    });

    expect(versions).toHaveLength(3);
    expect(versions[0]?.arrangementState.chords.chordsTag).toBe("rain");
    // Versions carry the vibe preset id (916e950); display labels come
    // from VIBE_PRESETS at render time.
    expect(versions[0]?.vibe).toBe("rain");
  });
});
