import { APP_BUILD, APP_VERSION } from "./release-metadata";

export function getReleaseIdentity() {
  return {
    version: process.env.NEXT_PUBLIC_APP_VERSION ?? APP_VERSION,
    build: process.env.NEXT_PUBLIC_APP_BUILD ?? APP_BUILD,
    sha: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ?? "local",
  };
}

export function getAppVersionParts() {
  const identity = getReleaseIdentity();

  return {
    semver: identity.version,
    build: identity.build,
    gitSha: identity.sha.slice(0, 7),
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
