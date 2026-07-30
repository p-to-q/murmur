interface VercelDeploymentInspection {
  id?: unknown;
  url?: unknown;
  target?: unknown;
  readyState?: unknown;
}

export function assertVercelDeployment(
  value: unknown,
  expectedId?: string,
): { id: string; url: string | null } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Vercel inspect output must be a JSON object");
  }

  const deployment = value as VercelDeploymentInspection;
  if (typeof deployment.id !== "string" || !deployment.id.trim()) {
    throw new Error("Vercel inspect output is missing deployment id");
  }
  if (deployment.readyState !== "READY") {
    throw new Error(
      `Vercel deployment ${deployment.id} is not READY: ${String(deployment.readyState)}`,
    );
  }
  if (deployment.target !== "production") {
    throw new Error(
      `Vercel deployment ${deployment.id} has unexpected target: ${String(deployment.target)}`,
    );
  }
  if (expectedId && deployment.id !== expectedId) {
    throw new Error(
      `Production alias resolves to ${deployment.id}, expected ${expectedId}`,
    );
  }

  return {
    id: deployment.id,
    url: typeof deployment.url === "string" ? deployment.url : null,
  };
}

if (import.meta.main) {
  const inputPath = process.argv[2]?.trim();
  const expectedId = process.argv[3]?.trim() || undefined;
  if (!inputPath) {
    throw new Error(
      "Usage: bun scripts/release-vercel-deployment.ts <inspect-json-path> [expected-deployment-id]",
    );
  }

  const inspection = JSON.parse(await Bun.file(inputPath).text()) as unknown;
  console.log(assertVercelDeployment(inspection, expectedId).id);
}
