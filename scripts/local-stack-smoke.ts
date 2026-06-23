const webBase = (process.env.MURMUR_WEB_BASE_URL ?? "http://127.0.0.1:3000").replace(/\/+$/, "");
const workerBase = (
  process.env.AUDIO_WORKER_URL?.trim() || "http://127.0.0.1:8001"
).replace(/\/+$/, "");
const localAuthHeaders = { "x-murmur-user-id": "local_stack_smoke" };

export {};

type CheckResult = {
  name: string;
  ok: boolean;
  detail: string;
};

async function main() {
  const results: CheckResult[] = [];
  for (const check of [
    checkWebHome,
    checkUserBalance,
    checkTranscribeValidation,
    checkAudioWorkerHealth,
    checkQaHealth,
  ]) {
    results.push(await check());
  }
  const failed = results.filter((result) => !result.ok);

  for (const result of results) {
    console.log(`${result.ok ? "PASS" : "FAIL"} ${result.name}: ${result.detail}`);
  }

  if (failed.length > 0) {
    process.exitCode = 1;
    return;
  }

  console.log("Local stack smoke passed.");
}

async function checkWebHome(): Promise<CheckResult> {
  try {
    const response = await fetch(webBase, { redirect: "follow" });
    const html = await response.text();
    const hasMurmur = html.includes("Murmur");
    return {
      name: "web-home",
      ok: response.ok && hasMurmur,
      detail: `status=${response.status} murmurMarker=${hasMurmur}`,
    };
  } catch (error) {
    return {
      name: "web-home",
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

async function checkUserBalance(): Promise<CheckResult> {
  try {
    const response = await fetch(`${webBase}/api/user/balance`);
    const body = (await response.json()) as { notes?: unknown; planTier?: unknown };
    const validShape =
      typeof body.notes === "number" &&
      (body.planTier === "free" || body.planTier === "premium");
    return {
      name: "api-user-balance",
      ok: response.ok && validShape,
      detail: `status=${response.status} validShape=${validShape}`,
    };
  } catch (error) {
    return {
      name: "api-user-balance",
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

async function checkTranscribeValidation(): Promise<CheckResult> {
  try {
    const form = new FormData();
    const response = await fetch(`${webBase}/api/transcribe`, {
      method: "POST",
      body: form,
    });
    const body = (await response.json()) as { error?: unknown };
    const expected = response.status === 400 && body.error === "audio_required";
    return {
      name: "api-transcribe-validation",
      ok: expected,
      detail: `status=${response.status} error=${String(body.error ?? "unknown")}`,
    };
  } catch (error) {
    return {
      name: "api-transcribe-validation",
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

async function checkAudioWorkerHealth(): Promise<CheckResult> {
  try {
    const response = await fetch(`${workerBase}/health`);
    const body = (await response.json()) as { status?: unknown; service?: unknown };
    const expected = response.ok && body.status === "ok";
    return {
      name: "audio-worker-health",
      ok: expected,
      detail: `status=${response.status} service=${String(body.service ?? "unknown")}`,
    };
  } catch (error) {
    return {
      name: "audio-worker-health",
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

async function checkQaHealth(): Promise<CheckResult> {
  try {
    const response = await fetch(`${webBase}/api/qa/health`, {
      headers: localAuthHeaders,
    });
    const body = (await response.json()) as {
      status?: unknown;
      worker?: { ok?: unknown };
      qaRoutes?: unknown;
    };
    const validShape =
      (body.status === "ok" || body.status === "degraded") &&
      typeof body.worker?.ok === "boolean" &&
      Array.isArray(body.qaRoutes) &&
      body.qaRoutes.length >= 3;
    return {
      name: "api-qa-health",
      ok: response.ok && validShape,
      detail: `status=${response.status} validShape=${validShape}`,
    };
  } catch (error) {
    return {
      name: "api-qa-health",
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

await main();
