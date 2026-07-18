const repository = process.env.GITHUB_REPOSITORY?.trim();
const releaseSha = process.env.RELEASE_SHA?.trim();
const token = process.env.GH_TOKEN?.trim();

if (!repository || !releaseSha || !token || !/^[0-9a-f]{40}$/i.test(releaseSha)) {
  throw new Error("GITHUB_REPOSITORY, GH_TOKEN, and a full RELEASE_SHA are required");
}

async function github(path: string) {
  const response = await fetch(`https://api.github.com/repos/${repository}${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "murmur-release-gate",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`GitHub ${path} returned ${response.status}`);
  }
  return response.json() as Promise<Record<string, unknown>>;
}

const branch = await github("/branches/main");
const branchCommit = (branch.commit as { sha?: string } | undefined)?.sha;
if (branchCommit !== releaseSha) {
  throw new Error(`Refusing stale release: main is ${branchCommit}, requested ${releaseSha}`);
}

const ciRunId = process.env.CI_RUN_ID?.trim();
if (ciRunId) {
  const run = await github(`/actions/runs/${ciRunId}`);
  if (run.conclusion !== "success" || run.head_sha !== releaseSha) {
    throw new Error(`CI run ${ciRunId} did not succeed for ${releaseSha}`);
  }
} else {
  const runs = await github(`/actions/workflows/ci.yml/runs?branch=main&head_sha=${releaseSha}&per_page=20`);
  const matching = (runs.workflow_runs as Array<Record<string, unknown>> | undefined)?.find(
    (run) => run.head_sha === releaseSha && run.conclusion === "success",
  );
  if (!matching) {
    throw new Error(`No successful CI workflow exists for ${releaseSha}`);
  }
}

console.log(`Release gate passed for main at ${releaseSha}`);
