import { APP_BUILD } from "./release-metadata";

export function getAppVersionParts() {
  const gitSha = (
    process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ?? "local"
  ).slice(0, 7);

  return {
    semver: process.env.NEXT_PUBLIC_APP_VERSION ?? "0.6.0",
    build: process.env.NEXT_PUBLIC_APP_BUILD ?? APP_BUILD,
    gitSha,
  };
}

export function formatAppVersion(developerMode: boolean): string {
  const { semver, build, gitSha } = getAppVersionParts();
  if (developerMode) {
    return `v${semver} · build ${build} · ${gitSha}`;
  }
  return `v${semver} · ${build}`;
}

/** Structured release identifier for logs and support tooling. */
export function formatReleaseIdentifier(): string {
  const { semver, build, gitSha } = getAppVersionParts();
  return `${semver}+build.${build}.${gitSha}`;
}
