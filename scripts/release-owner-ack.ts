const MAX_ACK_AGE_MS = 7 * 24 * 60 * 60 * 1_000;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1_000;

export function collectOwnerAcknowledgementIssues(input: {
  disabled?: string;
  verifiedAt?: string;
  now?: number;
}): string[] {
  const issues: string[] = [];
  if (input.disabled !== "true") {
    issues.push("Vercel native Production auto-deploy is not acknowledged as disabled");
  }
  const verifiedAt = Date.parse(input.verifiedAt ?? "");
  const now = input.now ?? Date.now();
  if (!Number.isFinite(verifiedAt)) {
    issues.push("Vercel Production cutover verification timestamp is missing or invalid");
  } else {
    if (verifiedAt > now + MAX_FUTURE_SKEW_MS) {
      issues.push("Vercel Production cutover verification timestamp is in the future");
    }
    if (now - verifiedAt > MAX_ACK_AGE_MS) {
      issues.push("Vercel Production cutover must be re-verified within seven days of release");
    }
  }
  return issues;
}

if (import.meta.main) {
  const issues = collectOwnerAcknowledgementIssues({
    disabled: process.env.VERCEL_NATIVE_PRODUCTION_DISABLED,
    verifiedAt: process.env.VERCEL_NATIVE_PRODUCTION_DISABLED_VERIFIED_AT,
  });
  if (issues.length > 0) {
    console.error("Owner release acknowledgement failed:");
    for (const issue of issues) console.error(`  - ${issue}`);
    process.exit(1);
  }
  console.log("Owner Vercel Production cutover acknowledgement is current.");
}
