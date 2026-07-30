import { create } from "zustand";
import type { VibeVersion, VersionGeneration } from "@/modules/shared/types";
import { sweepExpiredRecordingBlob } from "@/lib/audio/recording-cache";
import {
  clearAllClipArtifacts,
  sweepExpiredClipArtifacts,
} from "@/lib/store/generation-artifact-store";
import { parsePersistedDraft } from "@/lib/store/draft-schema";

export type RecordingState =
  "idle" | "recording" | "processing" | "done" | "error";
export type CreationRoute = "/vibe" | "/studio" | "/studio/name";

const DRAFT_STORAGE_KEY = "murmur-creation-draft-v1";
const DRAFT_STORAGE_VERSION = 1;
export const CREATION_DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1_000;

export type LocalCreationDataSweepArea =
  "last-recording" | "generation-clips" | "creation-draft";

export interface LocalCreationDataSweepResult {
  succeeded: LocalCreationDataSweepArea[];
  failed: LocalCreationDataSweepArea[];
}

type PersistedDraftPayload = {
  version: typeof DRAFT_STORAGE_VERSION;
  state: {
    vibeVersions: VibeVersion[];
    currentVersion: VibeVersion | null;
    currentDraftId: string | null;
    currentFlowId: string | null;
    activeCreationRoute: CreationRoute | null;
    draftUpdatedAt: number | null;
  };
};

interface MurmurStore {
  // Recording flow
  recordingState: RecordingState;
  setRecordingState: (s: RecordingState) => void;
  processingMessage: string;
  setProcessingMessage: (m: string) => void;

  // Generated versions
  vibeVersions: VibeVersion[];
  setVibeVersions: (v: VibeVersion[]) => void;

  // The trimmed hum recording for this flow — the Magenta engine blends its
  // style embedding into each generated clip so the hum keeps mattering.
  humStyleBlob: Blob | null;
  setHumStyleBlob: (b: Blob | null) => void;

  // Selected version for studio editing
  currentVersion: VibeVersion | null;
  setCurrentVersion: (v: VibeVersion | null) => void;
  currentDraftId: string | null;
  setCurrentDraftId: (id: string | null) => void;
  currentFlowId: string | null;
  setCurrentFlowId: (id: string | null) => void;
  activeCreationRoute: CreationRoute | null;
  setActiveCreationRoute: (route: CreationRoute | null) => void;
  draftUpdatedAt: number | null;
  restoredDraftAt: number | null;
  // True once the initial persisted-draft hydration pass has run. Screens gate
  // their empty-state redirect on this so a not-yet-restored store is never
  // mistaken for an empty one (#315).
  hasHydratedDraft: boolean;

  // Playback state — which version card is being previewed
  auditioningVersionId: string | null; // version card id being previewed
  setAuditioning: (versionId: string | null) => void;

  // Reset the recording flow (keeps gallery)
  resetFlow: () => Promise<boolean>;
}

export type CreationRouteState = Pick<
  MurmurStore,
  "activeCreationRoute" | "currentVersion" | "vibeVersions"
>;

function stripSessionAudio(
  generation: VersionGeneration | undefined,
): VersionGeneration | undefined {
  if (!generation) return undefined;
  // Browser blob URLs only live for the current tab session, so we always drop
  // audioUrl. But we PRESERVE status + the stable operation identity (#300): a
  // "ready" clip stays ready and is rehydrated from the durable artifact store
  // (or resumed via its operationId) on restore — never turned back into a
  // fresh pending clip that would be re-generated and re-charged.
  if (generation.status === "error") {
    return { ...generation, audioUrl: undefined };
  }
  return {
    ...generation,
    audioUrl: undefined,
    error: undefined,
    errorCode: undefined,
  };
}

export function prepareVersionForDraftStorage(
  version: VibeVersion,
): VibeVersion {
  return {
    ...version,
    generation: stripSessionAudio(version.generation),
  };
}

