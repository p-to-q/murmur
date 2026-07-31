import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

const workflow = readFileSync(
  path.join(import.meta.dir, "../.github/workflows/migrate.yml"),
  "utf8",
);

describe("production release workflow ordering", () => {
  test("proves real audio before promotion and retains alias verification", () => {
    const previous = workflow.indexOf("Capture the currently serving Production deployment");
    const immutableAudio = workflow.indexOf(
      "Smoke immutable deployment identity and real audio delivery",
    );
    const promote = workflow.indexOf("Promote verified deployment to Production");
    const aliasAudio = workflow.indexOf("Smoke production alias");

    expect(previous).toBeGreaterThan(-1);
    expect(immutableAudio).toBeGreaterThan(previous);
    expect(promote).toBeGreaterThan(immutableAudio);
    expect(aliasAudio).toBeGreaterThan(promote);
    expect(workflow.slice(immutableAudio, promote)).toContain("--require-audio");
    expect(workflow.slice(immutableAudio, promote)).toContain("--require-worker-canary");
    expect(workflow.slice(aliasAudio)).toContain("--require-audio");
    expect(workflow.slice(aliasAudio)).not.toContain("--require-worker-canary");
  });

  test("rolls a failed cutover back to the captured deployment", () => {
    expect(workflow).toContain("steps.previous.outputs.deployment_id");
    expect(workflow).toContain('rollback "$PREVIOUS_DEPLOYMENT_ID"');
    expect(workflow).toContain('test "$restored" = "true"');
    expect(workflow).toContain("steps.alias_smoke.outcome == 'failure'");
    expect(workflow).toContain("cancelled()");
    expect(workflow).toContain("Require successful Production cutover");
    expect(workflow).toContain('if [ "$current_deployment_id" = "$PREVIOUS_DEPLOYMENT_ID" ]');
    expect(workflow).toContain("rollback is unnecessary");
  });

  test("fails before migration when fixed audio smoke fixtures are absent", () => {
    const validate = workflow.indexOf("Validate protected release configuration");
    const migrate = workflow.indexOf("Apply production migrations");
    const validationBlock = workflow.slice(validate, migrate);

    expect(validate).toBeGreaterThan(-1);
    expect(migrate).toBeGreaterThan(validate);
    expect(validationBlock).toContain("MURMUR_SMOKE_SHARE_CODE");
    expect(validationBlock).toContain("MURMUR_SMOKE_SONG_ID");
    expect(validationBlock).toContain("MURMUR_SMOKE_SESSION_TOKEN");
  });

  test("rechecks approved resources before the first production write", () => {
    const recheck = workflow.indexOf("Re-prove approved database before mutation");
    const migrate = workflow.indexOf("Apply production migrations");
    const recheckBlock = workflow.slice(recheck, migrate);

    expect(recheck).toBeGreaterThan(-1);
    expect(migrate).toBeGreaterThan(recheck);
    expect(recheckBlock).toContain("needs.evidence.outputs.database_resource_id");
    expect(recheckBlock).toContain("release-database-preflight.ts");
    expect(recheckBlock).toContain("Re-prove approved Vercel resources before mutation");
    expect(recheckBlock).toContain("release-vercel-project.ts");
    expect(recheckBlock).toContain("Re-prove migration writer identity before its first write");
    expect(recheckBlock).toContain("MURMUR_RELEASE_DATABASE_MIGRATION_URL_UNPOOLED");
    expect(recheckBlock).toContain("Re-attest approved music Worker before mutation");
    expect(recheckBlock).toContain("release-music-provider-canary.ts");
  });

  test("rechecks provider revision and Vercel fingerprint at the deployment boundary", () => {
    const capture = workflow.indexOf("Capture the currently serving Production deployment");
    const worker = workflow.indexOf("Re-attest approved music Worker immediately before deploy");
    const vercel = workflow.indexOf("Re-prove Vercel resources immediately before deploy");
    const deploy = workflow.indexOf("Deploy exact release SHA without promoting domains");

    expect(worker).toBeGreaterThan(capture);
    expect(vercel).toBeGreaterThan(worker);
    expect(deploy).toBeGreaterThan(vercel);
    expect(workflow.slice(vercel, deploy)).toContain("release_resource_fingerprint");
    expect(workflow).toContain("EXPECTED_RELEASE_RESOURCE_FINGERPRINT");
  });
});
