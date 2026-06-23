import { QA_ROUTE_CONTRACTS } from "@/lib/qa/qa-routes";

const webBase = (process.env.MURMUR_WEB_BASE_URL ?? "http://127.0.0.1:3000").replace(/\/+$/, "");
const acceptLanguage = process.env.MURMUR_SMOKE_ACCEPT_LANGUAGE ?? "zh-CN,zh;q=0.9";
const localAuthHeaders = { "x-murmur-user-id": "local_stack_smoke" };

type CheckResult = {
  name: string;
  ok: boolean;
  detail: string;
};

async function main() {
  const results = await Promise.all(QA_ROUTE_CONTRACTS.map(checkRoute));
  const failed = results.filter((result) => !result.ok);

  for (const result of results) {
    console.log(`${result.ok ? "PASS" : "FAIL"} ${result.name}: ${result.detail}`);
  }

  if (failed.length > 0) {
    process.exitCode = 1;
    return;
  }

  console.log("Page contract smoke passed.");
}

async function checkRoute(route: (typeof QA_ROUTE_CONTRACTS)[number]): Promise<CheckResult> {
  try {
    const headers = new Headers({ "Accept-Language": acceptLanguage });
    if (route.href.startsWith("/me/debug")) {
      for (const [name, value] of Object.entries(localAuthHeaders)) {
        headers.set(name, value);
      }
    }

    const response = await fetch(`${webBase}${route.href}`, {
      headers,
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