function hasDraftContent(state: CreationRouteState): boolean {
  return state.vibeVersions.length > 0 || state.currentVersion !== null;
}

export function resolveRecoverableCreationRoute(
  state: CreationRouteState,
): CreationRoute | null {
  if (!hasDraftContent(state)) return null;
  if (
    state.activeCreationRoute &&
    (state.activeCreationRoute === "/vibe" || state.currentVersion)
  ) {
    return state.activeCreationRoute;
  }
  if (state.currentVersion) return "/studio";
  return "/vibe";
}

export function getRecoverableCreationRoute(): CreationRoute | null {
  return resolveRecoverableCreationRoute(useMurmurStore.getState());
}

function buildPersistedDraft(state: MurmurStore): PersistedDraftPayload | null {
  if (!hasDraftContent(state)) return null;
  const draftUpdatedAt = Date.now();
  return {
    version: DRAFT_STORAGE_VERSION,
    state: {
      vibeVersions: state.vibeVersions.map(prepareVersionForDraftStorage),
      currentVersion: state.currentVersion
        ? prepareVersionForDraftStorage(state.currentVersion)
        : null,
      currentDraftId: state.currentDraftId,
      currentFlowId: state.currentFlowId,
      activeCreationRoute: resolveRecoverableCreationRoute(state),
      draftUpdatedAt,
    },
  };
}

function writeDraftSnapshot(state: MurmurStore): boolean {
  if (typeof window === "undefined") return false;
  try {
    const payload = buildPersistedDraft(state);
    if (!payload) {
      window.localStorage.removeItem(DRAFT_STORAGE_KEY);
      return true;
    }
    window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(payload));
    return true;
  } catch {
    // Storage can be unavailable in private modes; keep the in-memory flow alive.
    return false;
  }
}

function removeStoredDraft(): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.removeItem(DRAFT_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

export function sweepStoredCreationDraft(now = Date.now()): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = window.localStorage.getItem(DRAFT_STORAGE_KEY);
    if (!raw) return true;
    const parsed = parsePersistedDraft(JSON.parse(raw), DRAFT_STORAGE_VERSION);
    if (!parsed || isCreationDraftExpired(parsed.draftUpdatedAt, now)) {
      return removeStoredDraft();
    }
    return true;
  } catch {
    return removeStoredDraft();
  }
}

function readStoredDraft(): Partial<MurmurStore> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(DRAFT_STORAGE_KEY);
    if (!raw) return {};
    // Versioned runtime parse (#315): validate the envelope + every nested
    // version, dropping malformed ones instead of casting them into the store.
    const parsed = parsePersistedDraft(JSON.parse(raw), DRAFT_STORAGE_VERSION);
    if (!parsed) {
      removeStoredDraft();
      return {};
    }
    if (isCreationDraftExpired(parsed.draftUpdatedAt)) {
      removeStoredDraft();
      return {};
    }

    // Blob URLs never survive a reload; normalize the restored generations.
    const vibeVersions = parsed.vibeVersions.map(prepareVersionForDraftStorage);
    const currentVersion = parsed.currentVersion
      ? prepareVersionForDraftStorage(parsed.currentVersion)
      : null;
    if (vibeVersions.length === 0 && !currentVersion) return {};

    const activeCreationRoute =
      parsed.activeCreationRoute ??
      resolveRecoverableCreationRoute({
        activeCreationRoute: null,
        currentVersion,
        vibeVersions,
      });

    return {
      vibeVersions,
      currentVersion,
      currentDraftId: parsed.currentDraftId,
      currentFlowId: parsed.currentFlowId,
      activeCreationRoute,
      draftUpdatedAt: parsed.draftUpdatedAt,
      restoredDraftAt: Date.now(),
    };
  } catch {
    removeStoredDraft();
    return {};
  }
}

/**
 * Sweep recoverable browser data at the client module boundary. TTLs are
 * enforced on the next startup/visit; this does not promise deletion while the
 * browser is closed. Every area is attempted and the result remains observable.
 */
