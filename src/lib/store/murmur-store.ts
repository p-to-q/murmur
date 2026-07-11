import { create } from "zustand";
import type { VibeVersion, VersionGeneration } from "@/modules/shared/types";
import { clearAllClipArtifacts } from "@/lib/store/generation-artifact-store";

export type RecordingState = "idle" | "recording" | "processing" | "done" | "error";
export type CreationRoute = "/vibe" | "/studio" | "/studio/name";

const DRAFT_STORAGE_KEY = "murmur-creation-draft-v1";
const DRAFT_STORAGE_VERSION = 1;

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

  // Playback state — which version card is being previewed
  auditioningVersionId: string | null;  // version card id being previewed
  setAuditioning: (versionId: string | null) => void;

  // Reset the recording flow (keeps gallery)
  resetFlow: () => void;
}

export type CreationRouteState = Pick<
  MurmurStore,
  "activeCreationRoute" | "currentVersion" | "vibeVersions"
>;

function isCreationRoute(value: unknown): value is CreationRoute {
  return value === "/vibe" || value === "/studio" || value === "/studio/name";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

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

export function prepareVersionForDraftStorage(version: VibeVersion): VibeVersion {
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

function writeDraftSnapshot(state: MurmurStore) {
  if (typeof window === "undefined") return;
  try {
    const payload = buildPersistedDraft(state);
    if (!payload) {
      window.localStorage.removeItem(DRAFT_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Storage can be unavailable in private modes; keep the in-memory flow alive.
  }
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readStoredDraft(): Partial<MurmurStore> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(DRAFT_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed) || parsed.version !== DRAFT_STORAGE_VERSION) {
      return {};
    }
    const state = parsed.state;
    if (!isRecord(state)) return {};
    const vibeVersions = Array.isArray(state.vibeVersions)
      ? (state.vibeVersions as VibeVersion[]).map(prepareVersionForDraftStorage)
      : [];
    const currentVersion = isRecord(state.currentVersion)
      ? prepareVersionForDraftStorage(state.currentVersion as VibeVersion)
      : null;
    if (vibeVersions.length === 0 && !currentVersion) return {};
    const activeCreationRoute = isCreationRoute(state.activeCreationRoute)
      ? state.activeCreationRoute
      : resolveRecoverableCreationRoute({
          activeCreationRoute: null,
          currentVersion,
          vibeVersions,
        });

    return {
      vibeVersions,
      currentVersion,
      currentDraftId: stringOrNull(state.currentDraftId),
      currentFlowId: stringOrNull(state.currentFlowId),
      activeCreationRoute,
      draftUpdatedAt:
        typeof state.draftUpdatedAt === "number" ? state.draftUpdatedAt : null,
      restoredDraftAt: Date.now(),
    };
  } catch {
    return {};
  }
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

    auditioningVersionId: null,
    setAuditioning: (versionId) => set({ auditioningVersionId: versionId }),

    resetFlow: () => {
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
      writeDraftSnapshot(get());
      // The flow's clips are no longer reachable — release their durable bytes.
      void clearAllClipArtifacts();
    },
  };
});
