export const TRANSCRIPTION_PROVIDER_IDS = [
  "auto",
  "remote-python",
  "browser-yin",
  "browser-basic-pitch",
  "fixture",
] as const;

export type TranscriptionProviderId =
  (typeof TRANSCRIPTION_PROVIDER_IDS)[number];

export type RuntimeProviderStatus = {
  id: Exclude<TranscriptionProviderId, "auto">;
  enabled: boolean;
  reason?: string;
};

export function getConfiguredTranscriptionProvider(): TranscriptionProviderId {
  const configured = process.env.NEXT_PUBLIC_TRANSCRIPTION_PROVIDER;

  if (
    configured === "auto" ||
    configured === "remote-python" ||
    configured === "browser-yin" ||
    configured === "browser-basic-pitch" ||
    configured === "fixture"
  ) {
    return configured;
  }

  return "auto";
}

export function isRemotePythonConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_REMOTE_PYIN_WORKER_URL?.trim() ||
      process.env.NEXT_PUBLIC_BASIC_PITCH_WORKER_URL?.trim(),
  );
}

export function getRemotePythonWorkerUrl(): string | null {
  return (
    process.env.NEXT_PUBLIC_REMOTE_PYIN_WORKER_URL?.trim() ||
    process.env.NEXT_PUBLIC_BASIC_PITCH_WORKER_URL?.trim() ||
    null
  );
}

export function isBrowserBasicPitchEnabled(): boolean {
  return process.env.NEXT_PUBLIC_ENABLE_BASIC_PITCH_BROWSER === "true";
}

export function getProviderStatuses(): RuntimeProviderStatus[] {
  return [
    {
      id: "remote-python",
      enabled: isRemotePythonConfigured(),
      reason: isRemotePythonConfigured()
        ? undefined
        : "missing NEXT_PUBLIC_BASIC_PITCH_WORKER_URL",
    },
    {
      id: "browser-yin",
      enabled: true,
    },
    {
      id: "browser-basic-pitch",
      enabled: isBrowserBasicPitchEnabled(),
      reason: isBrowserBasicPitchEnabled()
        ? undefined
        : "NEXT_PUBLIC_ENABLE_BASIC_PITCH_BROWSER=false",
    },
    {
      id: "fixture",
      enabled: true,
    },
  ];
}

export function getResolvedProviderOrder(
  configured: TranscriptionProviderId,
): RuntimeProviderStatus[] {
  const byId = new Map(
    getProviderStatuses().map((status) => [status.id, status] as const),
  );

  const pick = (
    ids: Array<Exclude<TranscriptionProviderId, "auto">>,
  ): RuntimeProviderStatus[] =>
    ids
      .map((id) => byId.get(id))
      .filter((status): status is RuntimeProviderStatus => Boolean(status))
      .filter((status) => status.enabled);

  switch (configured) {
    case "remote-python":
      return pick([
        "remote-python",
        "browser-yin",
        "browser-basic-pitch",
        "fixture",
      ]);
    case "browser-yin":
      return pick([
        "browser-yin",
        "remote-python",
        "browser-basic-pitch",
        "fixture",
      ]);
    case "browser-basic-pitch":
      return pick([
        "browser-basic-pitch",
        "browser-yin",
        "remote-python",
        "fixture",
      ]);
    case "fixture":
      return pick(["fixture"]);
    case "auto":
    default:
      return pick([
        "remote-python",
        "browser-yin",
        "browser-basic-pitch",
        "fixture",
      ]);
  }
}

export function getRuntimeStatusLabel(): string {
  const configured = getConfiguredTranscriptionProvider();
  const order = getResolvedProviderOrder(configured);
  const chain = order.map((status) => status.id).join(" -> ");
  return `${configured}: ${chain}`;
}
