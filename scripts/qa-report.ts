import { QA_ROUTE_CONTRACTS } from "@/lib/qa/qa-routes";

const webBase = (process.env.MURMUR_WEB_BASE_URL ?? "http://127.0.0.1:3000").replace(/\/+$/, "");
const acceptLanguage = process.env.MURMUR_SMOKE_ACCEPT_LANGUAGE ?? "zh-CN,zh;q=0.9";
const workerBase = (
  process.env.AUDIO_WORKER_URL?.trim() || "http://127.0.0.1:8001"
).replace(/\/+$/, "");
const localAuthHeaders = { "x-murmur-user-id": "qa_report" };

type CheckSummary = {
  name: string;
  ok: boolean;
  detail: string;
};

async function main() {
  const [qaHealth, workerHealth, pageChecks] = await Promise.all([
    fetchJson(`${webBase}/api/qa/health`, localAuthHeaders),
    fetchJson(`${workerBase}/health`),
    Promise.all(QA_ROUTE_CONTRACTS.map(checkRoute)),
  ]);

  const report = {
    capturedAt: new Date().toISOString(),
    webBase,
    workerBase,
    qaHealth,
    workerHealth,
    pageChecks,
    ok:
      qaHealth.ok &&
      workerHealth.ok &&
      pageChecks.every((check) => check.ok),
  };

  for (const check of pageChecks) {
    console.log(`${check.ok ? "PASS" : "FAIL"} ${check.name}: ${check.detail}`);
  }

  console.log(JSON.stringify(report, null, 2));

  if (!report.ok) {
    process.exitCode = 1;
  }
}

async function fetchJson(
  url: string,
  headers?: Record<string, string>,
): Promise<{ ok: boolean; status: number | null; body: unknown }> {
  try {
    const response = await fetch(url, { headers, redirect: "follow" });
    return {
      ok: response.ok,
      status: response.status,
      body: await response.json(),
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      body: { error: error instanceof Error ? error.message : String(error) },
    };
  }
}

async function checkRoute(
  route: (typeof QA_ROUTE_CONTRACTS)[number],
): Promise<CheckSummary> {
  try {
    const response = await fetch(`${webBase}${route.href}`, {
      headers: { "Accept-Language": acceptLanguage },
      redirect: "follow",
    });
    const html = await response.text();
    const gateMarkersMatched =
      (route.gateMarkers?.length ?? 0) > 0 &&
      route.gateMarkers.every((marker) => html.includes(marker));
    const gatedByStatus =
      route.okStatuses?.includes(response.status) &&
      response.status !== 200 &&
      (!route.gateMarkers || gateMarkersMatched);
    const gatedByShell = response.status === 200 && gateMarkersMatched;
    if (gatedByStatus || gatedByShell) {
      return {
        name: route.name,
        ok: true,
        detail: `status=${response.status} gated`,
      };
    }
    const missing = route.markers.filter((marker) => !html.includes(marker));
    const statusOk = route.okStatuses
      ? route.okStatuses.includes(response.status)
      : response.ok;
    return {
      name: route.name,
      ok: statusOk && missing.length === 0,
      detail:
        missing.length === 0
          ? `status=${response.status} markers=${route.markers.length}`
          : `status=${response.status} missing=${missing.join(", ")}`,
    };
  } catch (error) {
    return {
      name: route.name,
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

await main();
