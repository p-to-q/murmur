import { QA_ROUTE_CONTRACTS } from "@/lib/qa/qa-routes";

const webBase = (process.env.MURMUR_WEB_BASE_URL ?? "http://127.0.0.1:3000").replace(/\/+$/, "");

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
    const response = await fetch(`${webBase}${route.href}`, { redirect: "follow" });
    const html = await response.text();
    const missing = route.markers.filter((marker) => !html.includes(marker));
    return {
      name: route.name,
      ok: response.ok && missing.length === 0,
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