export async function sweepExpiredLocalCreationData(
  now = Date.now(),
): Promise<LocalCreationDataSweepResult> {
  if (typeof window === "undefined") {
    return {
      succeeded: [],
      failed: ["last-recording", "generation-clips", "creation-draft"],
    };
  }

  const tasks: Array<
    readonly [LocalCreationDataSweepArea, () => boolean | Promise<boolean>]
  > = [
    ["last-recording", () => sweepExpiredRecordingBlob(now)],
    ["generation-clips", () => sweepExpiredClipArtifacts(now)],
    ["creation-draft", () => sweepStoredCreationDraft(now)],
  ];
  const settled = await Promise.allSettled(
    tasks.map(([, task]) => Promise.resolve().then(task)),
  );
  const result: LocalCreationDataSweepResult = { succeeded: [], failed: [] };
  settled.forEach((entry, index) => {
    const area = tasks[index]?.[0];
    if (!area) return;
    if (entry.status === "fulfilled" && entry.value) {
      result.succeeded.push(area);
    } else {
      result.failed.push(area);
    }
  });
  return result;
}

export function isCreationDraftExpired(
  updatedAt: number | null,
  now = Date.now(),
): boolean {
  return (
    updatedAt == null ||
    updatedAt <= 0 ||
    updatedAt <= now - CREATION_DRAFT_TTL_MS
  );
}

const restoredDraft = readStoredDraft();

export const useMurmurStore = create<MurmurStore>((set, get) => {
  const setDraftState = (patch: Partial<MurmurStore>) => {
    set({ ...patch, draftUpdatedAt: Date.now() });
    writeDraftSnapshot(get());
  };

  return {
    recordingState: "idle",
    setRecordingState: (s) => set({ recordingState: s }),
    processingMessage: "",
    setProcessingMessage: (m) => set({ processingMessage: m }),

    vibeVersions: restoredDraft.vibeVersions ?? [],
    setVibeVersions: (v) => setDraftState({ vibeVersions: v }),

    humStyleBlob: null,
    setHumStyleBlob: (b) => set({ humStyleBlob: b }),

    currentVersion: restoredDraft.currentVersion ?? null,
    setCurrentVersion: (v) => setDraftState({ currentVersion: v }),
    currentDraftId: restoredDraft.currentDraftId ?? null,
    setCurrentDraftId: (id) => setDraftState({ currentDraftId: id }),
    currentFlowId: restoredDraft.currentFlowId ?? null,
    setCurrentFlowId: (id) => setDraftState({ currentFlowId: id }),
    activeCreationRoute: restoredDraft.activeCreationRoute ?? null,
    setActiveCreationRoute: (route) =>
      setDraftState({ activeCreationRoute: route }),
    draftUpdatedAt: restoredDraft.draftUpdatedAt ?? null,
    restoredDraftAt: restoredDraft.restoredDraftAt ?? null,
    // readStoredDraft has already run synchronously above, so restoration is
    // complete by the time any screen mounts.
    hasHydratedDraft: true,

    auditioningVersionId: null,
    setAuditioning: (versionId) => set({ auditioningVersionId: versionId }),

    resetFlow: async () => {
      set({
        recordingState: "idle",
        vibeVersions: [],
        humStyleBlob: null,
        currentVersion: null,
        currentDraftId: null,
        currentFlowId: null,
        activeCreationRoute: null,
        draftUpdatedAt: null,
        restoredDraftAt: null,
        processingMessage: "",
        auditioningVersionId: null,
      });
      const draftCleared = writeDraftSnapshot(get());
      // The flow's clips are no longer reachable — release their durable bytes.
      const clipsCleared = await clearAllClipArtifacts();
      return draftCleared && clipsCleared;
    },
  };
});

if (typeof window !== "undefined") {
  void sweepExpiredLocalCreationData();
}
