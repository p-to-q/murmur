interface PullRequestSnapshot {
  number?: number;
  state?: string;
  merged_at?: string | null;
  merge_commit_sha?: string | null;
  base?: { ref?: string };
  head?: { ref?: string; sha?: string };
}

interface StatusSnapshot {
  statuses?: Array<{
    context?: string;
    state?: string;
    target_url?: string | null;
  }>;
}

interface CommitSnapshot {
  commit?: { tree?: { sha?: string } };
}

interface VercelDeploymentSnapshot {
  id?: string;
  name?: string;
  readyState?: string;
  target?: string | null;
  meta?: Record<string, unknown>;
}

export function deploymentIdFromVercelStatus(input: {
  statuses: StatusSnapshot;
  expectedScope: string;
  expectedProject: string;
}): string | null {
  const vercel = input.statuses.statuses?.filter((status) => status.context === "Vercel") ?? [];
  if (vercel.length !== 1 || vercel[0]?.state !== "success" || !vercel[0].target_url) {
    return null;
  }
  try {
    const url = new URL(vercel[0].target_url);
    const parts = url.pathname.split("/").filter(Boolean);
    if (
      url.protocol !== "https:"
      || url.hostname !== "vercel.com"
      || parts.length !== 3
      || parts[0] !== input.expectedScope
      || parts[1] !== input.expectedProject
      || !/^[A-Za-z0-9]+$/.test(parts[2])
    ) {
      return null;
    }
    return `dpl_${parts[2]}`;
  } catch {
    return null;
  }
}

export function collectPreviewProvenanceIssues(input: {
  pullRequest: PullRequestSnapshot;
  statuses: StatusSnapshot;
  previewCommit: CommitSnapshot;
  releaseCommit: CommitSnapshot;
  deployment: VercelDeploymentSnapshot | null;
  expectedPr: number;
  expectedBranch: string;
  expectedPreviewSha: string;
  expectedReleaseSha: string;
  expectedScope: string;
  expectedProject: string;
}): string[] {
  const issues: string[] = [];
  const pr = input.pullRequest;
  if (pr.number !== input.expectedPr) issues.push("Preview PR number mismatch");
  if (pr.state !== "closed" || !pr.merged_at) issues.push("Preview PR must be merged");
  if (pr.base?.ref !== "main") issues.push("Preview PR must target main");
  if (pr.head?.ref !== input.expectedBranch) issues.push("Preview PR branch mismatch");
  if (pr.head?.sha !== input.expectedPreviewSha) issues.push("Preview PR head SHA mismatch");
  if (pr.merge_commit_sha !== input.expectedReleaseSha) {
    issues.push("Preview PR merge commit does not equal the release SHA");
  }
  const previewTree = input.previewCommit.commit?.tree?.sha;
  const releaseTree = input.releaseCommit.commit?.tree?.sha;
  if (!previewTree || !releaseTree || previewTree !== releaseTree) {
    issues.push("Preview and release commits must have identical Git trees");
  }
  const deploymentId = deploymentIdFromVercelStatus({
    statuses: input.statuses,
    expectedScope: input.expectedScope,
    expectedProject: input.expectedProject,
  });
  if (!deploymentId) {
    issues.push("Preview SHA must have one successful Vercel deployment status");
  } else {
    const deployment = input.deployment;
    const metadata = deployment?.meta ?? {};
    if (
      deployment?.id !== deploymentId
      || deployment.name !== input.expectedProject
      || deployment.readyState !== "READY"
      || (deployment.target != null && deployment.target !== "preview")
      || metadata.githubCommitSha !== input.expectedPreviewSha
      || metadata.githubCommitRef !== input.expectedBranch
    ) {
      issues.push("Vercel Preview deployment identity, readiness, or Git metadata mismatch");
    }
  }
  return issues;
}

async function github(
  repository: string,
  path: string,
  token: string,
): Promise<Record<string, unknown>> {
  const response = await fetch(`https://api.github.com/repos/${repository}${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "murmur-release-preview-gate",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`GitHub ${path} returned ${response.status}`);
  return response.json() as Promise<Record<string, unknown>>;
}

async function vercel(
  deploymentId: string,
  token: string,
  scope: string,
): Promise<Record<string, unknown>> {
  const url = new URL(`https://api.vercel.com/v13/deployments/${deploymentId}`);
  url.searchParams.set("slug", scope);
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Vercel deployment inspection returned ${response.status}`);
  return response.json() as Promise<Record<string, unknown>>;
}

if (import.meta.main) {
  const repository = process.env.GITHUB_REPOSITORY?.trim();
  const token = process.env.GH_TOKEN?.trim();
  const vercelToken = process.env.VERCEL_TOKEN?.trim();
  const expectedScope = process.env.VERCEL_SCOPE?.trim();
  const expectedProject = process.env.VERCEL_PROJECT_NAME?.trim();
  const expectedPr = Number(process.env.PREVIEW_PR);
  const expectedBranch = process.env.PREVIEW_BRANCH?.trim();
  const expectedPreviewSha = process.env.PREVIEW_SHA?.trim();
  const expectedReleaseSha = process.env.RELEASE_SHA?.trim();
  if (
    !repository
    || !token
    || !vercelToken
    || !expectedScope
    || !expectedProject
    || !Number.isSafeInteger(expectedPr)
    || expectedPr < 1
    || !expectedBranch
    || !expectedPreviewSha
    || !expectedReleaseSha
    || !/^[0-9a-f]{40}$/i.test(expectedPreviewSha)
    || !/^[0-9a-f]{40}$/i.test(expectedReleaseSha)
  ) {
    throw new Error(
      "GitHub/Vercel identity, credentials, Preview PR/branch/full SHA, and release full SHA are required",
    );
  }
  const [pullRequest, statuses, previewCommit, releaseCommit] = await Promise.all([
    github(repository, `/pulls/${expectedPr}`, token),
    github(repository, `/commits/${expectedPreviewSha}/status`, token),
    github(repository, `/commits/${expectedPreviewSha}`, token),
    github(repository, `/commits/${expectedReleaseSha}`, token),
  ]);
  const deploymentId = deploymentIdFromVercelStatus({
    statuses: statuses as StatusSnapshot,
    expectedScope,
    expectedProject,
  });
  const deployment = deploymentId
    ? await vercel(deploymentId, vercelToken, expectedScope)
    : null;
  const issues = collectPreviewProvenanceIssues({
    pullRequest: pullRequest as PullRequestSnapshot,
    statuses: statuses as StatusSnapshot,
    previewCommit: previewCommit as CommitSnapshot,
    releaseCommit: releaseCommit as CommitSnapshot,
    deployment: deployment as VercelDeploymentSnapshot | null,
    expectedPr,
    expectedBranch,
    expectedPreviewSha,
    expectedReleaseSha,
    expectedScope,
    expectedProject,
  });
  if (issues.length > 0) {
    console.error("Preview provenance failed:");
    for (const issue of issues) console.error(`  - ${issue}`);
    process.exit(1);
  }
  console.log(
    `Preview provenance passed for PR #${expectedPr} at ${expectedPreviewSha}; merged as ${expectedReleaseSha}.`,
  );
}
